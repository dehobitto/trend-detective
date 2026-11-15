"""The committed real-data seed is copied into an empty cache at startup, never over newer files."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app import seed
from app.main import create_app


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_install_copies_missing_files_only(tmp_path):
    seed_dir, cache = tmp_path / "seed", tmp_path / "cache"
    _write(seed_dir / "earthdata" / "X" / "values" / "a.json", {"2001-01-01": 1.0})
    _write(seed_dir / "earthdata" / "X" / "values" / "b.json", {"2001-01-01": 2.0})
    _write(cache / "earthdata" / "X" / "values" / "b.json", {"2001-01-01": 9.0})  # newer local copy

    assert seed.install(seed_dir, cache) == 1
    assert json.loads((cache / "earthdata" / "X" / "values" / "a.json").read_text()) == {"2001-01-01": 1.0}
    assert json.loads((cache / "earthdata" / "X" / "values" / "b.json").read_text()) == {"2001-01-01": 9.0}
    assert seed.install(seed_dir, cache) == 0
    assert seed.install(None, cache) == 0


def test_export_skips_appeears_tasks_without_values(tmp_path):
    cache, seed_dir = tmp_path / "cache", tmp_path / "seed"
    _write(cache / "appeears" / "pending.json", {"task_id": "T1"})
    _write(cache / "appeears" / "done.json", {"task_id": "T2", "values": {"2001-01-01": 300.0}})
    _write(cache / "earthdata" / "X" / "layout.json", {"f": {}})

    assert seed.export(cache, seed_dir) == 2
    assert not (seed_dir / "appeears" / "pending.json").exists()
    assert (seed_dir / "appeears" / "done.json").exists() and (seed_dir / "earthdata" / "X" / "layout.json").exists()
    assert seed.export(cache, seed_dir) == 0  # unchanged files are not rewritten


def test_app_startup_installs_the_seed(settings, tmp_path):
    seed_dir = tmp_path / "seed"
    _write(seed_dir / "earthdata" / "X" / "values" / "a.json", {})
    with TestClient(create_app(settings.model_copy(update={"cache_seed_dir": seed_dir}))):
        pass
    assert (settings.cache_dir / "earthdata" / "X" / "values" / "a.json").exists()
