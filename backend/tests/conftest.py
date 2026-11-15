from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests import fakes  # noqa: F401  (registers the test-only "fake" provider)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests never download: any NOAA / CMR / AppEEARS request fails like an unreachable server (tests mock it as needed)."""

    def refuse(url, *args, **kwargs):
        raise httpx.ConnectError(f"network disabled in tests: {url}")

    monkeypatch.setattr("app.providers.noaa_gml.httpx.get", refuse)
    monkeypatch.setattr("app.providers.earthdata.httpx.get", refuse)
    monkeypatch.setattr("app.providers.appeears.httpx.request", refuse)
    monkeypatch.setattr("app.providers.appeears.httpx.post", refuse)


@pytest.fixture
def settings(tmp_path) -> Settings:
    # The test-only "fake" provider keeps API tests deterministic and offline; real providers have their own tests.
    return Settings(
        data_provider="fake", upload_dir=tmp_path / "uploads", cache_dir=tmp_path / "cache",
        noaa_seed_dir=None,  # tests opt in to the bundled NOAA seed explicitly
        earthdata_token=None, earthdata_username=None, earthdata_password=None,  # never use a real login
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c
