import shutil

import pytest
import yaml

from app.catalog import Catalog
from app.catalog.loader import CATALOG_DIR


def _catalog_with_examples(tmp_path, examples):
    shutil.copy(CATALOG_DIR / "variables.yaml", tmp_path / "variables.yaml")
    shutil.copy(CATALOG_DIR / "colormaps.yaml", tmp_path / "colormaps.yaml")
    (tmp_path / "examples.yaml").write_text(yaml.safe_dump(examples), encoding="utf-8")
    return Catalog.from_dir(tmp_path)


BASE = {"id": "x", "title": "T", "question": "Q?", "start": "2005-01-01", "end": "2015-12-31",
        "deseasonalize": True, "center": {"lat": 0, "lon": 0}}


def test_series_examples_may_omit_the_bbox(tmp_path):
    catalog = _catalog_with_examples(tmp_path, [BASE | {"bbox": None, "variable_id": "noaa_ch4_marine"}])
    assert catalog.examples()[0].related_variable_id is None and catalog.examples()[0].takeaway is None


def test_area_examples_need_a_bbox_and_known_related_variable(tmp_path):
    with pytest.raises(ValueError, match="needs a bbox"):
        _catalog_with_examples(tmp_path, [BASE | {"bbox": None, "variable_id": "gldas_gws"}])
    box = {"west": 0, "south": 0, "east": 5, "north": 5}
    with pytest.raises(ValueError, match="related variable"):
        _catalog_with_examples(tmp_path, [BASE | {"bbox": box, "variable_id": "gldas_gws", "related_variable_id": "nope"}])


def test_only_series_variables_have_a_location():
    catalog = Catalog.from_dir()
    for v in catalog.variables():
        assert (v.location is not None) == (v.id == "mauna_loa_co2")
        assert v.synthetic is not None and (v.synthetic.curve is not None) == v.is_series


def test_map_layers_and_colormaps():
    catalog = Catalog.from_dir()
    for v in catalog.variables():
        layer = v.public().map_layer
        if v.is_series:
            assert layer is None and v.colormap is None
            continue
        assert layer is not None and v.colormap is not None
        assert 6 <= len(catalog.colormap(v.colormap)) <= 9
        if layer.kind == "gibs":
            assert layer.time_start < layer.time_end and layer.format in ("png", "jpeg") and layer.max_zoom >= 3
            assert layer.legend_url is None or layer.legend_url.startswith("https://gibs.earthdata.nasa.gov/")
    kinds = {v.id: v.public().map_layer.kind for v in catalog.variables() if not v.is_series}
    assert kinds["modis_lst_day"] == "gibs" and kinds["merra2_bc"] == "grid"
