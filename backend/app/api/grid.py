import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError

from app.api.deps import Services, get_services
from app.grid import GridNotAvailable, GridRequestError
from app.schemas import BBox, GridFrame

router = APIRouter(tags=["map"])

CACHE_HEADERS = {"Cache-Control": "public, max-age=3600"}


@router.get("/grid/{variable_id}/dates", response_model=list[str])
def grid_dates(variable_id: str, services: Services = Depends(get_services)) -> list[str]:
    """Monthly dates (first of month) the time slider can show for this variable."""
    try:
        return services.grid.dates(variable_id)
    except GridNotAvailable as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/grid/{variable_id}", response_model=GridFrame)
def grid_frame(
    variable_id: str,
    date: dt.date = Query(..., description="Month to show, YYYY-MM-01 (any day picks its month)"),
    west: float | None = Query(None),
    south: float | None = Query(None),
    east: float | None = Query(None),
    north: float | None = Query(None),
    res: float | None = Query(None, gt=0, le=90, description="Cell size in degrees; the grid is capped at 200x200"),
    services: Services = Depends(get_services),
) -> Response:
    """Gridded values of one variable for one month (row 0 = north), for the map heatmap."""
    edges = (west, south, east, north)
    bbox = None
    if any(e is not None for e in edges):
        if any(e is None for e in edges):
            raise HTTPException(422, "Give all of west, south, east and north (or none of them for the whole globe).")
        try:
            bbox = BBox(west=west, south=south, east=east, north=north)
        except ValidationError as exc:
            raise HTTPException(422, exc.errors()[0]["msg"].removeprefix("Value error, ")) from exc
    try:
        body = services.grid.frame_json(variable_id, date, bbox, res)
    except GridNotAvailable as exc:
        raise HTTPException(404, str(exc)) from exc
    except GridRequestError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(content=body, media_type="application/json", headers=CACHE_HEADERS)
