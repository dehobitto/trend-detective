from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.api.deps import Services, get_services
from app.providers import InvalidCSV
from app.schemas import Dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("", response_model=Dataset, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    units: str | None = Form(None),
    services: Services = Depends(get_services),
) -> Dataset:
    """Upload a CSV with header ``date,value``. Analyze it with ``variable_id = "upload:<id>"``."""
    limit = services.settings.max_upload_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"The file is too large (limit {limit // (1024 * 1024)} MB).")
    try:
        return services.uploads.store.save(content, name, units, file.filename)
    except InvalidCSV as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("", response_model=list[Dataset])
def list_datasets(services: Services = Depends(get_services)) -> list[Dataset]:
    return services.uploads.store.list()


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_dataset(dataset_id: str, services: Services = Depends(get_services)) -> Response:
    if not services.uploads.store.delete(dataset_id):
        raise HTTPException(404, f"Unknown dataset '{dataset_id}'.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
