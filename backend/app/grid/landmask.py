"""Cheap land/sea mask for map grids (built once from the frontend's water texture, see tools/build_landmask)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np

LANDMASK_PATH = Path(__file__).resolve().parent.parent / "data" / "landmask.npy"


@lru_cache(maxsize=1)
def _integral() -> np.ndarray:
    """Summed-area table of the (rows=lat from 90°N, cols=lon from 180°W) boolean land mask, zero-padded."""
    land = np.unpackbits(np.load(LANDMASK_PATH), axis=1).astype(np.int32)
    table = np.zeros((land.shape[0] + 1, land.shape[1] + 1), dtype=np.int32)
    table[1:, 1:] = land.cumsum(axis=0).cumsum(axis=1)
    return table


def land_fraction(lat_edges: np.ndarray, lon_edges: np.ndarray) -> np.ndarray:
    """Share of land in each cell of a regular grid.

    ``lat_edges`` run north -> south (len rows+1), ``lon_edges`` west -> east (len cols+1). Returns
    ``(rows, cols)`` floats in [0, 1]. Each cell covers at least one mask pixel (nearest pixel for cells
    finer than the 0.225° mask).
    """
    table = _integral()
    n_rows, n_cols = table.shape[0] - 1, table.shape[1] - 1
    r = (90 - np.asarray(lat_edges, dtype=float)) / 180 * n_rows
    c = (np.asarray(lon_edges, dtype=float) + 180) / 360 * n_cols
    r0, r1 = np.floor(r[:-1] + 1e-9), np.ceil(r[1:] - 1e-9)
    c0, c1 = np.floor(c[:-1] + 1e-9), np.ceil(c[1:] - 1e-9)
    r0 = np.clip(r0, 0, n_rows - 1).astype(int)
    c0 = np.clip(c0, 0, n_cols - 1).astype(int)
    r1 = np.clip(np.maximum(r1, r0 + 1), 1, n_rows).astype(int)
    c1 = np.clip(np.maximum(c1, c0 + 1), 1, n_cols).astype(int)
    total = (
        table[r1[:, None], c1[None, :]] - table[r0[:, None], c1[None, :]]
        - table[r1[:, None], c0[None, :]] + table[r0[:, None], c0[None, :]]
    )
    area = (r1 - r0)[:, None] * (c1 - c0)[None, :]
    return total / area


def is_land(lat: float, lon: float) -> bool:
    """Land at one point (nearest mask pixel)."""
    eps = 1e-6
    return bool(land_fraction(np.array([lat + eps, lat - eps]), np.array([lon - eps, lon + eps]))[0, 0] >= 0.5)
