"""Data providers. Importing this package registers the built-in providers."""

from app.providers import appeears, earthdata, knmi, live, noaa_gml, synthetic  # noqa: F401  (registration side effects)
from app.providers.base import (
    DataProvider,
    ProviderError,
    Route,
    create_provider,
    register_provider,
    registered_providers,
    route_for,
)
from app.providers.upload import InvalidCSV, UploadProvider, UploadStore, dataset_variable

__all__ = [
    "DataProvider", "InvalidCSV", "ProviderError", "Route", "UploadProvider", "UploadStore",
    "create_provider", "dataset_variable", "register_provider", "registered_providers", "route_for",
]
