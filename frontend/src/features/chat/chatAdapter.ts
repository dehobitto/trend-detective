/**
 * ============================================================================
 *  FIELD GUIDE CHAT: THE ONE PLACE TO PLUG IN THE REAL ASSISTANT
 * ============================================================================
 * Every chat call in the UI goes through `chatAdapter.send()`. To connect a real
 * bot, write another object that implements `ChatAdapter` and export it as
 * `chatAdapter` below (or call `setChatAdapter()` at startup in main.tsx).
 * Nothing else in the UI needs to change.
 *
 * The default implementation calls POST /api/chat (docs/API.md), which the
 * backend currently answers with a canned stub reply.
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
