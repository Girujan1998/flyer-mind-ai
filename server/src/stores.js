// Canonical display spelling for retailer names read off a flyer's page 1.
// Gemini transcribes whatever's printed on the masthead — "NOFRILLS",
// "No Frills", "no frills" are all the same retailer but would otherwise
// fragment `flyers.store` (and everything grouped by it: search filters,
// price-insight's byStore comparison) into separate values.
//
// Keyed by a normalized (lowercase, letters/digits only) form so casing,
// spacing, and punctuation differences all collapse to one lookup.
const STORE_ALIASES = {
  walmart: 'Walmart',
  nofrills: 'No Frills',
  freshco: 'FreshCo',
  foodbasics: 'Food Basics',
  loblaws: 'Loblaws',
  sobeys: 'Sobeys',
  metro: 'Metro',
  costco: 'Costco',
  realcanadiansuperstore: 'Real Canadian Superstore',
  superstore: 'Real Canadian Superstore',
  shoppersdrugmart: 'Shoppers Drug Mart',
  gianttiger: 'Giant Tiger',
  dollarama: 'Dollarama',
  canadiantire: 'Canadian Tire',
  iga: 'IGA',
  safeway: 'Safeway',
  saveonfoods: 'Save-On-Foods',
  longos: "Longo's",
  farmboy: 'Farm Boy',
};

const normalizeKey = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * One consistent spelling for a retailer name, e.g. "NOFRILLS" -> "No Frills".
 * Known chains map to a fixed display spelling regardless of case/spacing;
 * anything else is just trimmed/whitespace-collapsed (still catches the most
 * common accidental duplicates) rather than guessed at.
 */
export function normalizeStore(value) {
  const raw = (value ?? '').toString().trim().replace(/\s+/g, ' ');
  if (!raw) {
    return '';
  }
  return STORE_ALIASES[normalizeKey(raw)] || raw;
}
