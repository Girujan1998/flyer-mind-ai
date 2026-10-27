# App icon + splash source

Vector source for the "Flyer & Spark" mark (folded flyer, price line, AI
sparkle) — the concept picked from the icon mockup gallery.

- `icon-ios.svg` — full-bleed square, sharp corners. Rendered at every size in
  `ios/FlyerMindAI/Images.xcassets/AppIcon.appiconset/`; iOS applies its own
  corner mask, so this source must stay unrounded and fully opaque.
- `icon-android-square.svg` — same artwork with a baked-in ~20% corner radius
  (legacy Android launchers, pre-adaptive-icon, expect an already-shaped
  icon). Rendered into `android/app/src/main/res/mipmap-*/ic_launcher.png`.
- `icon-android-round.svg` — same artwork clipped to a circle, for
  `ic_launcher_round.png` (`android:roundIcon` in `AndroidManifest.xml`).
- `icon-glyph.svg` — the mark alone on a **transparent** background (no
  green tile), used for the splash screen, where the green already comes
  from the native window background. Rendered into
  `ios/.../Images.xcassets/LaunchLogo.imageset/` and
  `android/app/src/main/res/drawable-*/launch_logo.png`.

All four share one 0–100 coordinate space so edits only need to happen once
per file. Colors are literal hex, matching `src/theme.ts`'s light palette
(`primary` #1f6b4a, `deal` #df5230) rather than CSS variables, since these are
standalone files with no external stylesheet.

## Regenerating the PNGs

No image library is wired into this repo for it — these were rasterized with
macOS's built-in QuickLook thumbnailer, which needs no install:

```bash
qlmanage -t -s <pixels> -o <out-dir> icon-ios.svg
```

iOS icon sizes needed (from `AppIcon.appiconset/Contents.json`): 40, 60, 58,
87, 80, 120, 180, 1024px, saved as `AppIcon-20@2x.png` … `AppIcon-1024.png`.
Android icon sizes (from `icon-android-square.svg` / `icon-android-round.svg`):
48/72/96/144/192px for mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi, saved as
`ic_launcher.png` / `ic_launcher_round.png` in each `mipmap-*` folder.

Splash logo (`icon-glyph.svg`, a 200pt mark): iOS needs 200/400/600px as
`LaunchLogo.png` / `@2x` / `@3x` in `LaunchLogo.imageset/`; Android's
pre-Android-12 path needs 120/180/240/360/480px (mdpi…xxxhdpi) as
`launch_logo.png` in each `drawable-*` folder.

## Android splash needs two different assets

Android 12+ (API 31+) shows its own **system** splash screen (a `SplashScreen`
API window, separate from the activity's `windowBackground`) with the icon in
a fixed circular well. Empirically (tested on a Pixel 6 API 34 emulator): a
plain transparent-background bitmap there gets a **white disc** forced in
behind it — neither `android:windowSplashScreenIconBackgroundColor` nor
wrapping it as an `<adaptive-icon>` changed that. The fix is a **flat, fully
opaque** square (green background baked in, no transparency — reuse
`icon-ios.svg`) so there's no gap left for a white disc to show through:
rendered into `drawable-*/launch_logo_square.png` at 240/360/480/720/960px,
referenced only from `values-v31/styles.xml`.

Pre-31 Android has no such system layer — it just paints
`android:windowBackground` directly — so it keeps using the classic
background-color + centered-transparent-bitmap `launch_screen.xml` layer-list
with `launch_logo.png`, same as iOS's storyboard approach.
