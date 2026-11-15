"""Runtime settings, read from environment variables prefixed with ``TD_``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """All tunables for the backend. Override any field with ``TD_<FIELD_NAME>``."""

    model_config = SettingsConfigDict(env_prefix="TD_", env_file=".env", extra="ignore", populate_by_name=True)

    version: str = "0.1.0"
    data_provider: str = "auto"
    """Name of the registered DataProvider used for catalog variables. ``auto``: real data where a
    provider is implemented (NOAA GML records; GES DISC products via ``earthdata`` when an Earthdata login is
    set or their values are cached), synthetic elsewhere and as a fallback;
    ``synthetic``: demo data for everything; ``live``: real providers only (stubs raise)."""
    synthetic_delay: float = 0.3
    """Artificial pause (seconds) per job stage for local providers, so progress UI is visible."""
    chat_backend: str = "stub"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ]
    cache_dir: Path = BACKEND_DIR / "data" / "cache"
    """Downloaded source files (gitignored)."""
    earthdata_token: str | None = Field(default=None, validation_alias=AliasChoices("TD_EARTHDATA_TOKEN", "EARTHDATA_TOKEN"))
    """NASA Earthdata Login bearer token (urs.earthdata.nasa.gov -> Generate Token) for GES DISC OPeNDAP.
    Alternative: username + password below. Never commit it; put it in ``backend/.env`` or the environment."""
    earthdata_username: str | None = Field(
        default=None, validation_alias=AliasChoices("TD_EARTHDATA_USERNAME", "EARTHDATA_USERNAME", "EARTHDATA_USER")
    )
    earthdata_password: str | None = Field(
        default=None, validation_alias=AliasChoices("TD_EARTHDATA_PASSWORD", "EARTHDATA_PASSWORD", "EARTHDATA_PASS")
    )
    earthdata_workers: int = 8
    """Parallel OPeNDAP requests per analysis (each is one small granule subset)."""
    noaa_gml_base_url: str = "https://gml.noaa.gov/webdata/ccgg/trends"
    noaa_cache_ttl_days: float = 7.0
    """A cached NOAA file older than this is downloaded again (a stale copy is used if that fails)."""
    http_timeout: float = 30.0
    """Seconds before an outgoing data download gives up."""
    noaa_seed_dir: Path | None = BACKEND_DIR / "app" / "data" / "seed" / "noaa_gml"
    """Read-only NOAA GML files committed with the code; used when a file is not cached and NOAA can't be
    reached (copied into the cache, so a fresh download is tried again after the TTL). ``None`` disables it."""
    upload_dir: Path = BACKEND_DIR / "data" / "uploads"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_jobs: int = 500
    """Oldest finished jobs are evicted from the in-memory store beyond this count."""
    grid_prewarm: bool = True
    """Compute every variable's map color range in a background thread at startup (first frames stay fast)."""
    photon_url: str = "https://photon.komoot.io/api/"
    """Place search (GET /api/geocode), tried first."""
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    """Fallback place search (OSM Nominatim, jsonv2)."""
    geocode_timeout: float = 6.0
    """Seconds before a place-search request gives up."""
    geocode_cache_ttl: float = 24 * 3600
    """Seconds a place-search answer is kept in memory."""
    nominatim_min_interval: float = 1.0
    """Nominatim usage policy: at most one request per this many seconds."""
    static_dir: Path | None = None
    """Built frontend (``frontend/dist``) to serve at ``/`` with an index.html fallback, for single-container
    deploys. Only mounted when the directory contains ``index.html``; unset in local dev (Vite serves the UI)."""


@lru_cache
def get_settings() -> Settings:
    return Settings()
