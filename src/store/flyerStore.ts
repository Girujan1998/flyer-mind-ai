import { create } from 'zustand';

import { mockAiService, type FlyerAnalysis } from '@/ai/service';

export type Flyer = FlyerAnalysis & {
  id: string;
  createdAt: string;
};

type FlyerState = {
  flyers: Flyer[];
  isAnalyzing: boolean;
  error: string | null;
  analyzeFlyer: (input: { imageBase64?: string; imageUrl?: string }) => Promise<void>;
  removeFlyer: (id: string) => void;
  clear: () => void;
};

// Swap `mockAiService` for `aiService` once the backend is wired up.
const ai = mockAiService;

export const useFlyerStore = create<FlyerState>((set) => ({
  flyers: [],
  isAnalyzing: false,
  error: null,

  async analyzeFlyer(input) {
    set({ isAnalyzing: true, error: null });
    try {
      const analysis = await ai.analyzeFlyer(input);
      const flyer: Flyer = {
        ...analysis,
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ flyers: [flyer, ...state.flyers], isAnalyzing: false }));
    } catch (error) {
      set({
        isAnalyzing: false,
        error: error instanceof Error ? error.message : 'Failed to analyze flyer',
      });
    }
  },

  removeFlyer(id) {
    set((state) => ({ flyers: state.flyers.filter((f) => f.id !== id) }));
  },

  clear() {
    set({ flyers: [], error: null });
  },
}));
