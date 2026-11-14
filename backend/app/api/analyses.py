import csv
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status

from app.api.deps import Services, get_services
from app.jobs import InvalidRequest, NotFound, resolve
from app.schemas import AnalysisRequest, Job

router = APIRouter(prefix="/analyses", tags=["analyses"])

CSV_COLUMNS = ["date", "value", "deseasonalized", "trend", "ci_low", "ci_high"]


@router.post("", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
def create_analysis(
    request: AnalysisRequest, background: BackgroundTasks, services: Services = Depends(get_services)
) -> Job:
    """Validate, enqueue and return the job immediately (status ``queued``); poll GET for progress."""
    try:
        resolve(request, services.catalog, services.provider, services.uploads)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from None
    except InvalidRequest as exc:
        raise HTTPException(422, str(exc)) from None
    job = services.jobs.create(request)
    background.add_task(services.runner.run, job.id)
    return job


@router.get("/{job_id}", response_model=Job)
def get_analysis(job_id: str, services: Services = Depends(get_services)) -> Job:
    return _get_job(job_id, services)


@router.get("/{job_id}/csv", response_class=Response)
def download_csv(job_id: str, services: Services = Depends(get_services)) -> Response:
    job = _get_job(job_id, services)
    if job.status != "done" or job.result is None:
        raise HTTPException(409, "The analysis is not finished yet.")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for p in job.result.series:
        writer.writerow([p.date.isoformat(), *("" if v is None else repr(v) for v in
                         (p.value, p.deseasonalized, p.trend, p.ci_low, p.ci_high))])
    filename = f"trend_{job.result.variable.id.replace(':', '_')}_{job.id[:8]}.csv"
    return Response(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _get_job(job_id: str, services: Services) -> Job:
    job = services.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"Unknown analysis '{job_id}'.")
    return job
