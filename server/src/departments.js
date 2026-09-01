// The coarse store-aisle grouping above `category`. A fixed, controlled list so
// the app can build a stable filter UI. Shared by extraction, backfill and the
// /products + /departments endpoints.

export const DEPARTMENTS = [
  'fruit',
  'vegetables',
  'meat & seafood',
  'dairy & eggs',
  'bakery',
  'frozen',
  'pantry',
  'snacks & candy',
  'beverages',
  'deli & prepared',
  'household & cleaning',
  'laundry',
  'paper goods',
  'health & wellness',
  'beauty & personal care',
  'baby',
  'pet',
  'electronics',
  'home & kitchen',
  'clothing',
  'toys & seasonal',
  'other',
];

const SET = new Set(DEPARTMENTS);

/** True when `value` is one of the known departments (case-insensitive). */
export function isDepartment(value) {
  return SET.has((value ?? '').toString().trim().toLowerCase());
}

/** Normalise to a known department; anything unrecognised becomes "other". */
export function cleanDepartment(value) {
  const s = (value ?? '').toString().trim().toLowerCase();
  return SET.has(s) ? s : 'other';
}
