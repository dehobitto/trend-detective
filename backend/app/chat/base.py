"""ChatBackend interface + registry. The one place to plug in the real field-guide bot."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from app.config import Settings
from app.schemas.chat import ChatRequest, ChatResponse


class ChatBackend(Protocol):
    async def reply(self, request: ChatRequest) -> ChatResponse:
        """Answer the last user message, given the whole conversation and the current map/result context."""
        ...


ChatFactory = Callable[[Settings], ChatBackend]
_REGISTRY: dict[str, ChatFactory] = {}


def register_chat_backend(name: str) -> Callable[[ChatFactory], ChatFactory]:
    def decorator(factory: ChatFactory) -> ChatFactory:
        _REGISTRY[name] = factory
        return factory

    return decorator


def create_chat_backend(name: str, settings: Settings) -> ChatBackend:
    if name not in _REGISTRY:
        raise ValueError(f"Unknown chat backend {name!r} (registered: {', '.join(sorted(_REGISTRY))})")
    return _REGISTRY[name](settings)
