"""Runtime settings, read from environment variables prefixed with ``TD_``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """All tunables for the backend. Override any field with ``TD_<FIELD_NAME>``."""

    model_config = SettingsConfigDict(env_prefix="TD_", env_file=".env", extra="ignore")

    version: str = "0.1.0"
    data_provider: str = "auto"
    """Name of the registered DataProvider used for catalog variables. ``auto``: real data where a
    provider is implemented (NOAA GML greenhouse-gas records), synthetic elsewhere and as a fallback;
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
    noaa_gml_base_url: str = "https://gml.noaa.gov/webdata/ccgg/trends"
    noaa_cache_ttl_days: float = 7.0
    """A cached NOAA file older than this is downloaded again (a stale copy is used if that fails)."""
    http_timeout: float = 30.0
    """Seconds before an outgoing data download gives up."""
    upload_dir: Path = BACKEND_DIR / "data" / "uploads"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_jobs: int = 500
    """Oldest finished jobs are evicted from the in-memory store beyond this count."""


@lru_cache
def get_settings() -> Settings:
    return Settings()
