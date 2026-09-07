# Flyer Mind AI

Bare **React Native 0.73.9** app (iOS + Android), bootstrapped with
`@react-native-community/cli` — same stack and versions as the `gasagent-ai`
project so local `.ipa` / `.apk` builds work with the toolchain on hand
(Xcode 13.4 / CocoaPods 1.13–1.14 — RN 0.73 is the last line that builds there;
0.74+ needs Xcode 15).

Fresh start: no backend, no feature code — just the shell to build on.

## Stack

| | |
| --- | --- |
| React Native | 0.73.9 |
| React | 18.2.0 |
| Android | compileSdk/targetSdk 34, minSdk 21, NDK 25.1.8937393, Kotlin 1.8.0, Gradle 8.3, Hermes on |
| iOS | deployment target 13.4, Hermes on |
| Language | TypeScript 5.0 |
| Test | Jest (`preset: react-native`) |

## Run it

```bash
npm install

# iOS (first time)
bundle install
bundle exec pod install --project-directory=ios

npm start                 # Metro, in its own terminal
npm run ios               # or: npm run android
```

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Layout

```
App.tsx              root component
index.js             AppRegistry entry
src/screens/         screens (HomeScreen for now)
android/  ios/        native projects (committed — bare workflow)
```
