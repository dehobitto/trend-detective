"""Job storage. ``JobStore`` is the seam for swapping to Redis/a database + a real queue later."""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from collections import OrderedDict
from typing import Any, Protocol

from app.schemas.analysis import AnalysisRequest, Job

FINISHED = {"done", "error"}


class JobStore(Protocol):
    def create(self, request: AnalysisRequest) -> Job: ...
    def get(self, job_id: str) -> Job | None: ...
    def update(self, job_id: str, **changes: Any) -> Job: ...


class InMemoryJobStore:
    """Thread-safe dict of jobs. Evicts the oldest finished jobs beyond ``max_jobs``."""

    def __init__(self, max_jobs: int = 500) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()
        self._max_jobs = max_jobs

    def create(self, request: AnalysisRequest) -> Job:
        job = Job(
            id=uuid.uuid4().hex,
            status="queued",
            progress=0.0,
            message="Waiting to start…",
            request=request,
            result=None,
            created_at=dt.datetime.now(dt.UTC),
        )
        with self._lock:
            self._jobs[job.id] = job
            self._evict()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **changes: Any) -> Job:
        with self._lock:
            job = self._jobs[job_id].model_copy(update=changes)
            self._jobs[job_id] = job
            return job

    def _evict(self) -> None:
        while len(self._jobs) > self._max_jobs:
            victim = next((k for k, j in self._jobs.items() if j.status in FINISHED), None)
            if victim is None:
                return
            del self._jobs[victim]
