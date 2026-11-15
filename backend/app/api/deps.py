"""Shared services, built once in ``create_app`` and stored on ``app.state.services``."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.catalog import Catalog
from app.chat import ChatBackend
from app.config import Settings
from app.geocode import Geocoder
from app.jobs import AnalysisRunner, JobStore
from app.providers import DataProvider, UploadProvider
from app.regions import RegionService


@dataclass
class Services:
    settings: Settings
    catalog: Catalog
    provider: DataProvider
    uploads: UploadProvider
    jobs: JobStore
    runner: AnalysisRunner
    chat: ChatBackend
    geocoder: Geocoder
    regions: RegionService


def get_services(request: Request) -> Services:
    return request.app.state.services
