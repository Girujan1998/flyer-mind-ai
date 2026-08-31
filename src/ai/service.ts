import { api } from '@/api/client';
import { env } from '@/config/env';

/**
 * AI service stub for Flyer Mind AI.
 *
 * IMPORTANT: never ship an Anthropic API key inside the app bundle. These calls
 * hit *your own backend* (`${apiBaseUrl}/ai/...`), which holds the key and
 * forwards requests to the Claude API. Swap the endpoint paths for whatever
 * your backend exposes.
 */

export type FlyerAnalysis = {
  title: string;
  summary: string;
  eventDate?: string;
  location?: string;
  tags: string[];
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export const aiService = {
  /** Send an image (base64 or a URL your backend can reach) for extraction. */
  async analyzeFlyer(input: { imageBase64?: string; imageUrl?: string }): Promise<FlyerAnalysis> {
    return api.post<FlyerAnalysis>('/ai/analyze-flyer', {
      model: env.aiModel,
      ...input,
    });
  },

  /** Multi-turn chat grounded in a previously analyzed flyer. */
  async chat(messages: ChatMessage[], flyerId?: string): Promise<ChatMessage> {
    return api.post<ChatMessage>('/ai/chat', {
      model: env.aiModel,
      flyerId,
      messages,
    });
  },
};

/** Local mock so the UI is usable before the backend exists. */
export const mockAiService: typeof aiService = {
  async analyzeFlyer() {
    await delay(600);
    return {
      title: 'Community Jazz Night',
      summary: 'Live jazz quartet at the Riverside Hall with local food vendors.',
      eventDate: '2026-09-12T19:00:00',
      location: 'Riverside Hall, 42 Elm St',
      tags: ['music', 'jazz', 'community', 'nightlife'],
    };
  },
  async chat(messages) {
    await delay(400);
    const last = messages[messages.length - 1]?.content ?? '';
    return { role: 'assistant', content: `You said: "${last}". (mock response)` };
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
