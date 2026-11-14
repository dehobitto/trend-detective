from fastapi.testclient import TestClient

ARCTIC = {"west": 10, "south": 70, "east": 60, "north": 82}


def run(client: TestClient, **overrides) -> dict:
    body = {"bbox": ARCTIC, "variable_id": "merra2_t2m", "start": "1990-01-01", "end": "2020-12-31"} | overrides
    r = client.post("/api/analyses", json=body)
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["status"] == "queued" and job["result"] is None
    return client.get(f"/api/analyses/{job['id']}").json()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "provider": "synthetic", "version": "0.1.0"}


def test_variables_and_examples(client):
    variables = client.get("/api/variables").json()
    assert len(variables) >= 12
    assert {"synthetic", "ratio_scale"}.isdisjoint(variables[0])  # internal fields are not exposed
    assert {v["sphere"] for v in variables} == {"atmosphere", "land", "ocean", "water"}
    assert client.get("/api/variables/merra2_t2m").json()["units"] == "°C"
    assert client.get("/api/variables/nope").status_code == 404
    examples = client.get("/api/examples").json()
    assert len(examples) >= 5
    ids = {v["id"] for v in variables}
    assert all(e["variable_id"] in ids and "center" in e for e in examples)


def test_full_analysis_lifecycle(client):
    job = run(client)
    assert job["status"] == "done" and job["progress"] == 1
    result = job["result"]
    assert result["synthetic"] is True and result["provider"] == "synthetic"
    assert result["analyzed_series"] == "deseasonalized"
    assert len(result["series"]) == 31 * 12
    point = result["series"][0]
    assert set(point) == {"date", "value", "deseasonalized", "trend", "ci_low", "ci_high"}
    assert point["ci_low"] < point["trend"] < point["ci_high"]
    stats = result["stats"]
    assert stats["direction"] == "rising" and stats["significant"] is True
    assert stats["percent_change"] is None  # °C is not a ratio scale
    assert stats["slope_per_decade"] == stats["slope_per_year"] * 10
    assert result["summary"].startswith("Rising by")
    assert any("Demo data" in w for w in result["warnings"])

    csv = client.get(f"/api/analyses/{job['id']}/csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0] == "date,value,deseasonalized,trend,ci_low,ci_high" and len(lines) == 31 * 12 + 1


def test_annual_aggregation_and_warnings(client):
    job = run(client, aggregation="annual", start="1975-01-01", end="1986-12-31")
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

    pending = store.create(AnalysisRequest(bbox=ARCTIC, variable_id="merra2_t2m", start="2000-01-01", end="2010-01-01"))
    assert client.get(f"/api/analyses/{pending.id}/csv").status_code == 409


def test_validation_errors(client):
    def post(**overrides):
        body = {"bbox": ARCTIC, "variable_id": "merra2_t2m", "start": "1990-01-01", "end": "2020-12-31"} | overrides
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
    assert result["provider"] == "upload" and result["synthetic"] is False and result["bbox"] is None
    assert result["variable"]["id"] == f"upload:{ds['id']}" and result["variable"]["units"] == "m"
    assert result["stats"]["slope_per_year"] > 0 and result["stats"]["significant"]
    assert result["series"][0]["date"] == "2000-01-01"

    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 204
    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 404
    assert client.post("/api/analyses", json={"bbox": ARCTIC, "variable_id": f"upload:{ds['id']}",
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
            "context": {"bbox": ARCTIC, "variable_id": "merra2_t2m", "result_summary": "Rising by 0.4 °C per decade."}}
    r = client.post("/api/chat", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["stub"] is True and data["message"]["role"] == "assistant"
    assert "Rising by 0.4" in data["message"]["content"]
    assert client.post("/api/chat", json={"messages": [], "context": {}}).status_code == 422


def test_cors_allows_vite_dev_server(client):
    r = client.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
