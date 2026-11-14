from fastapi import APIRouter

from app.api import analyses, catalog, chat, datasets, geocode, grid, health

api_router = APIRouter(prefix="/api")
for module in (health, catalog, analyses, datasets, chat, grid, geocode):
    api_router.include_router(module.router)

__all__ = ["api_router"]
