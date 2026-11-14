"""User-uploaded CSV datasets (``date,value``), stored on disk, analyzed with the same pipeline.

Each dataset is two files in ``TD_UPLOAD_DIR``: ``<id>.csv`` (normalized ``date,value``) and
``<id>.json`` (the ``Dataset`` metadata).
"""

from __future__ import annotations

import datetime as dt
import io
import re
import threading
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.processing.timeseries import infer_frequency, to_monthly
from app.providers.base import ProviderError
from app.schemas.analysis import UPLOAD_PREFIX
from app.schemas.common import BBox
from app.schemas.dataset import Dataset

MIN_ROWS = 3
_ID_RE = re.compile(r"^[a-f0-9]{12}$")


class InvalidCSV(ValueError):
    """The uploaded file could not be understood; the message is shown to the user."""


def parse_csv(content: bytes) -> pd.Series:
    """Parse ``date,value`` CSV bytes into a sorted float Series (duplicate dates averaged)."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise InvalidCSV("The file is not UTF-8 text. Save it as a plain CSV file and try again.") from None
    header = next((line for line in text.splitlines() if line.strip()), "")
    sep = ";" if ";" in header and "," not in header else ","  # European spreadsheets: "date;value", "1,5"
    try:
        # Read everything as text: otherwise year-only dates ("2001") become integers that
        # to_datetime would read as nanoseconds since 1970.
        df = pd.read_csv(io.StringIO(text), sep=sep, skipinitialspace=True, dtype=str)
    except (pd.errors.ParserError, pd.errors.EmptyDataError):
        raise InvalidCSV("The file could not be read as CSV. Expected a header row 'date,value'.") from None
    df.columns = [str(c).strip().lower() for c in df.columns]
    if not {"date", "value"} <= set(df.columns):
        raise InvalidCSV(f"Missing columns: the header must be 'date,value' (found: {', '.join(df.columns)}).")
    if df.columns.duplicated().any():
        raise InvalidCSV("The header has the same column name twice. Keep one 'date' and one 'value' column.")
    dates = _parse_dates(df["date"])
    raw_values = df["value"].str.replace(",", ".", regex=False) if sep == ";" else df["value"]
    values = pd.to_numeric(raw_values, errors="coerce")
    bad_dates = dates.isna() & df["date"].notna()
    if bad_dates.any():
        row = int(bad_dates.idxmax()) + 2  # +1 header, +1 one-based
        raise InvalidCSV(f"Row {row}: could not read the date {df['date'][row - 2]!r}. Use YYYY-MM-DD.")
    bad_values = values.isna() & df["value"].notna() & (df["value"].astype(str).str.strip() != "")
    if bad_values.any():
        row = int(bad_values.idxmax()) + 2
        raise InvalidCSV(f"Row {row}: the value {df['value'][row - 2]!r} is not a number.")
    infinite = np.isinf(values)
    if infinite.any():
        row = int(infinite.idxmax()) + 2
        raise InvalidCSV(f"Row {row}: the value {df['value'][row - 2]!r} is not a finite number.")
    series = pd.Series(values.to_numpy(dtype=float), index=pd.DatetimeIndex(dates)).dropna()
    series = series[series.index.notna()]
    series = series.groupby(level=0).mean().sort_index()
    if len(series) < MIN_ROWS:
        raise InvalidCSV(f"Need at least {MIN_ROWS} rows with a date and a numeric value.")
    return series


def _parse_dates(column: pd.Series) -> pd.Series:
    """Parse date strings to naive timestamps (NaT where unreadable), keeping local wall time for time zones."""
    try:
        dates = pd.to_datetime(column, errors="coerce", format="mixed")
    except ValueError:  # mixed UTC offsets
        dates = pd.to_datetime(column.map(_naive_timestamp), errors="coerce")
    if dates.dt.tz is not None:
        dates = dates.dt.tz_localize(None)
    return dates


def _naive_timestamp(value: object) -> pd.Timestamp:
    try:
        stamp = pd.Timestamp(value)
    except (ValueError, TypeError):
        return pd.NaT
    return stamp.tz_localize(None) if stamp.tzinfo is not None else stamp


class UploadStore:
    """Filesystem-backed dataset store (thread-safe for this single-process app)."""

    def __init__(self, directory: Path) -> None:
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def save(self, content: bytes, name: str | None, units: str | None, filename: str | None) -> Dataset:
        series = parse_csv(content)
        ds_id = uuid.uuid4().hex[:12]
        default_name = Path(filename).stem if filename else "My dataset"
        dataset = Dataset(
            id=ds_id,
            name=(name or "").strip() or default_name,
            units=(units or "").strip(),
            n=len(series),
            start=series.index[0].date(),
            end=series.index[-1].date(),
            created_at=dt.datetime.now(dt.UTC),
        )
        with self._lock:
            series.rename("value").rename_axis("date").to_csv(self._csv(ds_id), date_format="%Y-%m-%d")
            tmp = self._meta(ds_id).with_suffix(".json.tmp")  # atomic: readers never see a half-written file
            tmp.write_text(dataset.model_dump_json(), encoding="utf-8")
            tmp.replace(self._meta(ds_id))
        return dataset

    def list(self) -> list[Dataset]:
        items = []
        for path in self.dir.glob("*.json"):
            try:
                items.append(Dataset.model_validate_json(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):  # deleted meanwhile, or not one of ours
                continue
        return sorted(items, key=lambda d: d.created_at, reverse=True)

    def get(self, ds_id: str) -> Dataset | None:
        if not _ID_RE.match(ds_id) or not self._meta(ds_id).exists():
            return None
        return Dataset.model_validate_json(self._meta(ds_id).read_text(encoding="utf-8"))

    def delete(self, ds_id: str) -> bool:
        if self.get(ds_id) is None:
            return False
        with self._lock:
            self._csv(ds_id).unlink(missing_ok=True)
            self._meta(ds_id).unlink(missing_ok=True)
        return True

    def load(self, ds_id: str) -> pd.Series:
        if self.get(ds_id) is None:
            raise ProviderError("This dataset no longer exists. Upload it again.")
        df = pd.read_csv(self._csv(ds_id), parse_dates=["date"])
        return pd.Series(df["value"].to_numpy(dtype=float), index=pd.DatetimeIndex(df["date"]))

    def _csv(self, ds_id: str) -> Path:
        return self.dir / f"{ds_id}.csv"

    def _meta(self, ds_id: str) -> Path:
        return self.dir / f"{ds_id}.json"


def dataset_variable(dataset: Dataset, frequency: str) -> CatalogVariable:
    """Synthesize a catalog Variable describing an uploaded dataset."""
    return CatalogVariable(
        id=f"{UPLOAD_PREFIX}{dataset.id}",
        name=dataset.name,
        short_definition="A dataset you uploaded as a CSV file.",
        why_it_matters="Analyzing your own measurements with the same tests lets you compare them with NASA data.",
        units=dataset.units,
        sphere="land",
        source="Uploaded CSV",
        mission_or_model="Your data",
        product=f"{dataset.name}.csv",
        temporal_resolution="daily" if frequency == "daily" else "monthly",
        available_start=dataset.start,
        available_end=dataset.end,
        coverage="global",
    )


class UploadProvider:
    """Serves uploaded datasets. Monthly or finer data is averaged to months; annual data is kept as is."""

    name = "upload"
    synthetic = False
    local = True

    def __init__(self, store: UploadStore) -> None:
        self.store = store

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        ds_id = variable.id.removeprefix(UPLOAD_PREFIX)
        series = self.store.load(ds_id)
        if infer_frequency(series.index) == "annual":
            series.index = pd.DatetimeIndex([pd.Timestamp(year=ts.year, month=1, day=1) for ts in series.index])
            series = series.groupby(level=0).mean()
            return series.loc[pd.Timestamp(year=start.year, month=1, day=1):pd.Timestamp(end)]
        series = to_monthly(series)
        return series.loc[pd.Timestamp(start).replace(day=1):pd.Timestamp(end)]
