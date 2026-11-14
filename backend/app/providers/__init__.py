"""Data providers. Importing this package registers the built-in providers."""

from app.providers import nasa_giovanni, synthetic  # noqa: F401  (registration side effects)
from app.providers.base import (
    DataProvider,
    ProviderError,
    create_provider,
    register_provider,
    registered_providers,
)
from app.providers.upload import InvalidCSV, UploadProvider, UploadStore, dataset_variable

__all__ = [
    "DataProvider", "InvalidCSV", "ProviderError", "UploadProvider", "UploadStore",
    "create_provider", "dataset_variable", "register_provider", "registered_providers",
]
