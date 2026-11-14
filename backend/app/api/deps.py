"""Shared services, built once in ``create_app`` and stored on ``app.state.services``."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.catalog import Catalog
from app.chat import ChatBackend
from app.config import Settings
from app.geocode import Geocoder
from app.grid import GridService
from app.jobs import AnalysisRunner, JobStore
from app.providers import DataProvider, UploadProvider


@dataclass
class Services:
    settings: Settings
    catalog: Catalog
    provider: DataProvider
    uploads: UploadProvider
    jobs: JobStore
    runner: AnalysisRunner
    chat: ChatBackend
    grid: GridService
    geocoder: Geocoder


def get_services(request: Request) -> Services:
    return request.app.state.services
