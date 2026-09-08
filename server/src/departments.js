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

// Aisle-level words a shopper types that mean "show me that whole section".
// Only genuinely aisle-level words — NOT concrete items ("candy", "cheese",
// "milk", "chicken", "fish" must stay item searches).
const ALIASES = [
  ['cleaning supplies', ['household & cleaning']],
  ['cleaning products', ['household & cleaning']],
  ['cleaning', ['household & cleaning']],
  ['cleaners', ['household & cleaning']],
  ['household', ['household & cleaning']],
  ['kitchen appliances', ['home & kitchen']],
  ['small appliances', ['home & kitchen']],
  ['appliances', ['home & kitchen']],
  ['appliance', ['home & kitchen']],
  ['clothing', ['clothing']],
  ['clothes', ['clothing']],
  ['apparel', ['clothing']],
  ['electronics', ['electronics']],
  ['tech', ['electronics']],
  ['gadgets', ['electronics']],
  ['toys', ['toys & seasonal']],
  ['seasonal', ['toys & seasonal']],
  ['makeup', ['beauty & personal care']],
  ['cosmetics', ['beauty & personal care']],
  ['toiletries', ['beauty & personal care']],
  ['personal care', ['beauty & personal care']],
  ['beauty', ['beauty & personal care']],
  ['medicine', ['health & wellness']],
  ['medication', ['health & wellness']],
  ['pharmacy', ['health & wellness']],
  ['vitamins', ['health & wellness']],
  ['supplements', ['health & wellness']],
  ['pet supplies', ['pet']],
  ['pet food', ['pet']],
  ['baby products', ['baby']],
  ['paper products', ['paper goods']],
  ['paper goods', ['paper goods']],
  ['laundry', ['laundry']],
  ['deli', ['deli & prepared']],
  ['prepared foods', ['deli & prepared']],
  ['drinks', ['beverages']],
  ['beverages', ['beverages']],
  ['frozen foods', ['frozen']],
  ['frozen food', ['frozen']],
  ['bakery', ['bakery']],
  ['baked goods', ['bakery']],
  ['dairy', ['dairy & eggs']],
  ['produce', ['fruit', 'vegetables']],
  ['fruits and vegetables', ['fruit', 'vegetables']],
];

// literal department names match themselves; longest phrase wins.
const ALIAS_ENTRIES = [
  ...DEPARTMENTS.filter(d => d !== 'other').map(d => [d, [d]]),
  ...ALIASES,
].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

/**
 * The first aisle phrase found as a whole phrase in `text` (already lowercased).
 * Returns `{ deptIds: string[], consumed: Set<string> }` or `null`.
 */
export function matchDepartments(text) {
  const t = ` ${text} `;
  for (const [phrase, deptIds] of ALIAS_ENTRIES) {
    if (t.includes(` ${phrase} `)) {
      return {deptIds, consumed: new Set(phrase.split(' '))};
    }
  }
  return null;
}

/** Normalise to a known department; anything unrecognised becomes "other". */
export function cleanDepartment(value) {
  const s = (value ?? '').toString().trim().toLowerCase();
  return SET.has(s) ? s : 'other';
}
