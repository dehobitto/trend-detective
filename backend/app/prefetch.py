"""Download the real-data sources into the cache so the demo also works offline.

Run from ``backend/``::

    .venv/bin/python -m app.prefetch            # NOAA GML records + NASA Earthdata for every example case
    .venv/bin/python -m app.prefetch --noaa     # only NOAA (no login needed)
    .venv/bin/python -m app.prefetch --list     # show what would be downloaded

NOAA: the three greenhouse-gas records (``TD_CACHE_DIR/noaa_gml/*.txt``).
Earthdata (needs ``TD_EARTHDATA_TOKEN`` or username/password): each example case's variable and its
"compare with" variable over the example's area, for the variable's whole availability, so any date range
a student picks for that case is served from ``TD_CACHE_DIR/earthdata/`` instantly. Already cached
granules are skipped, so re-running only fetches what is new.
"""

from __future__ import annotations

import argparse
import logging
import time

from app.catalog import Catalog
from app.config import get_settings
from app.providers.base import ProviderError
from app.providers.earthdata import EarthdataProvider
from app.providers.live import ACCESS_TO_PROVIDER
from app.providers.noaa_gml import parse_monthly, prefetch as prefetch_noaa


def earthdata_plan(catalog: Catalog):
    """``[(example id, variable, bbox)]`` for every Earthdata-served variable used by an example case."""
    seen: set[tuple[str, str]] = set()
    plan = []
    for example in catalog.examples():
        if example.bbox is None:
            continue
        for variable_id in filter(None, [example.variable_id, example.related_variable_id]):
            variable = catalog.get(variable_id)
            if variable is None or ACCESS_TO_PROVIDER.get(variable.access.strip().lower()) != "earthdata":
                continue
            key = (variable_id, example.bbox.model_dump_json())
            if key not in seen:
                seen.add(key)
                plan.append((example.id, variable, example.bbox))
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--noaa", action="store_true", help="only the NOAA GML records")
    parser.add_argument("--earthdata", action="store_true", help="only NASA Earthdata")
    parser.add_argument("--list", action="store_true", help="print the plan and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    catalog = Catalog.from_dir()
    plan = earthdata_plan(catalog)

    if args.list:
        print("NOAA GML: mauna_loa_co2, noaa_co2_marine, noaa_ch4_marine")
        for example_id, variable, bbox in plan:
            print(f"Earthdata: {example_id:22s} {variable.id:20s} {variable.available_start}..{variable.available_end} {bbox}")
        return

    if not args.earthdata:
        for cached in prefetch_noaa(settings):
            series = parse_monthly(cached.read_text(encoding="utf-8")).dropna()
            print(f"OK   {cached.name}: {series.index[0]:%Y-%m} .. {series.index[-1]:%Y-%m} ({len(series)} months)")

    if not args.noaa:
        provider = EarthdataProvider(settings)
        if not provider.has_login:
            print("SKIP Earthdata: set TD_EARTHDATA_TOKEN (or TD_EARTHDATA_USERNAME + TD_EARTHDATA_PASSWORD).")
            return
        failed = 0
        for example_id, variable, bbox in plan:
            t0 = time.time()
            try:
                series = provider.fetch(variable, bbox, variable.available_start, variable.available_end)
            except ProviderError as exc:
                failed += 1
                print(f"FAIL {example_id} / {variable.id}: {exc}")
                continue
            valid = series.dropna()
            print(
                f"OK   {example_id} / {variable.id}: {len(valid)}/{len(series)} months with data, "
                f"{time.time() - t0:.0f}s"
            )
        if failed:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
