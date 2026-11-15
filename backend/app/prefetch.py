"""Download the real-data sources into the cache so the demo also works offline.

Run from ``backend/``::

    .venv/bin/python -m app.prefetch              # NOAA + GES DISC (Earthdata) + AppEEARS for every example case
    .venv/bin/python -m app.prefetch --noaa       # only NOAA (no login needed)
    .venv/bin/python -m app.prefetch --earthdata  # only GES DISC + LAADS (night lights) via OPeNDAP
    .venv/bin/python -m app.prefetch --appeears   # only AppEEARS (MODIS LST, NDVI)
    .venv/bin/python -m app.prefetch --list       # show what would be downloaded

NOAA: the three greenhouse-gas records (``TD_CACHE_DIR/noaa_gml/*.txt``).
Earthdata (needs ``TD_EARTHDATA_TOKEN`` or username/password): each example case's variable and its
"compare with" variable over the example's area, for the variable's whole availability, so any date range
a student picks for that case is served from ``TD_CACHE_DIR/earthdata/`` instantly. Already cached
granules are skipped, so re-running only fetches what is new.
AppEEARS (needs ``TD_EARTHDATA_USERNAME`` + ``TD_EARTHDATA_PASSWORD``): one area task per example area is
submitted at once, then polled until all are done (``--wait`` minutes, default 60); interrupted runs resume
the same tasks.
"""

from __future__ import annotations

import argparse
import logging
import time

from app.catalog import Catalog
from app.config import get_settings
from app.providers.appeears import AppeearsProvider, TaskPending
from app.providers.base import ProviderError
from app.providers.blackmarble import BlackMarbleProvider
from app.providers.earthdata import EarthdataProvider
from app.providers.live import ACCESS_TO_PROVIDER
from app.providers.noaa_gml import parse_monthly, prefetch as prefetch_noaa


def plan_for(catalog: Catalog, source: str):
    """``[(example id, variable, bbox)]`` for every variable of ``source`` used by an example case."""
    seen: set[tuple[str, str]] = set()
    plan = []
    for example in catalog.examples():
        if example.bbox is None:
            continue
        for variable_id in filter(None, [example.variable_id, example.related_variable_id]):
            variable = catalog.get(variable_id)
            if variable is None or ACCESS_TO_PROVIDER.get(variable.access.strip().lower()) != source:
                continue
            key = (variable_id, example.bbox.model_dump_json())
            if key not in seen:
                seen.add(key)
                plan.append((example.id, variable, example.bbox))
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--noaa", action="store_true", help="only the NOAA GML records")
    parser.add_argument("--earthdata", action="store_true", help="only GES DISC via OPeNDAP")
    parser.add_argument("--appeears", action="store_true", help="only AppEEARS")
    parser.add_argument("--wait", type=float, default=60, help="minutes to wait for AppEEARS tasks (default 60)")
    parser.add_argument("--list", action="store_true", help="print the plan and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    catalog = Catalog.from_dir()
    plan = [(e, v, b, "earthdata") for e, v, b in plan_for(catalog, "earthdata")]
    plan += [(e, v, b, "blackmarble") for e, v, b in plan_for(catalog, "blackmarble")]
    modis = plan_for(catalog, "appeears")
    only = [name for name in ("noaa", "earthdata", "appeears") if getattr(args, name)]
    wanted = set(only) or {"noaa", "earthdata", "appeears"}

    if args.list:
        print("NOAA GML: mauna_loa_co2, noaa_co2_marine, noaa_ch4_marine")
        items = [(src, e, v, b) for e, v, b, src in plan] + [("appeears", e, v, b) for e, v, b in modis]
        for source, example_id, variable, bbox in items:
            print(f"{source:11s} {example_id:22s} {variable.id:20s} {variable.available_start}..{variable.available_end} {bbox}")
        return

    failed = 0
    if "noaa" in wanted:
        for cached in prefetch_noaa(settings):
            series = parse_monthly(cached.read_text(encoding="utf-8")).dropna()
            print(f"OK   {cached.name}: {series.index[0]:%Y-%m} .. {series.index[-1]:%Y-%m} ({len(series)} months)")

    if "appeears" in wanted:  # submit first: AppEEARS works on the tasks while we download from GES DISC
        appeears = AppeearsProvider(settings)
        if not appeears.has_login:
            print("SKIP AppEEARS: set TD_EARTHDATA_USERNAME + TD_EARTHDATA_PASSWORD.")
            modis = []
        started = []
        for example_id, variable, bbox in modis:
            try:
                print(f"AppEEARS {example_id} / {variable.id}: {appeears.start(variable, bbox)}")
                started.append((example_id, variable, bbox))
            except ProviderError as exc:
                failed += 1
                print(f"FAIL {example_id} / {variable.id}: {exc}")
        modis = started
    else:
        modis = []

    if "earthdata" in wanted:
        providers = {"earthdata": EarthdataProvider(settings), "blackmarble": BlackMarbleProvider(settings)}
        if not providers["earthdata"].has_login:
            print("SKIP Earthdata: set TD_EARTHDATA_TOKEN (or TD_EARTHDATA_USERNAME + TD_EARTHDATA_PASSWORD).")
            plan = []
        for example_id, variable, bbox, source in plan:
            t0 = time.time()
            try:
                series = providers[source].fetch(variable, bbox, variable.available_start, variable.available_end)
            except ProviderError as exc:
                failed += 1
                print(f"FAIL {example_id} / {variable.id}: {exc}")
                continue
            valid = series.dropna()
            print(
                f"OK   {example_id} / {variable.id}: {len(valid)}/{len(series)} months with data, "
                f"{time.time() - t0:.0f}s"
            )

    pending = list(modis)
    deadline = time.time() + args.wait * 60
    while pending:
        still = []
        for example_id, variable, bbox in pending:
            try:
                series = appeears.area_series(variable, bbox, wait=0)
                print(f"OK   {example_id} / {variable.id}: {len(series)} dates")
            except TaskPending:
                still.append((example_id, variable, bbox))
            except ProviderError as exc:
                failed += 1
                print(f"FAIL {example_id} / {variable.id}: {exc}")
        pending = still
        if pending:
            if time.time() > deadline:
                print(f"AppEEARS still preparing {len(pending)} area(s); run the same command again later to collect them.")
                failed += len(pending)
                break
            print(f"... waiting for {len(pending)} AppEEARS task(s)")
            time.sleep(30)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
