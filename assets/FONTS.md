# Fonts — Market theme

The Market theme is designed for **Bricolage Grotesque** (display) and
**Hanken Grotesk** (body). Until the `.ttf` files below are present and linked,
`FONTS_BUNDLED` in `src/theme.ts` stays `false` and the app renders in the
system font (via `fontWeight`) — no crash, just not the intended type.

## To enable

1. Download the static weights (both are SIL OFL, free) and drop the `.ttf`
   files in this folder with these exact filenames:

   | File | From |
   | --- | --- |
   | `HankenGrotesk-Regular.ttf` | https://fonts.google.com/specimen/Hanken+Grotesk |
   | `HankenGrotesk-Medium.ttf` | " |
   | `HankenGrotesk-SemiBold.ttf` | " |
   | `HankenGrotesk-Bold.ttf` | " |
   | `BricolageGrotesque-SemiBold.ttf` | https://fonts.google.com/specimen/Bricolage+Grotesque |
   | `BricolageGrotesque-Bold.ttf` | " |

   (Google Fonts' download gives a variable font; use a static-instance export,
   e.g. from https://gwfh.mranftl.com or fontsource, so the PostScript names
   match `Family-Weight`.)

2. Link them:

   ```bash
   npx react-native-asset
   cd ios && pod install && cd ..
   ```

3. Set `FONTS_BUNDLED = true` in `src/theme.ts`.

4. Rebuild (`./scripts/build-ios-ipa.sh`, or run on the simulator).

## Verifying the names

The `fontFamily` values in `src/theme.ts` (`fonts.*`) must match each file's
**PostScript name**, not the filename. Check with:

```bash
python3 -c "from fontTools.ttLib import TTFont; import sys; \
  print(TTFont(sys.argv[1])['name'].getName(6,3,1))" assets/fonts/HankenGrotesk-Bold.ttf
```

Adjust `fonts.*` in `theme.ts` if a name differs.
