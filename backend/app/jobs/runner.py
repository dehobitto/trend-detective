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
from app.processing.summary import build_summary
from app.providers import DataProvider, ProviderError, UploadProvider, fetch_progress
from app.providers.base import fetch_mask
from app.schemas.analysis import AnalysisRequest, AnalysisResult, SeriesPoint, TrendStats
from app.processing.trend_significance import assess_trend

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
            self.store.update(job_id, status="error", message=str(exc))
        except Exception:  # never leave a job hanging
            log.exception("Analysis job %s failed", job_id)
            self.store.update(job_id, status="error", message="Something went wrong on the server. Please try again.")
        else:
            self.store.update(job_id, status="done", progress=1.0, message="Done", result=result)

    def _stage(self, job_id: str, status: str, progress: float, message: str) -> None:
        self.store.update(job_id, status=status, progress=progress, message=message)

    def _run(self, job_id: str, request: AnalysisRequest) -> AnalysisResult:
        plan = resolve(request, self.catalog, self.provider, self.uploads)
        provider = plan.provider
        self._stage(job_id, "fetching", 0.1, f"Fetching {plan.variable.name} data from {_source(plan)}…")

        def on_progress(done: int, total: int) -> None:
            self._stage(
                job_id, "fetching", 0.1 + 0.35 * done / max(total, 1),
                f"Downloading from NASA: {done} of {total} files. "
                "A new area takes a while the first time; after that it is instant.",
            )

        with fetch_progress(on_progress), fetch_mask(plan.cells):
            monthly = provider.fetch(plan.variable, plan.bbox, plan.start, plan.end)
        # Providers may attach notes ("sampled every ~N km…"); read them now, resampling drops attrs.
        provider_notes = list(monthly.attrs.get("notes", []))

        self._stage(job_id, "processing", 0.45, "Cleaning and averaging the data…")
        is_monthly = plan.aggregation == "monthly"
        series = monthly if is_monthly or ts.infer_frequency(monthly.index) == "annual" else ts.to_annual(monthly)
        want_deseasonalized = bool(request.deseasonalize)
        processed = prep.preprocess(series, want_deseasonalized=bool(request.deseasonalize), is_monthly=is_monthly)
        analyzed = processed.tested
        if analyzed.notna().sum() < MIN_POINTS:
            raise InvalidRequest("Not enough data in this period to test for a trend. Try a longer date range.")

        self._stage(job_id, "analyzing", 0.75, "Testing whether the trend is real…")
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
            summary=assess_trend(series, seasonal=processed.seasonal).summary(),
            provider=provider.name,
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
