"""Canned field-guide replies until the real chatbot is plugged in."""

from __future__ import annotations

from app.config import Settings
from app.chat.base import register_chat_backend
from app.schemas.chat import ChatMessage, ChatRequest, ChatResponse


class StubChatBackend:
    """Friendly placeholder that echoes what the student is looking at."""

    async def reply(self, request: ChatRequest) -> ChatResponse:
        ctx = request.context
        parts = ["I'm the field guide, still in training, so I can't answer freely yet."]
        if ctx.result_summary:
            parts.append(f'Your latest result says: "{ctx.result_summary}"')
            parts.append(
                "A good next step: check whether the trend still holds with the seasonal cycle removed, "
                "or try a neighboring region to see if it is local or widespread."
            )
        elif ctx.variable_id or ctx.bbox:
            where = ""
            if ctx.bbox:
                lat = (ctx.bbox.south + ctx.bbox.north) / 2
                lon = (ctx.bbox.west + ctx.bbox.east) / 2
                where = f" around {abs(lat):.1f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.1f}°{'E' if lon >= 0 else 'W'}"
            what = f" {ctx.variable_id}" if ctx.variable_id else ""
            parts.append(f"You're investigating{what}{where}. Press \"Run analysis\" and I'll help you read the result.")
        else:
            parts.append("Draw an area on the map and pick a variable, then run an analysis to start investigating.")
        return ChatResponse(message=ChatMessage(role="assistant", content=" ".join(parts)), stub=True)


@register_chat_backend("stub")
def _factory(settings: Settings) -> StubChatBackend:
    return StubChatBackend()
