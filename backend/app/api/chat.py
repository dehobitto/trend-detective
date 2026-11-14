from fastapi import APIRouter, Depends

from app.api.deps import Services, get_services
from app.schemas import ChatRequest, ChatResponse

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, services: Services = Depends(get_services)) -> ChatResponse:
    return await services.chat.reply(request)
