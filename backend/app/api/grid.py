import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError

from app.api.deps import Services, get_services
from app.grid import GridNotAvailable, GridRequestError
from app.schemas import BBox, GridFrame, TrendGrid

router = APIRouter(tags=["map"])

CACHE_HEADERS = {"Cache-Control": "public, max-age=3600"}


@router.get("/grid/{variable_id}/dates", response_model=list[str])
def grid_dates(variable_id: str, services: Services = Depends(get_services)) -> list[str]:
    """Monthly dates (first of month) the time slider can show for this variable."""
    try:
        return services.grid.dates(variable_id)
    except GridNotAvailable as exc:
        raise HTTPException(404, str(exc)) from exc


def _bbox(west, south, east, north) -> BBox | None:
    edges = (west, south, east, north)
    if not any(e is not None for e in edges):
        return None
    if any(e is None for e in edges):
        raise HTTPException(422, "Give all of west, south, east and north (or none of them for the whole globe).")
    try:
        return BBox(west=west, south=south, east=east, north=north)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()[0]["msg"].removeprefix("Value error, ")) from exc


@router.get("/grid/{variable_id}/trend", response_model=TrendGrid)
def grid_trend(
    variable_id: str,
    start: dt.date = Query(..., description="First month, YYYY-MM-01"),
    end: dt.date = Query(..., description="Last month, YYYY-MM-01"),
    west: float | None = Query(None),
    south: float | None = Query(None),
    east: float | None = Query(None),
    north: float | None = Query(None),
    res: float | None = Query(None, gt=0, le=90, description="Cell size in degrees (global default 2°); capped at 200x200"),
    alpha: float = Query(0.05, gt=0, lt=1),
    services: Services = Depends(get_services),
) -> Response:
    """Per-cell slope per decade (deseasonalized monthly OLS) and Mann-Kendall significance (annual means)."""
    bbox = _bbox(west, south, east, north)
    if start >= end:
        raise HTTPException(422, "start must be before end.")
    try:
        body = services.grid.trend_json(variable_id, start, end, bbox, res, alpha)
    except GridNotAvailable as exc:
        raise HTTPException(404, str(exc)) from exc
    except GridRequestError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(content=body, media_type="application/json", headers=CACHE_HEADERS)


@router.get("/grid/{variable_id}", response_model=GridFrame)
def grid_frame(
    variable_id: str,
    date: dt.date = Query(..., description="Month to show, YYYY-MM-01 (any day picks its month)"),
    west: float | None = Query(None),
    south: float | None = Query(None),
    east: float | None = Query(None),
    north: float | None = Query(None),
    res: float | None = Query(None, gt=0, le=90, description="Cell size in degrees; the grid is capped at 200x200"),
    mode: Literal["value", "anomaly"] = Query("value", description="anomaly = value minus that calendar month's climatology"),
    services: Services = Depends(get_services),
) -> Response:
    """Gridded values of one variable for one month (row 0 = north), for the map heatmap."""
    bbox = _bbox(west, south, east, north)
    try:
        body = services.grid.frame_json(variable_id, date, bbox, res, mode)
    except GridNotAvailable as exc:
        raise HTTPException(404, str(exc)) from exc
    except GridRequestError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(content=body, media_type="application/json", headers=CACHE_HEADERS)
