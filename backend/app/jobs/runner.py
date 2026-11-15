"""Runs one analysis job: provider -> preprocess -> trends, updating status as it goes.

``AnalysisRunner.run(job_id)`` is a plain synchronous function, so it can be scheduled by FastAPI
``BackgroundTasks`` (today), a thread pool, or a worker process reading from a queue (later).
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from app.catalog import Catalog
from app.jobs.resolve import InvalidRequest, NotFound, Plan, resolve
from app.jobs.store import JobStore
from app.processing import preprocess as prep
from app.processing import timeseries as ts
from app.processing import trends
from app.providers import DataProvider, ProviderError, UploadProvider, fetch_partial, fetch_progress
from app.providers.base import fetch_mask
from app.processing.assessment import to_assessment
from app.processing.summary import build_summary
from app.processing.trend_significance import assess_trend
from app.schemas.analysis import AnalysisRequest, AnalysisResult, SeriesPoint, TrendStats

log = logging.getLogger(__name__)

SHORT_RECORD_YEARS = 10
HIGH_AUTOCORRELATION = 0.5
MIN_POINTS = 5


class AnalysisRunner:
    def __init__(
        self,
        store: JobStore,
        catalog: Catalog,
        provider: DataProvider,
        uploads: UploadProvider,
    ) -> None:
        self.store = store
        self.catalog = catalog
        self.provider = provider
        self.uploads = uploads

    def run(self, job_id: str) -> None:
        job = self.store.get(job_id)
        if job is None:
            return
        try:
            result = self._run(job_id, job.request)
        except (ProviderError, InvalidRequest, NotFound, ValueError) as exc:
            self.store.update(job_id, status="error", message=str(exc), preview=None)
        except Exception:  # never leave a job hanging
            log.exception("Analysis job %s failed", job_id)
            self.store.update(job_id, status="error", message="Something went wrong on the server. Please try again.",
                              preview=None)
        else:
            self.store.update(job_id, status="done", progress=1.0, message="Done", result=result, preview=None)

    def _stage(self, job_id: str, status: str, progress: float, message: str) -> None:
        self.store.update(job_id, status=status, progress=progress, message=message)

    def _run(self, job_id: str, request: AnalysisRequest) -> AnalysisResult:
        plan = resolve(request, self.catalog, self.provider, self.uploads)
        provider = plan.provider
        self._stage(job_id, "fetching", 0.1, f"Fetching {plan.variable.name} data from {_source(plan)}…")

        has_preview = False

        def on_progress(done: int, total: int) -> None:
            tail = ("A first result is shown below; it sharpens as the rest arrives." if has_preview
                    else "A new area takes a while the first time; after that it is instant.")
            self._stage(job_id, "fetching", 0.1 + 0.35 * done / max(total, 1),
                        f"Downloading from NASA: {done} of {total} files. {tail}")

        def on_partial(series: pd.Series, note: str) -> None:
            nonlocal has_preview
            try:
                preview = self._analyze(plan, request, series, [note], is_monthly=False, deseasonalize=False)
            except (InvalidRequest, ValueError) as exc:  # too few points yet: just wait for more
                log.debug("No preview for job %s yet: %s", job_id, exc)
                return
            except Exception:  # a preview must never break the real analysis
                log.exception("Preview failed for job %s", job_id)
                return
            has_preview = True
            self.store.update(job_id, preview=preview)

        with fetch_progress(on_progress), fetch_partial(on_partial), fetch_mask(plan.cells):
            monthly = provider.fetch(plan.variable, plan.bbox, plan.start, plan.end)
        # Providers may attach notes ("sampled every ~N km…"); read them now, resampling drops attrs.
        provider_notes = list(monthly.attrs.get("notes", []))

        self._stage(job_id, "processing", 0.45, "Cleaning and averaging the data…")
        return self._analyze(
            plan, request, monthly, provider_notes,
            is_monthly=plan.aggregation == "monthly", deseasonalize=bool(request.deseasonalize),
            on_stage=lambda: self._stage(job_id, "analyzing", 0.75, "Testing whether the trend is real…"),
        )

    def _analyze(
        self, plan: Plan, request: AnalysisRequest, monthly: pd.Series, provider_notes: list[str], *,
        is_monthly: bool, deseasonalize: bool, on_stage=None,
    ) -> AnalysisResult:
        """Preprocess + trend tests + summary for a fetched series (also used for preliminary results)."""
        series = monthly if is_monthly or ts.infer_frequency(monthly.index) == "annual" else ts.to_annual(monthly)
        processed = prep.preprocess(series, want_deseasonalized=deseasonalize, is_monthly=is_monthly)
        analyzed = processed.tested
        if analyzed.notna().sum() < MIN_POINTS:
            raise InvalidRequest("Not enough data in this period to test for a trend. Try a longer date range.")

        if on_stage is not None:
            on_stage()
        analysis = trends.analyze(
            ts.decimal_years(analyzed.index),
            analyzed.to_numpy(),
            alpha=request.alpha,
            reference_mean=float(processed.raw.mean()),
            ratio_scale=plan.variable.ratio_scale,
        )
        stats = TrendStats.model_validate(analysis.stats)
        valid_index = analyzed.dropna().index
        warnings = (
            provider_notes + plan.warnings + processed.warnings + self._quality_warnings(valid_index, analysis)
        )
        return AnalysisResult(
            variable=plan.variable.public(),
            bbox=plan.bbox,
            analyzed_series="deseasonalized" if processed.deseasonalized is not None else "raw",
            series=_series_points(processed, analysis),
            stats=stats,
            summary=build_summary(stats, plan.variable.units, valid_index[0].year, valid_index[-1].year),
            assessment=_assess(series, processed, is_monthly),
            provider=plan.provider.name,
            region_name=request.region_name if plan.cells else None,
            warnings=warnings,
        )

    @staticmethod
    def _quality_warnings(index: pd.DatetimeIndex, analysis: trends.TrendAnalysis) -> list[str]:
        warnings = []
        years = ts.span_years(index)
        if years < SHORT_RECORD_YEARS:
            warnings.append(
                f"Only {years:.1f} years of data: trends over fewer than {SHORT_RECORD_YEARS} years may not be reliable."
            )
        if analysis.residual_lag1 > HIGH_AUTOCORRELATION:
            warnings.append(
                f"Neighboring values are strongly linked (autocorrelation {analysis.residual_lag1:.2f}), "
                "so the p-values may make the trend look more certain than it is."
            )
        return warnings


def _source(plan: Plan) -> str:
    return "your upload" if plan.provider.name == "upload" else plan.variable.source


def _clean(x: float) -> float | None:
    return None if x is None or not np.isfinite(x) else float(x)


def _assess(series: pd.Series, processed: prep.Preprocessed, is_monthly: bool):
    """The multi-test assessment; never fails the analysis (it is an extra view of the same series).

    It models the seasonal cycle itself when it has one, so monthly data get their seasonal component even
    when the user chose to analyze the raw values."""
    seasonal = processed.seasonal
    if seasonal is None and is_monthly:
        seasonal = prep.seasonal_component(processed.raw)
    try:
        return to_assessment(assess_trend(series, seasonal=seasonal))
    except Exception:  # noqa: BLE001  (a numerical corner case in one of many tests)
        log.exception("Trend assessment failed")
        return None


def _series_points(processed: prep.Preprocessed, analysis: trends.TrendAnalysis) -> list[SeriesPoint]:
    deseason = processed.deseasonalized
    return [
        SeriesPoint(
            date=stamp.date(),
            value=_clean(processed.raw.iloc[i]),
            deseasonalized=_clean(deseason.iloc[i]) if deseason is not None else None,
            trend=_clean(analysis.trend[i]),
            ci_low=_clean(analysis.ci_low[i]),
            ci_high=_clean(analysis.ci_high[i]),
        )
        for i, stamp in enumerate(processed.raw.index)
    ]
