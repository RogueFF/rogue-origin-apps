import { create } from 'zustand';

interface ChatStore {
  selectedAgent: string;
  message: string;
  setSelectedAgent: (id: string) => void;
  setMessage: (m: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  selectedAgent: 'atlas',
  message: '',
  setSelectedAgent: (id) => set({ selectedAgent: id }),
  setMessage: (m) => set({ message: m }),
}));
