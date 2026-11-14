"""Download the real-data source files into the cache so the demo also works offline.

Run from ``backend/``: ``.venv/bin/python -m app.prefetch``. Today: the three NOAA GML greenhouse-gas
records (``TD_CACHE_DIR/noaa_gml/*.txt``).
"""

from __future__ import annotations

import logging

from app.providers.noaa_gml import parse_monthly, prefetch


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    for cached in prefetch():
        series = parse_monthly(cached.read_text(encoding="utf-8")).dropna()
        print(f"{cached}: {series.index[0]:%Y-%m} .. {series.index[-1]:%Y-%m} ({len(series)} months)")


if __name__ == "__main__":
    main()
