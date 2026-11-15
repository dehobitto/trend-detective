"""LLM field guide: answers students' questions with the catalog and their current map/result as context.

Start with ``TD_CHAT_BACKEND=fieldguide``. Provider: ``TD_CHAT_PROVIDER`` = ``openai`` (default) or ``gemini``
(free key at https://aistudio.google.com/apikey); key in ``OPENAI_API_KEY`` / ``GEMINI_API_KEY``. Without a key
the app falls back to the stub so it still starts.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import HTTPException

from app.catalog import Catalog
from app.chat.base import register_chat_backend
from app.chat.stub import StubChatBackend
from app.config import Settings
from app.processing.summary import UNITLESS
from app.schemas.chat import ChatContext, ChatMessage, ChatRequest, ChatResponse

log = logging.getLogger(__name__)

DEFAULT_MODELS = {"openai": "gpt-5-mini", "gemini": "gemini-flash-latest"}
MAX_MESSAGES = 21
"""Last messages sent to the model (odd, so the window starts on a student message)."""

Completion = Callable[[str, list[ChatMessage]], Awaitable[str]]
"""(system prompt, conversation) -> answer text."""

_ROLE = """You are the field guide inside Trend Detective, a NASA Space Apps Challenge app where students pick an \
area on a map and an Earth-science variable, and the app tests whether it has a real long-term trend, using NASA \
satellite and model data (and NOAA records for greenhouse gases).

Your audience: high school / college students and the scientifically curious public.

How to answer:
- Simple English, short paragraphs, everyday analogies. Define any jargon you use.
- Keep answers under ~150 words unless the student asks for more detail. No markdown headings or tables; \
plain sentences, with an occasional short list.
- About results, use ONLY the numbers in "What the student is looking at". Never invent statistics, dates or \
values. If there is no result yet, say so and suggest pressing "Run analysis".
- A trend is evidence, not proof: correlation is not causation. Suggest a checking step when it helps (compare \
with a control variable, a neighboring area, a different period, or the deseasonalized series).
- If a question is not about Earth science or this app, politely steer back.

How the app's statistics work:
- The series is a monthly (or annual) average over the student's area. The trend line is an ordinary \
least-squares fit; its slope is reported per decade with a 95% confidence interval.
- Two tests: the regression t-test and the Mann-Kendall test (does the series keep going one way, robust to \
outliers; Sen's slope is its rate). The app calls a trend significant only when BOTH have p < alpha (0.05 by \
default). If only one does, the result says "treat it with caution".
- Deseasonalize removes the normal yearly cycle (e.g. monsoon rain, summer heat) so the long-term change is \
easier to see.
- "Not significant" is a real answer: the change is within normal year-to-year ups and downs.
- Control variables separate human causes from climate: e.g. groundwater falling while rainfall has no \
significant trend points to pumping, not drought."""


def build_knowledge(catalog: Catalog) -> str:
    """The fixed part of the system prompt, built from variables.yaml and examples.yaml."""
    variables = "\n".join(
        f"- {v.name} [{v.id}], {v.units}, {v.temporal_resolution}, {v.available_start.year}–{v.available_end.year}, "
        f"coverage {v.coverage}, from {v.source}. {v.short_definition} Why it matters: {v.why_it_matters}"
        for v in catalog.variables()
    )
    cases = "\n".join(
        f"- {ex.title} ({ex.variable_id}, {ex.start.year}–{ex.end.year}): {ex.takeaway}" for ex in catalog.examples()
    )
    return (
        f"{_ROLE}\n\n"
        f"Variables in the app:\n{variables}\n\n"
        f"One-click example cases (takeaways were checked on the real data for these default dates):\n{cases}\n\n"
        "Students can also upload their own CSV (date,value) and analyze it with the same tests."
    )


def describe_context(context: ChatContext, catalog: Catalog) -> str:
    """The per-request part: what is on the student's screen right now."""
    lines = []
    if context.variable_id:
        var = catalog.get(context.variable_id)
        if var is not None:
            units = "" if var.units.strip().lower() in UNITLESS else f" in {var.units}"
            lines.append(f"Variable: {var.name} [{var.id}]{units}.")
        elif context.variable_id.startswith("upload:"):
            lines.append("Variable: a dataset the student uploaded (their own CSV; units unknown).")
        else:
            lines.append(f"Variable: {context.variable_id}.")
    if context.bbox:
        b = context.bbox
        lat, lon = (b.south + b.north) / 2, (b.west + b.east) / 2
        lines.append(
            f"Area: a box {b.north - b.south:.1f}° tall × {b.east - b.west:.1f}° wide centered at "
            f"{abs(lat):.1f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.1f}°{'E' if lon >= 0 else 'W'} "
            f"(west {b.west}, south {b.south}, east {b.east}, north {b.north})."
        )
    if context.result_summary:
        lines.append(f'Latest analysis result: "{context.result_summary}"')
    elif lines:
        lines.append("No analysis has been run yet for this selection.")
    return "\n".join(lines) or "Nothing selected yet: no area, variable or result."


class FieldGuideChatBackend:
    """Answers with an LLM; the provider call is injected so tests can run offline."""

    def __init__(self, catalog: Catalog, complete: Completion) -> None:
        self._catalog = catalog
        self._knowledge = build_knowledge(catalog)
        self._complete = complete

    def system_prompt(self, context: ChatContext) -> str:
        return f"{self._knowledge}\n\nWhat the student is looking at:\n{describe_context(context, self._catalog)}"

    async def reply(self, request: ChatRequest) -> ChatResponse:
        try:
            answer = await self._complete(self.system_prompt(request.context), request.messages[-MAX_MESSAGES:])
        except Exception:
            log.exception("Field guide LLM call failed")
            raise HTTPException(status_code=503, detail="The field guide can't answer right now. Try again in a moment.")
        if not answer.strip():
            raise HTTPException(status_code=503, detail="The field guide had no answer. Try asking another way.")
        return ChatResponse(message=ChatMessage(role="assistant", content=answer.strip()), stub=False)


def gemini_completion(api_key: str, model: str) -> Completion:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    async def complete(system: str, messages: list[ChatMessage]) -> str:
        contents = [
            types.Content(role="model" if m.role == "assistant" else "user", parts=[types.Part(text=m.content)])
            for m in messages
        ]
        resp = await client.aio.models.generate_content(
            model=model, contents=contents, config=types.GenerateContentConfig(system_instruction=system)
        )
        return resp.text or ""

    return complete


def openai_completion(api_key: str, model: str) -> Completion:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    async def complete(system: str, messages: list[ChatMessage]) -> str:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}] + [{"role": m.role, "content": m.content} for m in messages],
        )
        return resp.choices[0].message.content or ""

    return complete


_COMPLETIONS = {"gemini": gemini_completion, "openai": openai_completion}


@register_chat_backend("fieldguide")
def _factory(settings: Settings) -> FieldGuideChatBackend | StubChatBackend:
    provider = settings.chat_provider.lower()
    if provider not in _COMPLETIONS:
        raise ValueError(f"Unknown TD_CHAT_PROVIDER {provider!r} (use: {', '.join(_COMPLETIONS)})")
    api_key = {"gemini": settings.gemini_api_key, "openai": settings.openai_api_key}[provider]
    if not api_key:
        log.warning("Field guide: no API key for %s, falling back to the stub chat", provider)
        return StubChatBackend()
    model = settings.chat_model or DEFAULT_MODELS[provider]
    log.info("Field guide: %s (%s)", provider, model)
    return FieldGuideChatBackend(Catalog.from_dir(), _COMPLETIONS[provider](api_key, model))
