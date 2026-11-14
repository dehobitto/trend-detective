"""Load and validate the YAML catalog once at startup."""

from __future__ import annotations

from pathlib import Path

import yaml

from app.catalog.models import CatalogVariable
from app.schemas.common import ExampleCase

CATALOG_DIR = Path(__file__).resolve().parent


class Catalog:
    """In-memory, read-only view of variables.yaml and examples.yaml."""

    def __init__(
        self,
        variables: list[CatalogVariable],
        examples: list[ExampleCase],
        colormaps: dict[str, list[tuple[float, str]]] | None = None,
    ) -> None:
        self._variables = {v.id: v for v in variables}
        if len(self._variables) != len(variables):
            raise ValueError("Duplicate variable id in catalog")
        self._examples = examples
        self._colormaps = colormaps or {}
        self._validate_examples()
        self._validate_colormaps()

    @classmethod
    def from_dir(cls, directory: Path = CATALOG_DIR) -> "Catalog":
        variables = [CatalogVariable.model_validate(v) for v in _read_yaml(directory / "variables.yaml")]
        examples = [ExampleCase.model_validate(e) for e in _read_yaml(directory / "examples.yaml")]
        with (directory / "colormaps.yaml").open(encoding="utf-8") as fh:
            colormaps = {name: [(float(p), str(c)) for p, c in stops] for name, stops in yaml.safe_load(fh).items()}
        return cls(variables, examples, colormaps)

    def colormap(self, name: str) -> list[tuple[float, str]]:
        """Stops ``[(position 0..1, hex)]`` of a named colormap."""
        return self._colormaps[name]

    def _validate_colormaps(self) -> None:
        for name, stops in self._colormaps.items():
            positions = [p for p, _ in stops]
            if not 6 <= len(stops) <= 9 or positions != sorted(positions) or positions[0] != 0 or positions[-1] != 1:
                raise ValueError(f"Colormap {name!r} needs 6-9 ascending stops from 0 to 1")
        for var in self._variables.values():
            if not var.is_series and (var.map_layer is None or var.colormap is None):
                raise ValueError(f"{var.id}: area variables need a map_layer ({{kind: grid}} at least) and a colormap")
            if var.colormap is not None and var.colormap not in self._colormaps:
                raise ValueError(f"{var.id}: unknown colormap {var.colormap!r}")

    def variables(self) -> list[CatalogVariable]:
        return list(self._variables.values())

    def get(self, variable_id: str) -> CatalogVariable | None:
        return self._variables.get(variable_id)

    def examples(self) -> list[ExampleCase]:
        return list(self._examples)

    def _validate_examples(self) -> None:
        for ex in self._examples:
            var = self.get(ex.variable_id)
            if var is None:
                raise ValueError(f"Example {ex.id!r} references unknown variable {ex.variable_id!r}")
            if ex.start < var.available_start or ex.end > var.available_end:
                raise ValueError(f"Example {ex.id!r} dates fall outside {var.id} availability")
            if ex.bbox is None and not var.is_series:
                raise ValueError(f"Example {ex.id!r} needs a bbox: {var.id} is not a 'series' variable")
            if ex.related_variable_id is not None and self.get(ex.related_variable_id) is None:
                raise ValueError(f"Example {ex.id!r} references unknown related variable {ex.related_variable_id!r}")


def _read_yaml(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, list):
        raise ValueError(f"{path.name} must contain a list")
    return data
