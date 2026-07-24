// Central maxLength caps for every free-text <input>/<textarea> in apps/web.
// Every new text field must reference a key here (add one if no existing key
// fits) instead of hardcoding a number or shipping an unbounded input.
// Values that mirror a backend-enforced limit are noted — keep them in sync.
export const INPUT_LIMITS = {
  // Person, tenant, product, chain, category, route and contact names.
  name: 120,
  // RFC 5321 practical ceiling for an email address.
  email: 254,
  password: 128,
  // E.164 allows 15 digits; leave room for "+", spaces and separators.
  phone: 24,
  slug: 64,
  // External codes and SKUs.
  code: 64,
  // Tenant country: the backend accepts either an ISO 3166-1 alpha-2 code or
  // a free-text country name (platform.service.ts), so allow the longest
  // real-world country name rather than capping at 2.
  country: 56,
  // Longest registrable DNS name.
  domain: 253,
  addressLine: 200,
  city: 120,
  search: 100,
  // Task titles, "next action" and similar one-line summaries.
  title: 200,
  // Long free text: visit/location/contact notes, task descriptions. Matches
  // the backend cap on the field-report voice hint (settings.service.ts).
  notes: 2000,
  // Location-insights comments (potential, assortment, SKU) — backend rejects
  // anything above MAX_COMMENT_LENGTH = 500 (location-insights-parsing.ts).
  comment: 500,
  // Manually pasted invite tokens.
  token: 200,
  // Free-text numeric quantity fields (inputMode="numeric" without
  // type="number"), e.g. SKU stock/order/sale in the visit report.
  quantity: 9,
} as const;
