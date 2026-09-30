// Explicit billing units from SmartMLS. Missing/unknown periods never default to monthly.
export const rentSuffix = l => l.listingType !== 'rent' ? '' : ({
  month: '/mo', week: '/wk', day: '/day', year: '/yr',
  'sqft-year': '/sq ft/yr', 'sqft-month': '/sq ft/mo',
  'acre-month': '/acre/mo', 'acre-year': '/acre/yr',
  summer: '/summer season', winter: '/winter season'
}[l.rentPeriod] || ' (period unconfirmed)');
export const monthlyPrice = l => l.listingType === 'rent' && l.rentPeriod !== 'month' ? null : l.price;
export function withinBudget(l, min, max) {
  if (!min && !max) return true;
  const p = monthlyPrice(l);
  return p != null && (!min || p >= min) && (!max || p <= max);
}
export function comparePrice(a, b, descending = false) {
  // Monthly prices first; other periods form separate groups rather than a false bargain order.
  const group = l => l.listingType !== 'rent' || l.rentPeriod === 'month' ? '' : (l.rentPeriod || 'unknown');
  return group(a).localeCompare(group(b)) || (descending ? b.price - a.price : a.price - b.price);
}
