from fastapi.testclient import TestClient

PHOENIX = {"west": -112.5, "south": 33.2, "east": -111.6, "north": 33.8}
NORTH_CHINA = {"west": 113, "south": 34, "east": 119, "north": 40}


def run(client: TestClient, **overrides) -> dict:
    body = {"bbox": PHOENIX, "variable_id": "modis_lst_night", "start": "2001-01-01", "end": "2020-12-31"} | overrides
    r = client.post("/api/analyses", json=body)
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["status"] == "queued" and job["result"] is None
    return client.get(f"/api/analyses/{job['id']}").json()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "provider": "fake", "version": "0.1.0"}


VARIABLE_FIELDS = {
    "id", "name", "short_definition", "why_it_matters", "units", "sphere", "source", "mission_or_model", "product",
    "temporal_resolution", "available_start", "available_end", "coverage", "dataset", "access", "location",
    "map_layer",
}


def test_variables_and_examples(client):
    variables = client.get("/api/variables").json()
    assert len(variables) == 18
    assert all(set(v) == VARIABLE_FIELDS for v in variables)  # internal ratio_scale/conversion hidden
    assert {v["sphere"] for v in variables} == {"atmosphere", "land", "water"}
    by_id = {v["id"]: v for v in variables}
    assert by_id["modis_lst_night"]["units"] == "°C" and by_id["modis_lst_night"]["access"] == "Earthdata OPeNDAP"
    assert by_id["modis_lst_night"]["product"] == "MOD11C3.061:LST_Night_CMG"
    assert by_id["modis_ndvi"]["access"] == "Earthdata OPeNDAP" and by_id["modis_ndvi"]["coverage"] == "land"
    assert all(v["map_layer"] is None or v["map_layer"]["kind"] == "gibs" for v in variables)
    assert by_id["gldas_gws"]["dataset"] == "GLDAS_CLSM025_DA1_D v2.2" and by_id["gldas_gws"]["coverage"] == "land"
    assert by_id["omi_no2"]["units"] == "10¹⁵ molecules/cm²"
    assert by_id["merra2_dust"]["product"] == "M2TMNXAER.5.12.4:DUSMASS" and by_id["merra2_dust"]["units"] == "µg/m³"
    series = {v["id"] for v in variables if v["coverage"] == "series"}
    assert series == {"mauna_loa_co2", "noaa_co2_marine", "noaa_ch4_marine"}
    assert by_id["mauna_loa_co2"]["location"] == {"lat": 19.54, "lon": -155.58, "label": "Mauna Loa Observatory, Hawaii"}
    assert by_id["mauna_loa_co2"]["available_end"] == "2026-09-30" and by_id["mauna_loa_co2"]["access"] == "NOAA GML"
    assert by_id["noaa_ch4_marine"]["location"] is None and by_id["noaa_ch4_marine"]["units"] == "ppb"
    assert all(v["location"] is None for v in variables if v["coverage"] != "series")
    assert client.get("/api/variables/gpm_precipitation").json()["units"] == "mm/day"
    assert client.get("/api/variables/nope").status_code == 404

    examples = client.get("/api/examples").json()
    assert len(examples) == 10
    for e in examples:
        assert e["variable_id"] in by_id and "center" in e and e["takeaway"]
        assert e["related_variable_id"] is None or e["related_variable_id"] in by_id
        assert (e["bbox"] is None) == (e["variable_id"] in series)
    punjab = next(e for e in examples if e["id"] == "punjab-groundwater")
    assert (punjab["variable_id"], punjab["related_variable_id"]) == ("gldas_gws", "gpm_precipitation")


def test_every_example_runs(client):
    """Each one-click case is a valid request end to end (the stories themselves come from real data)."""
    examples = client.get("/api/examples").json()
    for e in examples:
        body = {k: e[k] for k in ("bbox", "variable_id", "start", "end", "deseasonalize")}
        r = client.post("/api/analyses", json=body)
        assert r.status_code == 202, (e["id"], r.text)
        job = client.get(f"/api/analyses/{r.json()['id']}").json()
        assert job["status"] == "done", (e["id"], job["message"])
        assert job["result"]["bbox"] == e["bbox"]


def test_series_variables_need_no_bbox_and_ignore_one(client):
    job = run(client, bbox=None, variable_id="mauna_loa_co2", start="1960-01-01", end="2020-12-31")
    assert job["status"] == "done", job["message"]
    result = job["result"]
    assert result["bbox"] is None and result["variable"]["coverage"] == "series"
    assert result["stats"]["direction"] == "rising" and result["stats"]["significant"]
    assert not any("area you selected" in w for w in result["warnings"])

    with_box = run(client, variable_id="mauna_loa_co2", start="1960-01-01", end="2020-12-31")
    assert with_box["result"]["bbox"] is None
    assert with_box["result"]["series"] == result["series"]
    assert any("area you selected was not used" in w for w in with_box["result"]["warnings"])


def test_area_variables_require_a_bbox(client):
    r = client.post("/api/analyses", json={"variable_id": "gldas_gws", "start": "2004-01-01", "end": "2020-12-31"})
    assert r.status_code == 422 and "bbox" in r.json()["detail"]


def test_live_provider_routes_by_access_and_fails_gracefully(settings):
    from app.main import create_app
    from app.providers.live import LiveProvider

    live = settings.model_copy(update={"data_provider": "live"})
    with TestClient(create_app(live)) as c:
        provider = c.app.state.services.provider
        assert isinstance(provider, LiveProvider)
        catalog = c.app.state.services.catalog
        assert provider.provider_for(catalog.get("gldas_gws")).name == "earthdata"
        assert provider.provider_for(catalog.get("modis_lst_day")).name == "earthdata"
        assert provider.provider_for(catalog.get("noaa_ch4_marine")).name == "noaa_gml"
        assert c.get("/api/health").json()["provider"] == "live"
        # no login and nothing cached: a clear error, never made-up data
        body = {"bbox": PHOENIX, "variable_id": "modis_lst_day", "start": "2005-01-01", "end": "2015-12-31"}
        job = c.get(f"/api/analyses/{c.post('/api/analyses', json=body).json()['id']}").json()
        assert job["status"] == "error" and "Earthdata login" in job["message"]
        # an unreachable NOAA with no cache or seed is an error too
        body = {"variable_id": "mauna_loa_co2", "start": "2005-01-01", "end": "2015-12-31"}
        job = c.get(f"/api/analyses/{c.post('/api/analyses', json=body).json()['id']}").json()
        assert job["status"] == "error" and "Couldn't reach NOAA" in job["message"]


def test_full_analysis_lifecycle(client):
    job = run(client)
    assert job["status"] == "done" and job["progress"] == 1
    result = job["result"]
    assert result["provider"] == "fake" and "synthetic" not in result
    assert result["analyzed_series"] == "deseasonalized"
    assert len(result["series"]) == 20 * 12
    point = result["series"][0]
    assert set(point) == {"date", "value", "deseasonalized", "trend", "ci_low", "ci_high"}
    assert point["ci_low"] < point["trend"] < point["ci_high"]
    stats = result["stats"]
    assert stats["direction"] == "rising" and stats["significant"] is True
    assert stats["percent_change"] is None  # °C is not a ratio scale
    assert stats["slope_per_decade"] == stats["slope_per_year"] * 10
    assert result["summary"].startswith("Rising by")
    assert not any("demo" in w.lower() for w in result["warnings"])

    csv = client.get(f"/api/analyses/{job['id']}/csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0] == "date,value,deseasonalized,trend,ci_low,ci_high" and len(lines) == 20 * 12 + 1


def test_annual_aggregation_and_warnings(client):
    job = run(client, bbox=NORTH_CHINA, variable_id="merra2_so2", aggregation="annual", start="1975-01-01", end="1986-12-31")
    result = job["result"]
    assert job["request"]["deseasonalize"] is False
    assert result["analyzed_series"] == "raw"
    assert [p["date"] for p in result["series"]][:2] == ["1980-01-01", "1981-01-01"]
    warnings = " ".join(result["warnings"])
    assert "Dates were adjusted" in warnings and "years of data" in warnings


def test_unknown_job_and_csv_conflict(client):
    assert client.get("/api/analyses/missing").status_code == 404
    store = client.app.state.services.jobs
    from app.schemas import AnalysisRequest

    pending = store.create(AnalysisRequest(bbox=PHOENIX, variable_id="modis_lst_day", start="2001-01-01", end="2010-01-01"))
    assert client.get(f"/api/analyses/{pending.id}/csv").status_code == 409


def test_validation_errors(client):
    def post(**overrides):
        body = {"bbox": NORTH_CHINA, "variable_id": "merra2_so2", "start": "1990-01-01", "end": "2020-12-31"} | overrides
        return client.post("/api/analyses", json=body)

    bad = post(bbox={"west": 50, "south": 70, "east": 10, "north": 82})
    assert bad.status_code == 422 and isinstance(bad.json()["detail"], str) and "West" in bad.json()["detail"]
    assert post(bbox={"west": 0, "south": 95, "east": 10, "north": 99}).status_code == 422
    assert post(bbox={"west": 0, "south": 10, "east": 0.01, "north": 20}).status_code == 422
    assert post(start="2020-01-01", end="2010-01-01").status_code == 422
    assert post(start="1950-01-01", end="1960-01-01").status_code == 422  # outside availability
    assert post(start="2020-01-01", end="2020-06-01").status_code == 422  # too short
    assert post(alpha=0.9).status_code == 422
    assert post(aggregation="weekly").status_code == 422
    assert post(variable_id="nope").status_code == 404


CSV = "date,value\n" + "\n".join(f"{2000 + i // 12}-{i % 12 + 1:02d}-15,{10 + 0.01 * i + (i % 12) * 0.1}" for i in range(180))


def test_upload_and_analyze_dataset(client):
    r = client.post("/api/datasets", files={"file": ("lake.csv", CSV, "text/csv")}, data={"units": "m"})
    assert r.status_code == 201, r.text
    ds = r.json()
    assert ds["name"] == "lake" and ds["n"] == 180 and ds["start"] == "2000-01-15" and ds["units"] == "m"
    assert [d["id"] for d in client.get("/api/datasets").json()] == [ds["id"]]

    job = run(client, variable_id=f"upload:{ds['id']}", start="1990-01-01", end="2030-01-01")
    assert job["status"] == "done", job["message"]
    result = job["result"]
    assert result["provider"] == "upload" and result["bbox"] is None
    assert result["variable"]["id"] == f"upload:{ds['id']}" and result["variable"]["units"] == "m"
    assert result["stats"]["slope_per_year"] > 0 and result["stats"]["significant"]
    assert result["series"][0]["date"] == "2000-01-01"

    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 204
    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 404
    assert client.post("/api/analyses", json={"bbox": PHOENIX, "variable_id": f"upload:{ds['id']}",
                                              "start": "2000-01-01", "end": "2010-01-01"}).status_code == 404


def test_upload_annual_dataset_without_bbox(client):
    csv = "date,value\n" + "\n".join(f"{1990 + i}-01-01,{i * 0.5}" for i in range(20))
    ds = client.post("/api/datasets", files={"file": ("a.csv", csv)}, data={"name": "Ice days"}).json()
    r = client.post("/api/analyses", json={"variable_id": f"upload:{ds['id']}", "start": "1990-01-01", "end": "2009-12-31"})
    job = client.get(f"/api/analyses/{r.json()['id']}").json()
    assert job["status"] == "done", job["message"]
    assert len(job["result"]["series"]) == 20
    assert any("one value per year" in w for w in job["result"]["warnings"])


def test_bad_csv_returns_422(client):
    for content, needle in [
        ("day,amount\n2000-01-01,1\n", "date,value"),
        ("date,value\n2000-01-01,1\nbanana,2\n2000-03-01,3\n", "Row 3"),
        ("date,value\n2000-01-01,abc\n2000-02-01,2\n2000-03-01,3\n", "not a number"),
        ("date,value\n2000-01-01,1\n", "at least"),
    ]:
        r = client.post("/api/datasets", files={"file": ("x.csv", content)})
        assert r.status_code == 422 and needle in r.json()["detail"], r.text


def test_chat_stub(client):
    body = {"messages": [{"role": "user", "content": "Is this real?"}],
            "context": {"bbox": PHOENIX, "variable_id": "modis_lst_night", "result_summary": "Rising by 0.4 °C per decade."}}
    r = client.post("/api/chat", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["stub"] is True and data["message"]["role"] == "assistant"
    assert "Rising by 0.4" in data["message"]["content"]
    assert client.post("/api/chat", json={"messages": [], "context": {}}).status_code == 422


def test_cors_allows_vite_dev_server(client):
    r = client.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def _upload(client: TestClient, content: str | bytes):
    return client.post("/api/datasets", files={"file": ("x.csv", content, "text/csv")})


def test_upload_year_only_dates_are_years_not_epoch_nanoseconds(client):
    r = _upload(client, "date,value\n" + "\n".join(f"{1990 + i},{i}" for i in range(20)))
    assert r.status_code == 201, r.text
    assert (r.json()["start"], r.json()["end"]) == ("1990-01-01", "2009-01-01")


def test_upload_semicolon_csv_with_decimal_commas(client):
    r = _upload(client, "date;value\n2000-01-01;1,5\n2001-01-01;2,5\n2002-01-01;3\n")
    assert r.status_code == 201, r.text
    ds_id = r.json()["id"]
    assert client.app.state.services.uploads.store.load(ds_id).tolist() == [1.5, 2.5, 3.0]


def test_upload_edge_cases_never_500(client):
    for content, status, needle in [
        ("date,value\n2000-01-01,1\n2001-01-01,inf\n2002-01-01,3\n", 422, "finite"),
        ("date,Date,value\n2000-01-01,2000-01-01,1\n2001-01-01,2001-01-01,2\n2002-01-01,2002-01-01,3\n", 422, "twice"),
        ("", 422, "date,value"),
        ("﻿date,value\n2002-01-01,3\n2000-01-01,1\n2001-01-01,2\n2001-01-01,4\n", 201, None),
        ("date,value\n2000-01-01T00:00+02:00,1\n2001-01-01T00:00-05:00,2\n2002-01-01T00:00Z,3\n", 201, None),
    ]:
        r = _upload(client, content)
        assert r.status_code == status, (content, r.text)
        if needle:
            assert needle in r.json()["detail"]
    ds = r.json()  # mixed UTC offsets keep their local calendar date
    assert (ds["start"], ds["end"], ds["n"]) == ("2000-01-01", "2002-01-01", 3)


def test_list_datasets_skips_unreadable_metadata(client, settings):
    ds = _upload(client, CSV).json()
    (settings.upload_dir / "0123456789ab.json").write_text("{not json", encoding="utf-8")
    r = client.get("/api/datasets")
    assert r.status_code == 200 and [d["id"] for d in r.json()] == [ds["id"]]


def test_trend_tests_ignore_interpolated_values(client):
    # Quarterly data is averaged to months: the two months between samples are interpolated for the chart,
    # but must not count as observations (that would triple n and shrink the p-values).
    csv = "date,value\n" + "\n".join(f"{2000 + q // 4}-{(q % 4) * 3 + 1:02d}-01,{(q * 7) % 5 + 0.1 * q}" for q in range(48))
    ds = _upload(client, csv).json()
    job = run(client, variable_id=f"upload:{ds['id']}", start="2000-01-01", end="2011-12-31", deseasonalize=False)
    assert job["status"] == "done", job["message"]
    assert job["result"]["stats"]["n"] == 48
    assert sum(p["value"] is not None for p in job["result"]["series"]) == 142


def test_unexpected_errors_use_api_error_shape(settings):
    from app.main import create_app

    app = create_app(settings)

    def boom():
        raise RuntimeError("disk on fire")

    app.state.services.uploads.store.list = boom
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/datasets")
    assert r.status_code == 500 and r.json() == {"detail": "Something went wrong on the server. Please try again."}


def test_static_frontend_is_served_with_spa_fallback_when_configured(settings, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>TD</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with TestClient(create_app(settings.model_copy(update={"static_dir": dist}))) as c:
        assert "<title>TD</title>" in c.get("/").text
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert "<title>TD</title>" in c.get("/some/client/route").text
        assert c.get("/api/health").json()["status"] == "ok"
        assert c.get("/api/no-such-endpoint").status_code == 404


def test_static_frontend_is_not_mounted_by_default(client):
    assert client.get("/").status_code == 404
