"""Find NASA GIBS imagery layers for the catalog variables (the map time slider's `map_layer` blocks).

    .venv/bin/python -m app.tools.gibs_layers            # discover + verify, print suggested YAML blocks
    .venv/bin/python -m app.tools.gibs_layers --no-verify
    .venv/bin/python -m app.tools.gibs_layers --search no2   # list every layer whose id/title matches

What it does:

1. Downloads the GIBS WMTS GetCapabilities for EPSG:3857 (``best`` imagery).
2. For each catalog variable, walks a curated, ordered list of candidate layers (MONTHLY layers first, then
   8-day/daily) and takes the first that exists in the capabilities and is time-enabled.
3. Reads tile matrix set, format, max zoom (number of tile matrices - 1), time step (period of the
   ``Dimension`` values), time range (earliest start .. latest end) and the horizontal legend URL. GIBS lists
   at most 100 ``Value`` entries per layer in GetCapabilities; for such layers the full time domain is read
   from the WMTS DescribeDomains document instead.
4. Verifies the layer by downloading the four zoom-1 tiles for a date inside both the GIBS range and the
   variable's availability, and requires at least one tile with visible (non-transparent) pixels.

It prints suggestions; copy them into ``app/catalog/variables.yaml`` (the file keeps hand-written comments,
so this script never rewrites it). Variables with no verified candidate, and "series" variables, get ``null``
(no map imagery).
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass

import httpx

CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
DOMAINS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/{layer}/default/{tms}/all/all.xml"
TILE_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tms}/{z}/{y}/{x}.{ext}"
USER_AGENT = "TrendDetective/0.1 (hackathon demo)"
CAPS_VALUE_LIMIT = 100  # GIBS truncates the Dimension value list in GetCapabilities at this many entries

NS = {
    "w": "http://www.opengis.net/wmts/1.0",
    "ows": "http://www.opengis.net/ows/1.1",
    "xlink": "http://www.w3.org/1999/xlink",
}

# Ordered preferences per catalog variable: the first layer present in GetCapabilities wins.
CANDIDATES: dict[str, list[str]] = {
    "viirs_night_lights": ["VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "VIIRS_Black_Marble"],
    "modis_ndvi": ["MODIS_Terra_L3_NDVI_Monthly", "MODIS_Aqua_L3_NDVI_Monthly"],
    # GRACE mascons are total water storage anomalies: the closest GIBS has to GLDAS groundwater / TWS.
    "gldas_gws": ["GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI"],
    "gldas_tws": ["GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI"],
    # No IMERG monthly layer in GIBS: MERRA-2 bias-corrected (observation-corrected) monthly precipitation,
    # then the daily IMERG rate.
    "gpm_precipitation": [
        "IMERG_Precipitation_Rate_Monthly",
        "MERRA2_Precipitation_Bias_Corrected_Monthly",
        "IMERG_Precipitation_Rate",
    ],
    "omi_no2": ["OMI_Nitrogen_Dioxide_Tropo_Column_Monthly", "OMI_Nitrogen_Dioxide_Tropo_Column"],
    "merra2_dust": ["MERRA2_Dust_Surface_Mass_Concentration_Monthly"],
    "merra2_bc": ["MERRA2_Black_Carbon_Surface_Mass_Concentration_Monthly"],
    "merra2_oc": ["MERRA2_Organic_Carbon_Surface_Mass_Concentration_Monthly"],
    # Column (not surface) SO₂, same spatial pattern; its legend is in column units.
    "merra2_so2": ["MERRA2_SO2_Surface_Mass_Concentration_Monthly", "MERRA2_SO2_Column_Mass_Density_Monthly"],
    "merra2_so4": ["MERRA2_SO4_Surface_Mass_Concentration_Monthly"],
    "merra2_aod": [
        "MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly",
        "MERRA2_Aerosol_Optical_Depth_Analysis_Monthly",
    ],
    "merra2_sulfate_aod": ["MERRA2_Sulfate_Aerosol_Optical_Thickness_550nm_Extinction_Monthly"],
    # MOD11C3 = the non-TES MODIS Terra monthly LST layers.
    "modis_lst_day": ["MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day", "MODIS_Terra_L3_Land_Surface_Temp_8Day_Day"],
    "modis_lst_night": [
        "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night",
        "MODIS_Terra_L3_Land_Surface_Temp_8Day_Night",
    ],
}

PERIOD_TO_STEP = {"P1M": "monthly", "P1D": "daily", "P8D": "8day", "P1Y": "yearly"}


@dataclass
class GibsLayer:
    identifier: str
    title: str
    tile_matrix_set: str
    format: str  # "png" | "jpeg"
    max_zoom: int
    intervals: list[str]  # ISO 8601 "start/end/period" strings
    legend_url: str | None
    default: str | None = None  # the Dimension's Default: GIBS's latest date (more reliable than odd intervals)

    @property
    def truncated(self) -> bool:
        return len(self.intervals) >= CAPS_VALUE_LIMIT

    def time_range(self) -> tuple[str, str]:
        starts, ends = zip(*(v.split("/")[:2] for v in self.intervals))
        end = max(e[:10] for e in ends)
        if self.default:
            end = min(end, self.default[:10])
        return min(s[:10] for s in starts), end

    def time_step(self) -> str:
        periods = [v.split("/")[2] for v in self.intervals if v.count("/") == 2]
        # The period of the longest-running interval describes the layer (one-off entries are noise).
        main = max(periods, key=periods.count) if periods else "P1D"
        if self.intervals:
            last = self.intervals[-1].split("/")
            if len(last) == 3 and last[0] != last[1]:
                main = last[2]
        return PERIOD_TO_STEP.get(main, "daily")

    def map_layer(self) -> dict:
        start, end = self.time_range()
        return {
            "kind": "gibs",
            "layer": self.identifier,
            "tile_matrix_set": self.tile_matrix_set,
            "format": self.format,
            "max_zoom": self.max_zoom,
            "time_step": self.time_step(),
            "time_start": start,
            "time_end": end,
            "legend_url": self.legend_url,
        }


def _client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)


def parse_capabilities(xml: bytes) -> dict[str, GibsLayer]:
    root = ET.fromstring(xml)
    contents = root.find("w:Contents", NS)
    levels = {
        t.findtext("ows:Identifier", namespaces=NS): len(t.findall("w:TileMatrix", NS))
        for t in contents.findall("w:TileMatrixSet", NS)
    }
    layers: dict[str, GibsLayer] = {}
    for el in contents.findall("w:Layer", NS):
        ident = el.findtext("ows:Identifier", namespaces=NS)
        dim = el.find("w:Dimension", NS)
        tms = el.findtext("w:TileMatrixSetLink/w:TileMatrixSet", namespaces=NS)
        fmt = (el.findtext("w:Format", namespaces=NS) or "").split("/")[-1]
        if not ident or dim is None or tms is None or fmt not in ("png", "jpeg"):
            continue  # not time-enabled, or vector tiles
        legend = None
        for leg in el.findall("w:Style/w:LegendURL", NS):
            href = leg.get(f"{{{NS['xlink']}}}href")
            if legend is None or "horizontal" in (leg.get(f"{{{NS['xlink']}}}role") or ""):
                legend = href
        layers[ident] = GibsLayer(
            identifier=ident,
            title=el.findtext("ows:Title", namespaces=NS) or "",
            tile_matrix_set=tms,
            format=fmt,
            max_zoom=levels.get(tms, 1) - 1,
            intervals=[v.text for v in dim.findall("w:Value", NS) if v.text],
            legend_url=legend,
            default=dim.findtext("w:Default", namespaces=NS),
        )
    return layers


def full_domain(client: httpx.Client, layer: GibsLayer) -> list[str]:
    """Every time interval of a layer (DescribeDomains), for layers truncated in GetCapabilities."""
    r = client.get(DOMAINS_URL.format(layer=layer.identifier, tms=layer.tile_matrix_set))
    r.raise_for_status()
    match = re.search(r"<Domain>([^<]*)</Domain>", r.text)
    return match.group(1).split(",") if match else layer.intervals


def png_opaque_fraction(data: bytes) -> float:
    """Share of non-transparent pixels in an 8-bit palette/RGB/RGBA PNG (no Pillow needed)."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, trns = 8, b"", None
    width = height = color_type = bit_depth = 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", body[:10])
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    if bit_depth != 8 or color_type not in (0, 2, 3, 4, 6):
        return 1.0  # unusual encoding: trust that a decodable tile has content
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    stride = width * channels
    raw = zlib.decompress(idat)
    prev = bytearray(stride)
    opaque = 0
    for row in range(height):
        f = raw[row * (stride + 1)]
        line = bytearray(raw[row * (stride + 1) + 1:(row + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 1:
                line[i] = (line[i] + a) & 0xFF
            elif f == 2:
                line[i] = (line[i] + b) & 0xFF
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        prev = line
        if color_type == 3:
            alpha = [trns[i] if trns and i < len(trns) else 255 for i in line]
        elif color_type in (4, 6):
            alpha = line[channels - 1::channels]
        else:
            alpha = [255] * width
        opaque += sum(1 for v in alpha if v > 0)
    return opaque / (width * height)


def verify(client: httpx.Client, layer: GibsLayer, date: str) -> tuple[bool, str]:
    """Download the zoom-1 tiles for ``date``; OK when one of them has visible pixels."""
    best = 0.0
    for y in range(2):
        for x in range(2):
            url = TILE_URL.format(
                layer=layer.identifier, time=date, tms=layer.tile_matrix_set, z=1, y=y, x=x, ext=layer.format
            )
            r = client.get(url)
            if r.status_code != 200 or not r.content:
                return False, f"HTTP {r.status_code} for {url}"
            if layer.format == "jpeg":
                return r.content[:2] == b"\xff\xd8", f"{len(r.content)} B jpeg"
            best = max(best, png_opaque_fraction(r.content))
    return best > 0.02, f"{best:.0%} of pixels visible in the best zoom-1 tile for {date}"


def check_date(layer: GibsLayer, available: tuple[str, str] | None) -> str:
    """A month start inside the GIBS range (and the variable's availability), a few years before the end."""
    start, end = layer.time_range()
    if available:
        start, end = max(start, available[0]), min(end, available[1])
    d_end = dt.date.fromisoformat(end)
    d = dt.date(max(d_end.year - 3, int(start[:4])), 7, 1)
    if layer.time_step() == "8day":
        d = dt.date(d.year, 1, 1)  # 8-day composites restart on Jan 1
    return max(d.isoformat(), start)


def discover(verify_tiles: bool = True) -> dict[str, dict | None]:
    from app.catalog import Catalog

    catalog = Catalog.from_dir()
    with _client() as client:
        caps = client.get(CAPABILITIES_URL)
        caps.raise_for_status()
        layers = parse_capabilities(caps.content)
        result: dict[str, dict | None] = {}
        for var in catalog.variables():
            if var.is_series:
                result[var.id] = None
                print(f"# {var.id}: series variable -> map_layer: null", file=sys.stderr)
                continue
            chosen = None
            for ident in CANDIDATES.get(var.id, []):
                layer = layers.get(ident)
                if layer is None:
                    continue
                if layer.truncated:
                    layer.intervals = full_domain(client, layer)
                if verify_tiles:
                    date = check_date(layer, (var.available_start.isoformat(), var.available_end.isoformat()))
                    ok, note = verify(client, layer, date)
                    print(f"# {var.id}: {ident}: {'OK' if ok else 'FAILED'} ({note})", file=sys.stderr)
                    if not ok:
                        continue
                chosen = layer.map_layer()
                break
            result[var.id] = chosen
    return result


def search(term: str) -> None:
    with _client() as client:
        caps = client.get(CAPABILITIES_URL)
        caps.raise_for_status()
    for layer in parse_capabilities(caps.content).values():
        if term.lower() in (layer.identifier + " " + layer.title).lower():
            start, end = layer.time_range()
            print(f"{layer.identifier}\t{layer.time_step()}\t{start}..{end}{' (truncated)' if layer.truncated else ''}"
                  f"\t{layer.title}")


def _yaml_flow(block: dict | None) -> str:
    if block is None:
        return "null"
    parts = [f"{k}: {'null' if v is None else v}" for k, v in block.items()]
    return "{" + ", ".join(parts) + "}"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-verify", action="store_true", help="skip downloading a test tile per layer")
    parser.add_argument("--search", metavar="TEXT", help="list GIBS layers whose id or title contains TEXT")
    args = parser.parse_args(argv)
    if args.search:
        search(args.search)
        return
    for var_id, block in discover(verify_tiles=not args.no_verify).items():
        print(f"{var_id}:\n  map_layer: {_yaml_flow(block)}")


if __name__ == "__main__":
    main()
