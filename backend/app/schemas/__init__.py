"""Pydantic models mirroring docs/API.md exactly."""

from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResult,
    Job,
    JobStatus,
    SeriesPoint,
    TrendStats,
)
from app.schemas.chat import ChatContext, ChatMessage, ChatRequest, ChatResponse
from app.schemas.common import BBox, ExampleCase, GibsMapLayer, LatLon, Location, MapLayer, Variable
from app.schemas.dataset import Dataset
from app.schemas.geocode import Place
from app.schemas.health import Health

__all__ = [
    "AnalysisRequest", "AnalysisResult", "BBox", "ChatContext", "ChatMessage", "ChatRequest",
    "ChatResponse", "Dataset", "ExampleCase", "GibsMapLayer", "Health",
    "Job", "JobStatus", "LatLon", "Location", "MapLayer", "Place", "SeriesPoint", "TrendStats", "Variable",
]
