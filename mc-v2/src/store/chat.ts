import { create } from 'zustand';
import { CHAT_CACHE_PREFIX, CHAT_MAX_MESSAGES } from '../lib/constants';

interface ChatStore {
  selectedAgent: string;
  message: string;
  setSelectedAgent: (id: string) => void;
  setMessage: (m: string) => void;
  clearHistory: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// localStorage persistence for chat history
// ---------------------------------------------------------------------------

export function loadChatHistory(agentId: string): unknown[] {
  try {
    const raw = localStorage.getItem(`${CHAT_CACHE_PREFIX}${agentId}`);
    return raw ? (JSON.parse(raw) as unknown[]).slice(0, CHAT_MAX_MESSAGES) : [];
  } catch { return []; }
}

export function persistChatHistory(agentId: string, messages: unknown[]) {
  try {
    localStorage.setItem(
      `${CHAT_CACHE_PREFIX}${agentId}`,
      JSON.stringify(messages.slice(-CHAT_MAX_MESSAGES))
    );
  } catch { /* quota exceeded */ }
}

export function clearChatCache(agentId: string) {
  try { localStorage.removeItem(`${CHAT_CACHE_PREFIX}${agentId}`); } catch { /* noop */ }
}

export const useChatStore = create<ChatStore>((set) => ({
  selectedAgent: 'main',
  message: '',
  setSelectedAgent: (id) => set({ selectedAgent: id }),
  setMessage: (m) => set({ message: m }),
  clearHistory: (agentId) => {
    clearChatCache(agentId);
    // Gateway store handles the actual chatHistory state
  },
}));
