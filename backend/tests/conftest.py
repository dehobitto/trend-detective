from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests never download: any NOAA GML request fails like an unreachable server (tests mock it as needed)."""

    def refuse(url, *args, **kwargs):
        raise httpx.ConnectError(f"network disabled in tests: {url}")

    monkeypatch.setattr("app.providers.noaa_gml.httpx.get", refuse)
    monkeypatch.setattr("app.providers.earthdata.httpx.get", refuse)


@pytest.fixture
def settings(tmp_path) -> Settings:
    # Synthetic by default so stories are deterministic and offline; tests/test_noaa_gml.py covers "auto".
    return Settings(
        data_provider="synthetic", synthetic_delay=0, upload_dir=tmp_path / "uploads", cache_dir=tmp_path / "cache",
        grid_prewarm=False, noaa_seed_dir=None,  # tests opt in to the bundled NOAA seed explicitly
        earthdata_token=None, earthdata_username=None, earthdata_password=None,  # never use a real login
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c
