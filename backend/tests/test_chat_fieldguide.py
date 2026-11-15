import asyncio

import pytest
from fastapi import HTTPException

from app.catalog import Catalog
from app.chat import FieldGuideChatBackend, StubChatBackend, create_chat_backend
from app.chat.fieldguide import MAX_MESSAGES, build_knowledge
from app.schemas.chat import ChatMessage, ChatRequest

PUNJAB = {"west": 73.5, "south": 28.5, "east": 77.5, "north": 32.5}


class FakeLLM:
    def __init__(self, answer="Groundwater is water stored underground.", error=None):
        self.answer, self.error, self.calls = answer, error, []

    async def __call__(self, system, messages):
        self.calls.append((system, messages))
        if self.error:
            raise self.error
        return self.answer


def ask(backend, content="What is this?", **context):
    req = ChatRequest(messages=[ChatMessage(role="user", content=content)], context=context)
    return asyncio.run(backend.reply(req))


@pytest.fixture(scope="module")
def catalog():
    return Catalog.from_dir()


def test_knowledge_lists_every_variable_and_case(catalog):
    text = build_knowledge(catalog)
    assert all(v.id in text and v.short_definition in text for v in catalog.variables())
    assert all(ex.takeaway in text for ex in catalog.examples())


def test_reply_uses_screen_context(catalog):
    llm = FakeLLM()
    res = ask(FieldGuideChatBackend(catalog, llm), bbox=PUNJAB, variable_id="gldas_gws",
              result_summary="Falling by 69 mm per decade.")
    assert res.stub is False and res.message.content == llm.answer
    system, messages = llm.calls[0]
    context = system.split("What the student is looking at:")[1]
    assert "Groundwater storage [gldas_gws]" in context and "30.5°N, 75.5°E" in context
    assert '"Falling by 69 mm per decade."' in context
    assert [m.content for m in messages] == ["What is this?"]


def test_reply_without_selection_or_result(catalog):
    llm = FakeLLM()
    ask(FieldGuideChatBackend(catalog, llm))
    assert "Nothing selected yet" in llm.calls[0][0]
    ask(FieldGuideChatBackend(catalog, llm), variable_id="upload:abc")
    assert "uploaded" in llm.calls[1][0] and "No analysis has been run yet" in llm.calls[1][0]


def test_long_conversation_is_trimmed_to_start_with_the_student(catalog):
    llm = FakeLLM()
    history = [ChatMessage(role="user" if i % 2 == 0 else "assistant", content=str(i)) for i in range(41)]
    asyncio.run(FieldGuideChatBackend(catalog, llm).reply(ChatRequest(messages=history)))
    sent = llm.calls[0][1]
    assert len(sent) == MAX_MESSAGES and sent[0].role == "user" and sent[-1].content == "40"


def test_llm_failure_is_a_readable_503(catalog):
    for llm in (FakeLLM(error=RuntimeError("quota")), FakeLLM(answer="  ")):
        with pytest.raises(HTTPException) as exc:
            ask(FieldGuideChatBackend(catalog, llm))
        assert exc.value.status_code == 503 and "field guide" in exc.value.detail


def test_factory_without_key_falls_back_to_stub(settings):
    assert isinstance(create_chat_backend("fieldguide", settings), StubChatBackend)
    with pytest.raises(ValueError, match="TD_CHAT_PROVIDER"):
        create_chat_backend("fieldguide", settings.model_copy(update={"chat_provider": "nope"}))


def test_chat_endpoint_with_fieldguide(client, catalog):
    llm = FakeLLM(answer="NDVI measures how green plants are.")
    client.app.state.services.chat = FieldGuideChatBackend(catalog, llm)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "What is NDVI?"}],
                                       "context": {"variable_id": "modis_ndvi"}})
    assert r.status_code == 200 and r.json() == {
        "message": {"role": "assistant", "content": "NDVI measures how green plants are."}, "stub": False}

    client.app.state.services.chat = FieldGuideChatBackend(catalog, FakeLLM(error=RuntimeError("down")))
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hi"}]})
    assert r.status_code == 503 and r.json()["detail"].startswith("The field guide")
