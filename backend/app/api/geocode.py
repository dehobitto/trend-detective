from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import Services, get_services
from app.geocode import GeocodeError
from app.schemas import Place

router = APIRouter(tags=["map"])


@router.get("/geocode", response_model=list[Place])
def geocode(
    q: str = Query(..., min_length=2, max_length=200, description="Place name, e.g. 'Punjab' or 'Lake Chad'"),
    limit: int = Query(6, ge=1, le=20),
    services: Services = Depends(get_services),
) -> list[Place]:
    """Search places by name (Photon, falling back to OSM Nominatim; cached)."""
    if len(q.strip()) < 2:
        raise HTTPException(422, "q: Type at least 2 characters.")
    try:
        return services.geocoder.search(q, limit)
    except GeocodeError as exc:
        raise HTTPException(502, str(exc)) from exc
