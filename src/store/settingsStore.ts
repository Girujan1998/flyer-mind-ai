import { create } from 'zustand';

type SettingsState = {
  useMockAi: boolean;
  notificationsEnabled: boolean;
  setUseMockAi: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  useMockAi: true,
  notificationsEnabled: false,
  setUseMockAi: (useMockAi) => set({ useMockAi }),
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
}));
