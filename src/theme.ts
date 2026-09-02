import {useMemo} from 'react';
import {useColorScheme} from 'react-native';

/**
 * "Market" theme — warm oat grounds, a deep grocery green, a ripe-tomato accent
 * reserved for deals, with a matching dark palette.
 */
export type Palette = {
  background: string;
  /** Cards, sheets, raised surfaces. */
  surface: string;
  /** Inputs, chips, nested fills. */
  surfaceAlt: string;
  /** Product-crop backdrop (kept near-white so photos read). */
  imageBackdrop: string;
  border: string;
  text: string;
  textMuted: string;
  /** Grocery green — primary actions, "Valid". */
  primary: string;
  primaryTint: string;
  onPrimary: string;
  /** Ripe tomato — on sale / SALE / promo. */
  deal: string;
  dealTint: string;
  /** Destructive / errors. */
  danger: string;
  scrim: string;
  /** The floating pill nav sits on an ink slab in both themes. */
  navBackground: string;
  navBorder: string;
  navInactive: string;
  navActiveText: string;
};

export const lightPalette: Palette = {
  background: '#f5f3ec',
  surface: '#ffffff',
  surfaceAlt: '#efece2',
  imageBackdrop: '#ffffff',
  border: '#e7e3d8',
  text: '#262420',
  textMuted: '#78736a',
  primary: '#1f6b4a',
  primaryTint: 'rgba(31, 107, 74, 0.12)',
  onPrimary: '#ffffff',
  deal: '#df5230',
  dealTint: 'rgba(223, 82, 48, 0.12)',
  danger: '#c2401f',
  scrim: 'rgba(26, 25, 22, 0.5)',
  navBackground: '#262420',
  navBorder: 'transparent',
  navInactive: 'rgba(255, 255, 255, 0.6)',
  navActiveText: '#ffffff',
};

export const darkPalette: Palette = {
  background: '#1a1916',
  surface: '#242320',
  surfaceAlt: '#2e2c28',
  imageBackdrop: '#f4f2ec',
  border: 'rgba(239, 236, 227, 0.13)',
  text: '#efece3',
  textMuted: '#a49e92',
  primary: '#4fc78a',
  primaryTint: 'rgba(79, 199, 138, 0.16)',
  onPrimary: '#122019',
  deal: '#ff7a52',
  dealTint: 'rgba(255, 122, 82, 0.16)',
  danger: '#f2867e',
  scrim: 'rgba(0, 0, 0, 0.55)',
  navBackground: '#100f0d',
  navBorder: 'rgba(239, 236, 227, 0.1)',
  navInactive: 'rgba(239, 236, 227, 0.58)',
  navActiveText: '#100f0d',
};

export function useTheme(): {colors: Palette; dark: boolean} {
  const dark = useColorScheme() === 'dark';
  return {colors: dark ? darkPalette : lightPalette, dark};
}

/**
 * Build a StyleSheet from the active palette. Returns the sheet plus the raw
 * palette (for colors passed as props, e.g. ActivityIndicator).
 *
 *   const {styles, colors} = useThemedStyles(makeStyles);
 *   const makeStyles = (c: Palette) => StyleSheet.create({ ... });
 */
export function useThemedStyles<T>(factory: (c: Palette) => T): {
  styles: T;
  colors: Palette;
  dark: boolean;
} {
  const {colors, dark} = useTheme();
  const styles = useMemo(() => factory(colors), [colors, factory]);
  return {styles, colors, dark};
}

/** Static light palette — for non-component modules only. Prefer `useTheme()`. */
export const colors = lightPalette;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 22,
  pill: 999,
};

/**
 * Flip to `true` once the .ttf files are bundled (assets/fonts + react-native
 * config + `npx react-native-asset` + rebuild). Until then every `fonts.*` is
 * `undefined`, so components fall back to the system font via `fontWeight`.
 */
export const FONTS_BUNDLED = false;

const family = (name: string): string | undefined =>
  FONTS_BUNDLED ? name : undefined;

export const fonts = {
  /** Bricolage Grotesque — prices, titles, mastheads. */
  display: family('BricolageGrotesque-Bold'),
  displaySemibold: family('BricolageGrotesque-SemiBold'),
  /** Hanken Grotesk — everything else. */
  body: family('HankenGrotesk-Regular'),
  medium: family('HankenGrotesk-Medium'),
  semibold: family('HankenGrotesk-SemiBold'),
  bold: family('HankenGrotesk-Bold'),
};
