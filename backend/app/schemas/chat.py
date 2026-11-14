"""Field-guide chat models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import BBox


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatContext(BaseModel):
    bbox: BBox | None = None
    variable_id: str | None = None
    result_summary: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    context: ChatContext = Field(default_factory=ChatContext)


class ChatResponse(BaseModel):
    message: ChatMessage
    stub: bool
