from fastapi import APIRouter

from app.api import analyses, catalog, chat, datasets, geocode, health

api_router = APIRouter(prefix="/api")
for module in (health, catalog, analyses, datasets, chat, geocode):
    api_router.include_router(module.router)

__all__ = ["api_router"]
