import { create } from 'zustand';

type Theme = 'relay' | 'solaris';

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: (localStorage.getItem('mc-theme') as Theme) || 'relay',
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'relay' ? 'solaris' : 'relay';
      localStorage.setItem('mc-theme', next);
      document.body.setAttribute('data-theme', next);
      return { theme: next };
    }),
  setTheme: (t) => {
    localStorage.setItem('mc-theme', t);
    document.body.setAttribute('data-theme', t);
    set({ theme: t });
  },
}));
