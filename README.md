# Flyer Mind AI

Cross-platform (iOS + Android + web) mobile app scaffold built with **Expo**, **expo-router**, **TypeScript**, and **Zustand**.

The app concept: capture an event flyer/poster and get a clean, structured summary (title, date, location, tags) from an AI backend.

## Requirements

- **Node 20+** (`nvm install 20 && nvm use 20`). The scaffold pins Expo SDK 51 so it also installs on Node 18, but current Expo tooling expects Node 20+.
- iOS: Xcode + iOS Simulator (macOS only). Android: Android Studio + an emulator. Or run everything in **Expo Go** on a physical device.

## Getting started

```bash
npm install
npm start          # Metro bundler + QR code for Expo Go
npm run ios        # open iOS simulator
npm run android    # open Android emulator
npm run web        # open in the browser
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Expo dev server |
| `npm run ios` / `android` / `web` | Launch on a target platform |
| `npm run lint` | ESLint (`eslint-config-expo` + Prettier) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest + `@testing-library/react-native` |
| `npm run format` | Prettier write |

## Project structure

```
app/                      expo-router routes (file-based navigation)
  _layout.tsx             root stack + providers
  (tabs)/                 bottom tab navigator
    index.tsx             flyer list + "analyze" action
    settings.tsx          toggles + environment info
  flyer/[id].tsx          flyer detail screen
  +not-found.tsx          fallback route
src/
  api/client.ts           typed fetch wrapper (base URL, timeouts, errors)
  ai/service.ts           AI service stub + local mock (analyzeFlyer, chat)
  store/                   Zustand stores (flyerStore, settingsStore)
  components/              shared UI (Button, FlyerCard)
  config/env.ts            runtime config from app.json `extra` / EXPO_PUBLIC_*
  theme/                   colors, spacing, radius tokens
.github/workflows/ci.yml   lint + typecheck + test on push/PR
```

## AI integration

`src/ai/service.ts` calls **your own backend** (`${apiBaseUrl}/ai/...`), which holds the
Anthropic API key and forwards to the Claude API. **Never bundle an API key in the app.**

The stores currently use `mockAiService` so the UI works with no backend. Switch to
`aiService` in `src/store/flyerStore.ts` once your endpoints exist.

## Configuration

Non-secret config lives in `app.json` under `expo.extra`. Override locally via a
`.env.local` file (see `.env.example`) — only `EXPO_PUBLIC_*` variables are exposed to the client.

## Native builds

This project uses [Expo Prebuild](https://docs.expo.dev/workflow/prebuild/) — there is no
committed `ios/` or `android/` folder. Generate them with `npx expo prebuild`, or build in
the cloud with [EAS Build](https://docs.expo.dev/build/introduction/): `npx eas build -p ios`.
