"""The committed real-data seed: downloaded NASA area means for the example cases, shipped with the code.

The cache (``TD_CACHE_DIR``) is gitignored and empty on a fresh deploy, so the first click on an example
would wait minutes for NASA. At startup :func:`install` copies the seed into the cache (never overwriting
newer cached files), so examples answer at once and without any network.

Refresh the seed after ``python -m app.prefetch``::

    .venv/bin/python -m app.prefetch --save-seed
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

PARTS = ("earthdata", "appeears", "blackmarble")
"""Cache subfolders that hold slow-to-get NASA data. NOAA has its own seed (``seed/noaa_gml``)."""


def _files(root: Path):
    for part in PARTS:
        base = root / part
        if base.is_dir():
            yield from (p for p in sorted(base.rglob("*.json")) if ".tmp" not in p.name)


def install(seed_dir: Path | None, cache_dir: Path) -> int:
    """Copy seed files the cache lacks. Returns how many were copied."""
    if seed_dir is None or not seed_dir.is_dir():
        return 0
    copied = 0
    for src in _files(seed_dir):
        dst = cache_dir / src.relative_to(seed_dir)
        if dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        copied += 1
    if copied:
        log.info("Installed %d real-data seed files into %s", copied, cache_dir)
    return copied


def _worth_keeping(path: Path) -> bool:
    """AppEEARS state files are only useful once they hold values (a bare task id expires on NASA's side)."""
    if "appeears" not in path.parts:
        return True
    try:
        return "values" in json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False


def export(cache_dir: Path, seed_dir: Path) -> int:
    """Copy the cache's NASA files into the seed folder (to be committed). Returns how many were written."""
    written = 0
    for src in _files(cache_dir):
        if not _worth_keeping(src):
            continue
        dst = seed_dir / src.relative_to(cache_dir)
        if dst.exists() and dst.read_bytes() == src.read_bytes():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        written += 1
    return written
