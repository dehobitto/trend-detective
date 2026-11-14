from fastapi import APIRouter

from app.api import analyses, catalog, chat, datasets, health

api_router = APIRouter(prefix="/api")
for module in (health, catalog, analyses, datasets, chat):
    api_router.include_router(module.router)

__all__ = ["api_router"]
