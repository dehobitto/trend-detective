"""NOAA GML provider: parsing (committed fixtures), disk cache, and the ``auto`` routing/fallback. No network."""

import datetime as dt
import os
import shutil
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.catalog import Catalog
from app.main import create_app
from app.providers import ProviderError, create_provider
from app.providers.noaa_gml import FALLBACK_WARNING, file_name, file_url, parse_monthly

FIXTURES = Path(__file__).parent / "fixtures"
SERIES_FILES = {"mauna_loa_co2": "co2_mm_mlo", "noaa_co2_marine": "co2_mm_gl", "noaa_ch4_marine": "ch4_mm_gl"}


def fixture_text(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")


def seed_cache(cache_dir: Path) -> None:
    target = cache_dir / "noaa_gml"
    target.mkdir(parents=True, exist_ok=True)
    for name in SERIES_FILES.values():
        shutil.copy(FIXTURES / f"{name}.txt", target / f"{name}.txt")


def fake_get(text: str, calls: list[str] | None = None):
    def get(url, *args, **kwargs):
        if calls is not None:
            calls.append(url)
        return httpx.Response(200, text=text, request=httpx.Request("GET", url))

    return get


# ------------------------------------------------------------------------------------------- parsing ----

def test_parse_mauna_loa_uses_monthly_average_and_marks_missing():
    s = parse_monthly(fixture_text("co2_mm_mlo"))
    assert s.index.freqstr == "MS"
    assert s.index[0] == pd.Timestamp("1958-03-01") and s.index[-1] == pd.Timestamp("1960-12-01")
    assert s[pd.Timestamp("1958-03-01")] == 315.71  # "monthly average", not de-seasonalized 314.44
    assert np.isnan(s[pd.Timestamp("1959-06-01")])  # -99.99 marker
    assert np.isnan(s[pd.Timestamp("1960-02-01")])  # row absent from the file -> NaN month
    assert s.notna().sum() == len(s) - 2 and s.dropna().between(300, 330).all()


def test_parse_global_co2_and_ch4():
    co2 = parse_monthly(fixture_text("co2_mm_gl"))
    assert (co2.index[0], co2.index[-1]) == (pd.Timestamp("1979-01-01"), pd.Timestamp("1981-12-01"))
    assert co2.iloc[0] == 336.56 and co2.notna().all()

    ch4 = parse_monthly(fixture_text("ch4_mm_gl"))
    assert ch4.index[0] == pd.Timestamp("1983-07-01") and ch4.iloc[0] == 1625.96
    assert np.isnan(ch4[pd.Timestamp("1984-01-01")])  # -9.99 marker
    assert ch4.dropna().between(1600, 1700).all()


@pytest.mark.parametrize("text", ["", "# only comments\n#\n", "<html>Service unavailable</html>\n", "1980 1 x y\n"])
def test_parse_rejects_garbage(text):
    with pytest.raises(ProviderError):
        parse_monthly(text)


def test_catalog_products_map_to_noaa_urls():
    catalog = Catalog.from_dir()
    for var_id, name in SERIES_FILES.items():
        v = catalog.get(var_id)
        assert v.access == "NOAA GML" and file_name(v) == name
    assert file_url("https://gml.noaa.gov/webdata/ccgg/trends/", "ch4_mm_gl") == (
        "https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt"
    )
    with pytest.raises(ProviderError):
        file_name(catalog.get("gldas_gws"))


# --------------------------------------------------------------------------------------------- cache ----

def test_fetch_reads_fresh_cache_without_downloading(settings):
    seed_cache(settings.cache_dir)
    provider = create_provider("noaa_gml", settings)
    v = Catalog.from_dir().get("mauna_loa_co2")
    s = provider.fetch(v, None, dt.date(1959, 1, 15), dt.date(1959, 12, 31))  # no-network fixture would raise
    assert len(s) == 12 and s.index[0] == pd.Timestamp("1959-01-01") and s.name == "mauna_loa_co2"


def test_stale_cache_is_refreshed_and_used_when_download_fails(settings, monkeypatch):
    seed_cache(settings.cache_dir)
    path = settings.cache_dir / "noaa_gml" / "co2_mm_gl.txt"
    old = time.time() - 30 * 86400
    os.utime(path, (old, old))
    provider = create_provider("noaa_gml", settings)
    v = Catalog.from_dir().get("noaa_co2_marine")

    # download fails (conftest blocks the network) -> stale copy is still served
    assert provider.fetch(v, None, dt.date(1979, 1, 1), dt.date(1981, 12, 31)).iloc[0] == 336.56

    calls: list[str] = []
    newer = fixture_text("co2_mm_gl").replace("336.56", "336.99")
    monkeypatch.setattr("app.providers.noaa_gml.httpx.get", fake_get(newer, calls))
    assert provider.fetch(v, None, dt.date(1979, 1, 1), dt.date(1981, 12, 31)).iloc[0] == 336.99
    assert calls == ["https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.txt"]
    assert "336.99" in path.read_text() and time.time() - path.stat().st_mtime < 60


def test_broken_download_is_not_cached(settings, monkeypatch):
    monkeypatch.setattr("app.providers.noaa_gml.httpx.get", fake_get("<html>oops</html>"))
    provider = create_provider("noaa_gml", settings)
    with pytest.raises(ProviderError):
        provider.fetch(Catalog.from_dir().get("noaa_ch4_marine"), None, dt.date(1984, 1, 1), dt.date(1985, 12, 31))
    assert not (settings.cache_dir / "noaa_gml" / "ch4_mm_gl.txt").exists()


# ------------------------------------------------------------------------------------ auto routing ----

@pytest.fixture
def auto_settings(settings):
    return settings.model_copy(update={"data_provider": "auto"})


def analyze(client: TestClient, **body) -> dict:
    r = client.post("/api/analyses", json=body)
    assert r.status_code == 202, r.text
    job = client.get(f"/api/analyses/{r.json()['id']}").json()
    assert job["status"] == "done", job["message"]
    return job["result"]


def test_auto_is_the_default_provider(monkeypatch):
    from app.config import Settings

    monkeypatch.delenv("TD_DATA_PROVIDER", raising=False)
    assert Settings(_env_file=None).data_provider == "auto"


def test_auto_uses_real_noaa_data_for_series_and_synthetic_elsewhere(auto_settings):
    seed_cache(auto_settings.cache_dir)
    with TestClient(create_app(auto_settings)) as c:
        assert c.get("/api/health").json()["provider"] == "auto"
        real = analyze(c, variable_id="mauna_loa_co2", start="1958-03-01", end="1960-12-31")
        assert real["synthetic"] is False and real["provider"] == "noaa_gml"
        assert not any("Demo data" in w or "NOAA" in w for w in real["warnings"])
        assert real["series"][0]["value"] == 315.71
        assert real["stats"]["direction"] == "rising"

        demo = analyze(c, variable_id="gldas_gws", bbox={"west": 74, "south": 29, "east": 77, "north": 32},
                       start="2004-01-01", end="2020-12-31")
        assert demo["synthetic"] is True and demo["provider"] == "synthetic"


def test_auto_falls_back_to_synthetic_when_noaa_is_unreachable(auto_settings):
    # empty cache + httpx failure (conftest makes every download raise ConnectError)
    with TestClient(create_app(auto_settings)) as c:
        result = analyze(c, variable_id="noaa_ch4_marine", start="1990-01-01", end="2020-12-31")
    assert result["synthetic"] is True and result["provider"] == "synthetic"
    assert FALLBACK_WARNING in result["warnings"] and FALLBACK_WARNING == "Couldn't reach NOAA; showing demo data."
    assert any("Demo data" in w for w in result["warnings"])


def test_synthetic_setting_forces_demo_data_even_with_a_cache(settings):
    seed_cache(settings.cache_dir)
    with TestClient(create_app(settings)) as c:  # conftest: data_provider="synthetic"
        result = analyze(c, variable_id="mauna_loa_co2", start="1958-03-01", end="1960-12-31")
    assert result["synthetic"] is True and result["provider"] == "synthetic"
    assert FALLBACK_WARNING not in result["warnings"]


def test_bundled_seed_is_used_when_noaa_is_unreachable_and_nothing_is_cached(auto_settings):
    from app.config import Settings

    seeded = auto_settings.model_copy(update={"noaa_seed_dir": Settings.model_fields["noaa_seed_dir"].default})
    with TestClient(create_app(seeded)) as c:  # conftest makes every download fail
        result = analyze(c, variable_id="mauna_loa_co2", start="1990-01-01", end="2020-12-31")
    assert result["synthetic"] is False and result["provider"] == "noaa_gml"
    assert FALLBACK_WARNING not in result["warnings"]
    assert (seeded.cache_dir / "noaa_gml" / "co2_mm_mlo.txt").exists()  # copied, so retried only after the TTL


def test_bundled_seed_files_cover_every_noaa_variable():
    from app.config import Settings

    seed_dir = Settings.model_fields["noaa_seed_dir"].default
    for v in Catalog.from_dir().variables():
        if v.product.startswith("NOAA-GML:"):
            assert len(parse_monthly((seed_dir / f"{file_name(v)}.txt").read_text(encoding="utf-8"))) > 100
