"""FastAPI application factory. Run with ``uvicorn app.main:app --reload --port 8000``."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import api_router
from app.api.deps import Services
from app.api.errors import unhandled_error_handler, validation_error_handler
from app.catalog import Catalog
from app.chat import create_chat_backend
from app.config import Settings, get_settings
from app.geocode import Geocoder
from app.grid import GridService
from app.jobs import AnalysisRunner, InMemoryJobStore
from app.providers import UploadProvider, UploadStore, create_provider


def build_services(settings: Settings) -> Services:
    catalog = Catalog.from_dir()
    grid = GridService(catalog)
    if settings.grid_prewarm:
        grid.prewarm_in_background()
    provider = create_provider(settings.data_provider, settings)
    uploads = UploadProvider(UploadStore(settings.upload_dir))
    jobs = InMemoryJobStore(max_jobs=settings.max_jobs)
    runner = AnalysisRunner(jobs, catalog, provider, uploads, stage_delay=settings.synthetic_delay)
    return Services(
        settings=settings,
        catalog=catalog,
        provider=provider,
        uploads=uploads,
        jobs=jobs,
        runner=runner,
        chat=create_chat_backend(settings.chat_backend, settings),
        grid=grid,
        geocoder=Geocoder(settings),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title="Trend Detective API", version=settings.version)
    app.state.services = build_services(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048)  # map frames are ~100-250 kB of JSON
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
    app.include_router(api_router)
    return app


app = create_app()
