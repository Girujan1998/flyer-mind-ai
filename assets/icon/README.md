# App icon source

Vector source for the "Flyer & Spark" app icon (folded flyer, price line, AI
sparkle) — the concept picked from the icon mockup gallery.

- `icon-ios.svg` — full-bleed square, sharp corners. Rendered at every size in
  `ios/FlyerMindAI/Images.xcassets/AppIcon.appiconset/`; iOS applies its own
  corner mask, so this source must stay unrounded and fully opaque.
- `icon-android-square.svg` — same artwork with a baked-in ~20% corner radius
  (legacy Android launchers, pre-adaptive-icon, expect an already-shaped
  icon). Rendered into `android/app/src/main/res/mipmap-*/ic_launcher.png`.
- `icon-android-round.svg` — same artwork clipped to a circle, for
  `ic_launcher_round.png` (`android:roundIcon` in `AndroidManifest.xml`).

All three share one 0–100 coordinate space so edits only need to happen once
per file. Colors are literal hex, matching `src/theme.ts`'s light palette
(`primary` #1f6b4a, `deal` #df5230) rather than CSS variables, since these are
standalone files with no external stylesheet.

## Regenerating the PNGs

No image library is wired into this repo for it — these were rasterized with
macOS's built-in QuickLook thumbnailer, which needs no install:

```bash
qlmanage -t -s <pixels> -o <out-dir> icon-ios.svg
```

iOS sizes needed (from `AppIcon.appiconset/Contents.json`): 40, 60, 58, 87,
80, 120, 180, 1024px, saved as `AppIcon-20@2x.png` … `AppIcon-1024.png`.
Android sizes (from `icon-android-square.svg` / `icon-android-round.svg`):
48/72/96/144/192px for mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi, saved as
`ic_launcher.png` / `ic_launcher_round.png` in each `mipmap-*` folder.
