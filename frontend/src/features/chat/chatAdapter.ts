/**
 * Every chat call goes through `chatAdapter.send()`: by default POST /api/chat, answered by the backend's
 * field guide (an LLM when TD_CHAT_BACKEND=fieldguide and a key are set, canned replies otherwise).
 * Swap the implementation with `setChatAdapter()` if needed.
 */
import { api } from '../../api/client';
import type { ChatRequest, ChatResponse } from '../../api/types';

export type { ChatMessage, ChatRequest, ChatResponse } from '../../api/types';

export interface ChatAdapter {
  send(req: ChatRequest): Promise<ChatResponse>;
}

/** Default: the backend's /api/chat endpoint. */
export const backendChatAdapter: ChatAdapter = {
  send: (req) => api.chat(req),
};

let current: ChatAdapter = backendChatAdapter;

/** Swap the implementation at runtime, e.g. setChatAdapter(myLlmAdapter). */
export function setChatAdapter(adapter: ChatAdapter) {
  current = adapter;
}

export const chatAdapter: ChatAdapter = {
  send: (req) => current.send(req),
};
