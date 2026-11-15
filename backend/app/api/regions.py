from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import Services, get_services
from app.regions import RegionError, RegionShape

router = APIRouter(tags=["map"])


@router.get("/regions/shape", response_model=RegionShape)
def region_shape(
    osm: str = Query(..., min_length=2, max_length=16, description="OSM id from /api/geocode, e.g. 'R60199' (Ukraine)"),
    services: Services = Depends(get_services),
) -> RegionShape:
    """A named area's boundary approximated by grid squares (the analysis averages inside them only)."""
    try:
        return services.regions.shape(osm)
    except RegionError as exc:
        raise HTTPException(422, str(exc)) from exc
