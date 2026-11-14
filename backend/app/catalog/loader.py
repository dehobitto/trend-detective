"""Load and validate the YAML catalog once at startup."""

from __future__ import annotations

from pathlib import Path

import yaml

from app.catalog.models import CatalogVariable
from app.schemas.common import ExampleCase

CATALOG_DIR = Path(__file__).resolve().parent


class Catalog:
    """In-memory, read-only view of variables.yaml and examples.yaml."""

    def __init__(self, variables: list[CatalogVariable], examples: list[ExampleCase]) -> None:
        self._variables = {v.id: v for v in variables}
        if len(self._variables) != len(variables):
            raise ValueError("Duplicate variable id in catalog")
        self._examples = examples
        self._validate_examples()

    @classmethod
    def from_dir(cls, directory: Path = CATALOG_DIR) -> "Catalog":
        variables = [CatalogVariable.model_validate(v) for v in _read_yaml(directory / "variables.yaml")]
        examples = [ExampleCase.model_validate(e) for e in _read_yaml(directory / "examples.yaml")]
        return cls(variables, examples)

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


def _read_yaml(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, list):
        raise ValueError(f"{path.name} must contain a list")
    return data
