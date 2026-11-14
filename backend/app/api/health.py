from fastapi import APIRouter, Depends

from app.api.deps import Services, get_services
from app.schemas import Health

router = APIRouter(tags=["health"])


@router.get("/health", response_model=Health)
def health(services: Services = Depends(get_services)) -> Health:
    return Health(provider=services.provider.name, version=services.settings.version)
