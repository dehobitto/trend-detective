"""Field-guide chat. Importing this package registers the built-in backends."""

from app.chat import fieldguide, stub  # noqa: F401  (registration side effect)
from app.chat.base import ChatBackend, create_chat_backend, register_chat_backend
from app.chat.fieldguide import FieldGuideChatBackend
from app.chat.stub import StubChatBackend

__all__ = ["ChatBackend", "FieldGuideChatBackend", "StubChatBackend", "create_chat_backend", "register_chat_backend"]
