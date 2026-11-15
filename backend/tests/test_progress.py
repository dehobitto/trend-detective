"""Download progress reported by a provider reaches the job while it is fetching."""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog import Catalog
from app.jobs.runner import AnalysisRunner
from app.jobs.store import InMemoryJobStore
from app.providers import UploadProvider, UploadStore
from app.providers.base import report_progress
from app.schemas.analysis import AnalysisRequest
from app.schemas.common import BBox


class ReportingProvider:
    name = "reporting"

    def __init__(self, store: InMemoryJobStore) -> None:
        self.store = store
        self.seen: list[tuple[float, str]] = []

    def fetch(self, variable, bbox, start: dt.date, end: dt.date) -> pd.Series:
        for done in (0, 5, 10):
            report_progress(done, 10)
            job = next(iter(self.store._jobs.values()))
            self.seen.append((job.progress, job.message or ""))
        index = pd.date_range(start, end, freq="MS")
        return pd.Series([float(i % 12 + i / 50) for i in range(len(index))], index=index)


def test_progress_reaches_job(settings, tmp_path):
    store = InMemoryJobStore()
    provider = ReportingProvider(store)
    runner = AnalysisRunner(store, Catalog.from_dir(), provider, UploadProvider(UploadStore(tmp_path)))
    job = store.create(AnalysisRequest(
        bbox=BBox(west=73.5, south=28.5, east=77.5, north=32.5), variable_id="gldas_gws",
        start=dt.date(2005, 1, 1), end=dt.date(2015, 12, 31),
    ))
    runner.run(job.id)

    progresses = [p for p, _ in provider.seen]
    assert progresses == sorted(progresses) and progresses[0] < progresses[-1] <= 0.45
    assert "10 of 10 files" in provider.seen[-1][1]
    assert store.get(job.id).status == "done"
    report_progress(1, 2)  # outside a job: a harmless no-op
