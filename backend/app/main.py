"""FastAPI application factory. Run with ``uvicorn app.main:app --reload --port 8000``."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import seed
from app.api import api_router
from app.api.deps import Services
from app.api.errors import unhandled_error_handler, validation_error_handler
from app.catalog import Catalog
from app.chat import create_chat_backend
from app.config import Settings, get_settings
from app.geocode import Geocoder
from app.jobs import AnalysisRunner, InMemoryJobStore
from app.providers import UploadProvider, UploadStore, create_provider


def build_services(settings: Settings) -> Services:
    catalog = Catalog.from_dir()
    provider = create_provider(settings.data_provider, settings)
    uploads = UploadProvider(UploadStore(settings.upload_dir))
    jobs = InMemoryJobStore(max_jobs=settings.max_jobs)
    runner = AnalysisRunner(jobs, catalog, provider, uploads)
    return Services(
        settings=settings,
        catalog=catalog,
        provider=provider,
        uploads=uploads,
        jobs=jobs,
        runner=runner,
        chat=create_chat_backend(settings.chat_backend, settings),
        geocoder=Geocoder(settings),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title="Trend Detective API", version=settings.version)
    seed.install(settings.cache_seed_dir, Path(settings.cache_dir))
    app.state.services = build_services(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048)  # analysis results with long series
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
    app.include_router(api_router)
    if settings.static_dir and (Path(settings.static_dir) / "index.html").is_file():
        app.mount("/", SpaStaticFiles(directory=settings.static_dir, html=True), name="frontend")
    return app


class SpaStaticFiles(StaticFiles):
    """Serves the built frontend; unknown non-API paths get index.html (client-side routes)."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path == "api" or path.startswith("api/"):
                raise
            return await super().get_response("index.html", scope)


app = create_app()
