/* ============================================================================
   ai-search.js — "Magic Search" (plain English), INSIDE the map search
   ============================================================================
   WHY IT LIVES HERE and not on its own page: the answer to "2-bed rental under
   $3,500 that takes dogs, near the train" IS a filtered search. As a separate
   destination it was a second result set that could disagree with the real one.
   Here it parses the sentence, sets the REAL filters — so the bar shows what it
   did and the visitor can adjust or clear any of it by hand — and hands app.js
   the two hooks the filter bar has no controls for:
       keep(listing)   hard requirements (no HOA, takes pets, 1,500+ sq ft)
       score(listing)  ranking, so the best matches sort to the top

   DATA: the map loads data/listings-index.json (light: price / beds / baths /
   sqft / geo / daysOnMarket). Feature questions — pets, garage, pool, central
   air, HOA, waterfront — need data/listings.json, the fuller feed carrying
   structured `facts`. That file is ~9 MB, so it is fetched ONCE, ONLY when a
   question actually needs it; the answer renders immediately from the light
   data and sharpens the moment the details land.

   HONESTY (vault rule 4 — never invent property facts):
     · every want scores off a real field or not at all. Missing data is never
       turned into a claim, and a listing missing the field is never called a match.
     · hard exclusions fire only on an explicit value ("Pets: No", "HOA: $420",
       "Flood zone: 1") — never on absence, which would silently hide homes.
     · no school-quality or neighborhood-desirability ranking, ever (Fair Housing).
       Assigned school names are reported as facts; they are never scored.
   ============================================================================ */

// app.js publishes this at the end of its own module body; module scripts evaluate in document
// order, so it is always here by now. boot() is called at the BOTTOM of this file — calling it
// up here would hit the temporal dead zone on the `let`s it assigns.
const S = window.DTSSearch;

/* ---------------------------------------------------------------------------
   Stamford neighborhoods. The IDX feed's `neighborhood` field is null on every
   record, so a name like "Shippan" can only be honored geographically — a radius
   around the neighborhood's center, checked in keep(). Text-matching the address
   would only ever find streets that happen to carry the name.
   --------------------------------------------------------------------------- */
const HOODS = {
  'downtown':        { name: 'Downtown Stamford',      lat: 41.0520, lng: -73.5390, km: 1.0 },
  'harbor point':    { name: 'Harbor Point',           lat: 41.0380, lng: -73.5450, km: 1.0 },
  'south end':       { name: 'the South End',          lat: 41.0380, lng: -73.5450, km: 1.0 },
  'shippan':         { name: 'Shippan',                lat: 41.0280, lng: -73.5250, km: 1.6 },
  'springdale':      { name: 'Springdale',             lat: 41.0830, lng: -73.5220, km: 1.6 },
  'glenbrook':       { name: 'Glenbrook',              lat: 41.0650, lng: -73.5220, km: 1.4 },
  'cove':            { name: 'the Cove',               lat: 41.0450, lng: -73.5150, km: 1.4 },
  'north stamford':  { name: 'North Stamford',         lat: 41.1300, lng: -73.5600, km: 4.5 },
  'waterside':       { name: 'Waterside',              lat: 41.0400, lng: -73.5600, km: 1.2 },
  'belltown':        { name: 'Belltown',               lat: 41.0750, lng: -73.5400, km: 1.4 },
  'newfield':        { name: 'Newfield',               lat: 41.1000, lng: -73.5450, km: 1.8 },
  'westover':        { name: 'Westover',               lat: 41.0750, lng: -73.5600, km: 1.6 },
  'turn of river':   { name: 'Turn of River',          lat: 41.1100, lng: -73.5550, km: 2.0 },
  'west side':       { name: 'the West Side',          lat: 41.0530, lng: -73.5620, km: 1.3 }
};

const KM = (a, b) => {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/* ---------------------------------------------------------------------------
   WANTS — each is a real field lookup, not a keyword guess where a field exists.
   needsFacts: true  → only answerable once the fuller feed is merged in.
   test(l) → { w: weight, why: 'short human reason' } | null   (null = no match)
   --------------------------------------------------------------------------- */
const f = l => l._facts || {};
const blob = l => l._blob || '';
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const listy = (v, re) => typeof v === 'string' && re.test(v);

const WANTS = {
  pool:       { label: 'a pool', needsFacts: true, test: l => (num(f(l).pool) > 0 || listy(f(l).poolDesc, /./) || /\bpool\b/.test(blob(l))) ? { w: 3, why: 'has a pool' } : null },
  garage:     { label: 'a garage', needsFacts: true, test: l => { const g = num(f(l).garages); if (g > 0) return { w: 2.5, why: `${g}-car garage` }; return listy(f(l).parking, /garage/i) ? { w: 2, why: 'garage parking' } : null; } },
  parking:    { label: 'parking', needsFacts: true, test: l => { const p = num(f(l).parkingSpaces); if (p > 0) return { w: 2, why: `${p} parking space${p > 1 ? 's' : ''}` }; return listy(f(l).parking, /./) ? { w: 1.5, why: f(l).parking.split(',')[0].toLowerCase() } : null; } },
  waterfront: { label: 'water', needsFacts: true, test: l => { if (num(f(l).directWaterfront) > 0) return { w: 4, why: 'direct waterfront' }; const wf = f(l).waterfront || ''; if (/walk to water|beach rights|water community|view/i.test(wf)) return { w: 2, why: wf.split(',')[0].toLowerCase() }; return null; } },
  ac:         { label: 'central air', needsFacts: true, test: l => listy(f(l).cooling, /central air/i) ? { w: 2.5, why: 'central air' } : (listy(f(l).cooling, /./) && f(l).cooling !== 'None' ? { w: 1, why: f(l).cooling.split(',')[0].toLowerCase() } : null) },
  laundry:    { label: 'in-unit laundry', needsFacts: true, test: l => { const v = f(l).laundry || ''; if (!v || v === 'None') return null; if (/coin op|common laundry/i.test(v)) return null; return { w: 2.5, why: `laundry — ${v.split(',')[0].toLowerCase()}` }; } },
  fireplace:  { label: 'a fireplace', needsFacts: true, test: l => { const n = num(f(l).fireplaces); return n > 0 ? { w: 2, why: n > 1 ? `${n} fireplaces` : 'fireplace' } : null; } },
  basement:   { label: 'a finished basement', needsFacts: true, test: l => listy(f(l).basement, /finished/i) && !/unfinished/i.test(f(l).basement) ? { w: 2, why: 'finished basement' } : null },
  newbuild:   { label: 'new construction', needsFacts: true, test: l => { const nc = f(l).newConstruction || ''; if (nc && !/no\/resale/i.test(nc)) return { w: 3, why: nc.toLowerCase() }; const y = num(l._yearBuilt); return y >= 2020 ? { w: 2, why: `built ${y}` } : null; } },
  renovated:  { label: 'move-in ready', needsFacts: true, test: l => { if (/renovat|fully updated|just updated|gut.?renovat|brand new kitchen|move.?in ready|turn.?key/.test(blob(l))) return { w: 2, why: 'renovated / move-in ready' }; const y = num(l._yearBuilt); return y >= 2015 ? { w: 1, why: `built ${y}` } : null; } },
  yard:       { label: 'a yard', needsFacts: true, test: l => { const a = num(l._acres); if (a >= 0.25) return { w: 2.5, why: `${a.toFixed(2)}-acre lot` }; if (a > 0) return { w: 1, why: `${a.toFixed(2)}-acre lot` }; return /fenced|back ?yard/.test(blob(l)) ? { w: 1.5, why: 'yard' } : null; } },
  privacy:    { label: 'privacy / land', needsFacts: true, test: l => { const a = num(l._acres); if (a >= 0.75) return { w: 3, why: `${a.toFixed(2)} private acres` }; return listy(f(l).lotDescription, /wooded|secluded|cul-?de-?sac/i) ? { w: 2, why: 'private setting' } : null; } },
  culdesac:   { label: 'a quiet street', needsFacts: true, test: l => listy(f(l).lotDescription, /cul-?de-?sac|dead ?end/i) ? { w: 2, why: 'on a cul-de-sac' } : (listy(f(l).lotDescription, /wooded/i) ? { w: 1, why: 'wooded lot' } : null) },
  views:      { label: 'views', needsFacts: true, test: l => { const src = `${f(l).lotDescription || ''} ${f(l).waterfront || ''}`; if (/view/i.test(src)) return { w: 2, why: (src.match(/[A-Za-z ]*views?/i) || ['view'])[0].trim().toLowerCase() }; return /skyline view|water view|panoramic/.test(blob(l)) ? { w: 1.5, why: 'views' } : null; } },
  elevator:   { label: 'an elevator', needsFacts: true, test: l => (listy(f(l).amenities, /elevator/i) || /elevator/.test(blob(l))) ? { w: 2, why: 'elevator building' } : null },
  doorman:    { label: 'building amenities', needsFacts: true, test: l => { const a = f(l).amenities || ''; return a && a !== 'None' ? { w: 2, why: a.split(',').slice(0, 2).join(', ').toLowerCase() } : null; } },
  gym:        { label: 'a gym', needsFacts: true, test: l => (listy(f(l).amenities, /exercise|fitness|gym/i) || /fitness cent|gym/.test(blob(l))) ? { w: 2, why: 'fitness room' } : null },
  office:     { label: 'an office / den', needsFacts: true, test: l => /home office|\boffice\b|\bden\b|\bstudy\b|bonus room/.test(blob(l)) ? { w: 2, why: 'office / den space' } : null },
  onelevel:   { label: 'single-level living', needsFacts: true, test: l => { if (listy(f(l).style, /ranch/i)) return { w: 2.5, why: 'ranch — single level' }; return /first ?floor (primary|bed)|main ?level (primary|bed)|no stairs/.test(blob(l)) ? { w: 2, why: 'first-floor bedroom' } : null; } },
  pets:       { label: 'pet friendly', needsFacts: true, test: l => { const p = f(l).pets; if (/^yes$/i.test(p || '')) return { w: 3, why: 'pets allowed' }; if (/restrict/i.test(p || '')) return { w: 1.5, why: `pets — ${(f(l).petsInfo || 'with restrictions').toLowerCase()}`.slice(0, 60) }; return null; } },
  // Reason-only (w:0). The hard exclude already drops anything with a fee; ranking a home UP for
  // a field the feed simply didn't carry would be scoring absence as a feature.
  nohoa:      { label: 'no HOA', needsFacts: true, test: l => num(f(l).hoaFee) > 0 ? null : { w: 0, why: 'no HOA fee in the listing' } },
  schools:    { label: 'school info', needsFacts: true, test: l => f(l).schoolElementary ? { w: 0, why: `${f(l).schoolElementary} Elementary` } : null },   // reported, never ranked (Fair Housing)
  train:      { label: 'near the train', needsFacts: false, test: l => { const m = S.trainMin(l); return m != null && m <= 25 ? { w: m <= 10 ? 3 : m <= 18 ? 2 : 1, why: `${m}-min walk to the train` } : null; } },
  fresh:      { label: 'just listed', needsFacts: false, test: l => { const d = l.daysOnMarket; return d != null && d <= 14 ? { w: 2, why: d <= 1 ? 'listed today' : `listed ${d} days ago` } : null; } },
  big:        { label: 'space', needsFacts: false, test: l => l.sqft >= 2000 ? { w: 1.5, why: `${Math.round(l.sqft).toLocaleString()} sq ft` } : null }
};

/* ---------------------------------------------------------------------------
   PARSE — plain English → the real filters + wants + hard requirements
   --------------------------------------------------------------------------- */
function parse(text) {
  const s = ' ' + text.toLowerCase().replace(/[’']/g, "'") + ' ';
  const out = { raw: text.trim(), wants: [], excl: [], types: [], cities: [], hood: null, minSqft: 0, maxDays: 0, maxHoa: null, beds: null, baths: null, priceMin: null, priceMax: null, listingType: null, maxTrainMin: 0 };

  /* ---- money. "700k" / "$1.2m" / "3500" / "3,500 a month" ---- */
  const dollars = m => {
    let n = parseFloat(String(m).replace(/[,$\s]/g, ''));
    if (!Number.isFinite(n)) return null;
    if (/m\b/i.test(m)) n *= 1e6;
    else if (/k\b/i.test(m)) n *= 1e3;
    else if (n < 100 && n > 0) n *= 1e3;           // "under 700" on a sale search means 700k
    return Math.round(n);
  };
  const MONEY = '\\$?\\s*([\\d][\\d,.]*\\s*[kKmM]?)';
  let m;
  if (m = s.match(new RegExp(`(?:between|from)\\s*${MONEY}\\s*(?:-|to|and)\\s*${MONEY}`, 'i'))) { out.priceMin = dollars(m[1]); out.priceMax = dollars(m[2]); }
  else if (m = s.match(new RegExp(`${MONEY}\\s*(?:-|to)\\s*${MONEY}`, 'i'))) { out.priceMin = dollars(m[1]); out.priceMax = dollars(m[2]); }
  if (out.priceMax == null && (m = s.match(new RegExp(`(?:under|below|less than|up to|max|maximum|no more than|budget of|around|about|~)\\s*${MONEY}`, 'i')))) out.priceMax = dollars(m[1]);
  if (out.priceMin == null && (m = s.match(new RegExp(`(?:over|above|more than|at least|starting at|min|minimum)\\s*${MONEY}`, 'i')))) out.priceMin = dollars(m[1]);

  /* ---- beds / baths. "2-bed", "2 bed", "2bd", "three bedroom" all count; the separator is a
         hyphen as often as a space, which is exactly the miss that silently drops the bed filter. ---- */
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const SEP = '[\\s-]*';
  if (m = s.match(new RegExp(`(\\d+)${SEP}(?:\\+|or more)?${SEP}(?:bed|bd\\b|br\\b|bedroom)`))) out.beds = +m[1];
  else if (m = s.match(new RegExp(`\\b(one|two|three|four|five|six)${SEP}(?:bed|bedroom)`))) out.beds = WORDNUM[m[1]];
  else if (/\bstudio\b/.test(s)) { out.beds = 0; out.wants.push('big'); }
  if (m = s.match(new RegExp(`(\\d+(?:\\.\\d)?)${SEP}(?:\\+|or more)?${SEP}(?:bath|ba\\b|bathroom)`))) out.baths = Math.floor(+m[1]);
  else if (m = s.match(new RegExp(`\\b(one|two|three|four|five)${SEP}(?:bath|bathroom)`))) out.baths = WORDNUM[m[1]];

  /* ---- rent vs buy. Rentals in this feed are all propertyType "Residential Rental",
         so a home-type filter is only ever applied to sale searches (see below). ---- */
  if (/\brent(al|als|ing)?\b|\blease\b|for rent|\/mo\b|per month|a month|monthly/.test(s)) out.listingType = 'rent';
  if (/\bbuy(ing)?\b|purchase|for sale|own(ing)?\b|mortgage/.test(s)) out.listingType = 'sale';
  if (out.listingType == null && out.priceMax != null && out.priceMax <= 15000) out.listingType = 'rent';   // "under $3,500" is a rent budget

  /* ---- home type (sale only) ---- */
  if (/\bcondo|co-?op\b/.test(s)) out.types.push('Condo');
  if (/town ?(house|home)/.test(s)) out.types.push('Townhouse');
  if (/single ?family|\bhouse\b|colonial|\bcape\b|split level/.test(s) && !/town ?(house|home)/.test(s)) out.types.push('Single Family');
  if (/multi ?family|two ?family|2 ?family|duplex|triplex|income property/.test(s)) out.types.push('Multi-Family');
  if (/\bland\b|\blot\b(?! of)|build(ing)? lot/.test(s)) out.types.push('Land');
  if (/\branch\b/.test(s)) { out.types.push('Single Family'); out.wants.push('onelevel'); }

  /* Buy-or-rent, inferred where it wasn't said. Explicit words win (above); then the budget's
     order of magnitude; then the fact that naming a home type — condo, colonial, multi-family —
     is how people talk about buying. Without this, "condo under $700k" asked right after a rent
     search would silently stay on rentals and hand back a $700k-ceiling rent list. */
  if (out.listingType == null && out.priceMax != null && out.priceMax >= 50000) out.listingType = 'sale';
  if (out.listingType == null && out.priceMin != null && out.priceMin >= 50000) out.listingType = 'sale';
  if (out.listingType == null && out.types.length) out.listingType = 'sale';

  /* ---- where ---- */
  const cities = (S.citiesInFeed() || []);
  cities.forEach(c => { if (new RegExp(`\\b${c.toLowerCase().replace(/[^a-z ]/g, '')}\\b`).test(s)) out.cities.push(c); });
  Object.keys(HOODS).forEach(h => { if (s.includes(h)) out.hood = HOODS[h]; });
  if (out.hood && !out.cities.length) out.cities.push('Stamford');

  /* ---- commute. The Train filter is real (walk-minutes to the nearest station,
         computed from lat/lng), so "walk to the train" becomes an actual filter. ---- */
  if (/steps (from|to) the (train|station)|next to the (train|station)/.test(s)) out.maxTrainMin = 5;
  else if (/walk(able|ing)? (distance )?(to|from|of) (the )?(train|station|metro|metro-?north)/.test(s)) out.maxTrainMin = 10;
  else if (/near the (train|station)|by the (train|station)|close to the (train|station)|train|metro-?north|commut|nyc|new york|grand central|manhattan|the city\b/.test(s)) out.maxTrainMin = 15;
  if (out.maxTrainMin) out.wants.push('train');

  /* ---- size / freshness / carrying cost — none of these exist in the filter bar ---- */
  if (m = s.match(/(?:at least|over|more than|min(?:imum)?)?\s*([\d,]{3,6})\s*(?:\+|plus)?\s*(?:sq\.? ?ft|square feet|sf\b)/)) out.minSqft = +m[1].replace(/,/g, '');
  if (/just listed|new(ly)? listed|new this week|newest|brand new listing|came on the market/.test(s)) out.maxDays = 14;
  if (/today|last 24 hours|this weekend/.test(s) && /listed|new/.test(s)) out.maxDays = 3;
  if (m = s.match(/hoa (?:under|below|less than|max)\s*\$?\s*([\d,]+)/)) out.maxHoa = +m[1].replace(/,/g, '');

  /* ---- wants + hard requirements ---- */
  const MAP = [
    [/\bpool\b/, 'pool'],
    [/\bgarage\b|car garage/, 'garage'],
    [/\bparking\b|park my car|off.?street parking/, 'parking'],
    [/waterfront|on the water|water view|beach|harbor|by the water/, 'waterfront'],
    [/central air|\ba\/?c\b|air condition/, 'ac'],
    [/in.?unit laundry|washer|dryer|laundry/, 'laundry'],
    [/fireplace/, 'fireplace'],
    [/finished basement|walk.?out basement|basement/, 'basement'],
    [/new construction|brand new|never lived in|just built/, 'newbuild'],
    [/renovated|updated|move.?in ready|turn.?key|modern kitchen/, 'renovated'],
    [/\byard\b|backyard|garden|room to play|grass/, 'yard'],
    [/privacy|private|secluded|acre|land|wooded/, 'privacy'],
    [/cul.?de.?sac|quiet street|quiet (neighborhood|block)|dead end/, 'culdesac'],
    [/\bviews?\b|skyline/, 'views'],
    [/elevator/, 'elevator'],
    [/doorman|concierge|amenit|rooftop|building has/, 'doorman'],
    [/\bgym\b|fitness|work ?out room/, 'gym'],
    [/home office|\boffice\b|\bden\b|work from home|\bstudy\b/, 'office'],
    [/one story|single level|no stairs|first ?floor (bed|primary|master)|main ?level (bed|primary)|accessib/, 'onelevel'],
    [/\bpets?\b|\bdogs?\b|\bcats?\b|pet.?friendly|dog.?friendly/, 'pets'],
    [/school|district/, 'schools'],
    [/just listed|new(ly)? listed|new this week/, 'fresh'],
    [/(?:big|large|spacious|roomy)(?! ?(?:back)?yard| lot| deck| balcony)/, 'big']   // "big yard" is the yard want, not square footage
  ];
  MAP.forEach(([re, id]) => { if (re.test(s) && !out.wants.includes(id)) out.wants.push(id); });

  /* Hard requirements — only ever from an explicit statement, and only ever
     enforced against an explicit field value (never against missing data). */
  if (/no hoa|without (an )?hoa|no (hoa )?fees|hate hoa|avoid hoa|no association/.test(s)) { out.excl.push('hoa'); out.wants.push('nohoa'); }
  if (/no flood|not in a flood|avoid flood|outside the flood/.test(s)) out.excl.push('flood');
  if (/pet.?friendly|takes (dogs|pets|cats)|allows? (dogs|pets|cats)|with (my|a|our) (dog|cat|pets?)|dog.?friendly/.test(s)) out.excl.push('petsno');
  if (/must have (a )?garage|need (a )?garage|garage required|with (a )?garage/.test(s)) out.excl.push('nogarage');

  out.wants = [...new Set(out.wants)];
  return out;
}

/* ---------------------------------------------------------------------------
   BUILD — parsed sentence → the keep()/score() pair app.js's filtered() runs
   --------------------------------------------------------------------------- */
function build(p, factsReady) {
  const active = p.wants.map(id => ({ id, ...WANTS[id] })).filter(w => w.test && (factsReady || !w.needsFacts));
  return {
    text: p.raw,
    keep(l) {
      if (p.hood && (!l.geo || KM(l.geo, p.hood) > p.hood.km)) return false;
      if (p.minSqft && !(l.sqft >= p.minSqft)) return false;
      if (p.maxDays && !(l.daysOnMarket != null && l.daysOnMarket <= p.maxDays)) return false;
      if (!factsReady) return true;                       // details not loaded yet → nothing to exclude on
      const F = l._facts || {};
      if (p.excl.includes('hoa') && num(F.hoaFee) > 0) return false;
      if (p.maxHoa != null && num(F.hoaFee) > p.maxHoa) return false;
      if (p.excl.includes('flood') && num(F.floodZone) > 0) return false;
      if (p.excl.includes('petsno') && /^no$/i.test(F.pets || '')) return false;     // explicit "No" only
      if (p.excl.includes('nogarage') && F.garages != null && num(F.garages) === 0 && !listy(F.parking, /garage/i)) return false;
      return true;
    },
    score(l) {
      let n = 0;
      active.forEach(w => { const hit = w.test(l); if (hit) n += hit.w; });
      // A gentle nudge for fresher listings so equal matches aren't ordered arbitrarily.
      if (l.daysOnMarket != null) n += Math.max(0, (30 - Math.min(l.daysOnMarket, 30)) / 100);
      return n;
    },
    reasons(l) {
      const out = [];
      active.forEach(w => { const hit = w.test(l); if (hit && hit.why) out.push(hit.why); });
      return [...new Set(out)].slice(0, 3);
    },
    wantIds: active.map(w => w.id)
  };
}

/* ---------------------------------------------------------------------------
   DETAILS — merge the fuller feed in, once, on demand.
   listings-index.json (already loaded) has no facts/remarks; listings.json does.
   Both are keyed by MLS #, so this is a merge onto the objects app.js already
   holds — the map, the cards and the AI keep reading one array.
   --------------------------------------------------------------------------- */
let _factsState = 'none';        // none | loading | ready | failed
let _factsPromise = null;
function loadFacts() {
  if (_factsPromise) return _factsPromise;
  _factsState = 'loading';
  _factsPromise = fetch('data/listings.json', { cache: 'force-cache' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => {
      const by = {};
      (d.listings || []).forEach(x => { by[x.mls] = x; });
      S.state.all.forEach(l => {
        const full = by[l.mls];
        if (!full) return;
        l._facts = full.facts || {};
        l._acres = full.acres;
        l._yearBuilt = full.yearBuilt;
        l._blob = `${full.remarks || ''} ${Object.values(full.facts || {}).join(' ')}`.toLowerCase();
      });
      _factsState = 'ready';
    })
    .catch(err => { _factsState = 'failed'; console.warn('listing details load failed:', err); });
  return _factsPromise;
}

/* ---------------------------------------------------------------------------
   RUN — the whole round trip
   --------------------------------------------------------------------------- */
const money = n => '$' + Math.round(n).toLocaleString('en-US');
// Some listings withhold the street address (IDX §12.2.3) — those carry an empty address.line, and
// printing it raw gave a row that read ", Stamford". Mirror app.js's wording instead.
function addrOf(l) {
  const a = (l && l.address) || {};
  const street = a.line ? a.line + (a.unit ? ' ' + a.unit : '') : 'Address on request';
  return [street, a.city].filter(Boolean).join(', ');
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function chipsFor(p, factsReady, effType) {
  const c = [];
  c.push(effType === 'rent' ? 'Rentals' : 'For sale');
  if (p.cities.length) c.push(p.cities.join(' + '));
  if (p.hood) c.push(p.hood.name);
  if (p.priceMin && p.priceMax) c.push(`${money(p.priceMin)}–${money(p.priceMax)}`);
  else if (p.priceMax) c.push(`up to ${money(p.priceMax)}`);
  else if (p.priceMin) c.push(`${money(p.priceMin)}+`);
  if (p.beds) c.push(`${p.beds}+ bd`);
  if (p.baths) c.push(`${p.baths}+ ba`);
  // Only claim the home-type filter when it was actually applied — on a rent search it isn't,
  // because every rental in this feed carries the same propertyType.
  if (p.types.length && effType !== 'rent') c.push(p.types.join(' / '));
  if (p.maxTrainMin) c.push(`≤ ${p.maxTrainMin}-min walk to train`);
  if (p.minSqft) c.push(`${p.minSqft.toLocaleString()}+ sq ft`);
  if (p.maxDays) c.push(`listed in the last ${p.maxDays} days`);
  if (p.maxHoa != null) c.push(`HOA under ${money(p.maxHoa)}`);
  p.wants.forEach(id => {
    if (id === 'train' || id === 'fresh' || id === 'big') return;                       // already said above
    if (id === 'pets' && p.excl.includes('petsno')) return;                             // the hard "takes pets" chip says it better
    if (id === 'nohoa' && p.excl.includes('hoa')) return;
    const w = WANTS[id]; if (!w) return;
    if (w.needsFacts && !factsReady) return;
    c.push(w.label);
  });
  p.excl.forEach(x => {
    if (!factsReady) return;
    if (x === 'hoa') c.push('no HOA fee');
    if (x === 'flood') c.push('not in a flood zone');
    if (x === 'petsno') c.push('takes pets');
    if (x === 'nogarage') c.push('garage required');
  });
  return [...new Set(c)];
}

let _last = null;     // { p, ai } — kept so the answer can be re-run when details land

function run(text) {
  const raw = (text || '').trim();
  if (!raw) return;
  const p = parse(raw);
  const needsFacts = p.wants.some(id => WANTS[id] && WANTS[id].needsFacts) || p.excl.length || p.maxHoa != null;
  const factsReady = _factsState === 'ready';
  apply(p, factsReady);
  if (needsFacts && !factsReady && _factsState !== 'failed') {
    setBusy(true);
    loadFacts().then(() => { setBusy(false); if (_last && _last.p.raw === raw) apply(p, _factsState === 'ready'); });
  }
}

function apply(p, factsReady) {
  const ai = build(p, factsReady);
  _last = { p, ai, factsReady };
  const n = S.applyFilters({
    type: p.listingType || S.state.type,
    q: '',                                              // the sentence lives in the AI layer, not the text box
    priceMin: p.priceMin || 0,
    priceMax: p.priceMax || 0,
    beds: p.beds == null ? 0 : p.beds,
    baths: p.baths == null ? 0 : p.baths,
    // Every rental in this feed is propertyType "Residential Rental", so a home-type
    // filter on a rent search would return nothing. Sale searches only.
    types: (p.listingType || S.state.type) === 'rent' ? [] : p.types,
    cities: p.cities,
    maxTrainMin: p.maxTrainMin,
    sort: 'ai',
    ai
  });
  renderAnswer(p, ai, n, factsReady);
  btn.classList.add('is-on');
}

/* When nothing matches, find the ONE constraint that costs the most and offer to
   drop it — a dead end with no way forward is where a visitor leaves. Counts come
   from the app's own preview(), so the number on the button is the number of homes
   the click actually produces. */
function relaxation(p) {
  const tries = [];
  if (p.excl.includes('petsno')) tries.push({ label: 'the “takes pets” requirement', patch: { excl: p.excl.filter(x => x !== 'petsno') } });
  else if (p.excl.length) tries.push({ label: 'the strict requirements', patch: { excl: [] } });
  if (p.priceMax) tries.push({ label: `the ${money(p.priceMax)} ceiling (+15%)`, patch: { priceMax: Math.round(p.priceMax * 1.15) } });
  if (p.minSqft) tries.push({ label: `the ${p.minSqft.toLocaleString()} sq ft minimum`, patch: { minSqft: 0 } });
  if (p.hood) tries.push({ label: `the ${p.hood.name} boundary`, patch: { hood: null } });
  if (p.maxTrainMin) tries.push({ label: 'the walk-to-train limit', patch: { maxTrainMin: 0 } });
  if (p.beds) tries.push({ label: `${p.beds} bedrooms (try ${p.beds - 1}+)`, patch: { beds: Math.max(0, p.beds - 1) } });
  if (p.maxDays) tries.push({ label: 'the “just listed” window', patch: { maxDays: 0 } });
  if (p.wants.length) tries.push({ label: 'the nice-to-haves', patch: { wants: p.wants.filter(w => w === 'train'), excl: [] } });
  const effType = p.listingType || S.state.type;
  for (const t of tries) {
    const alt = { ...p, ...t.patch };
    const n = S.preview({
      type: effType, q: '', bounds: null,
      priceMin: alt.priceMin || 0, priceMax: alt.priceMax || 0,
      beds: alt.beds || 0, baths: alt.baths || 0,
      types: effType === 'rent' ? [] : alt.types, cities: alt.cities,
      maxTrainMin: alt.maxTrainMin, ai: build(alt, _factsState === 'ready')
    });
    if (n > 0) return { ...t, n, alt };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   UI
   --------------------------------------------------------------------------- */
const $ = s => document.querySelector(s);
let sheet, btn, input, body, _relax = null;

// grow the composer with the question, up to a few lines
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }

function setBusy(on) {
  const el = $('#aiBusy');
  if (el) el.hidden = !on;
  if (btn) btn.classList.toggle('is-busy', !!on);
}

function renderAnswer(p, ai, n, factsReady) {
  const effType = S.state.type;                          // applyFilters has already moved the segment
  const chips = chipsFor(p, factsReady, effType).map(c => `<span class="ai-chip">${esc(c)}</span>`).join('');
  const noun = effType === 'rent' ? (n === 1 ? 'rental' : 'rentals') : (n === 1 ? 'home' : 'homes');
  let html = '';
  if (n > 0) {
    const top = topMatches(ai, 3);
    html = `<p class="ai-lede"><b>${n}</b> ${noun} match — they're on the map and in the list now, best match first.</p>
      <div class="ai-chips">${chips}</div>
      ${top.length ? `<div class="ai-top">${top.map(t => `
        <button class="ai-hit" type="button" data-mls="${esc(t.l.mls)}">
          <span class="ai-hit-price">${effType === 'rent' ? money(t.l.price) + '<i>/mo</i>' : money(t.l.price)}</span>
          <span class="ai-hit-addr">${esc(addrOf(t.l))}</span>
          <span class="ai-hit-why">${t.why.map(w => esc(w)).join(' · ') || `${t.l.beds || 0} bd · ${t.l.baths || 0} ba`}</span>
        </button>`).join('')}</div>` : ''}
      <p class="ai-foot">Not quite it? Add a detail and ask again, or adjust the filters above — they're yours now.
        <button class="ai-clear" type="button" data-ai-clear>Clear</button></p>`;
  } else {
    const r = relaxation(p);
    html = `<p class="ai-lede">Nothing matches all of that right now — Stamford inventory is tight.</p>
      <div class="ai-chips">${chips}</div>
      ${r ? `<p class="ai-foot"><button class="ai-relax" type="button" data-relax>Show ${r.n} without ${esc(r.label)}</button></p>`
          : `<p class="ai-foot">Tell John exactly what you want and he'll set up a live alert: <a href="tel:2038833399">203·883·3399</a>
             <button class="ai-clear" type="button" data-ai-clear>Clear</button></p>`}`;
    _relax = r;
  }
  body.innerHTML = html;
  sheet.classList.add('has-answer');
  open();
}

// The page's OWN filtered, AI-sorted list — so the three homes named here are literally
// the first three cards on screen, never a separately-computed shortlist that could differ.
function topMatches(ai, k) {
  return S.results().slice(0, k).map(l => ({ l, why: ai.reasons(l) }));
}

const EXAMPLES = {
  sale: ['Condo under $700k with a garage', 'Single family, big yard, cul-de-sac', 'Waterfront in Stamford under $2M', 'Just listed, walkable to the train'],
  rent: ['2-bed under $3,500 that takes dogs', 'In-unit laundry, walk to the train', 'Studio downtown under $2,200', '3 bed with parking and central air']
};

function idleHTML() {
  const ex = EXAMPLES[S.state.type] || EXAMPLES.sale;
  return `<p class="ai-lede">Describe the home you want the way you'd say it out loud. I'll set the filters and sort the best matches first.</p>
    <div class="ai-egs">${ex.map(e => `<button class="ai-eg" type="button" data-eg="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <p class="ai-note">Searches the same live SmartMLS listings as the map — nothing invented, no sign-up.</p>`;
}

function position() {
  const bar = document.getElementById('filterbar');
  if (!bar || !sheet) return;
  if (window.innerWidth <= 760) { sheet.style.top = ''; return; }     // phone = bottom sheet, CSS owns it
  sheet.style.top = Math.round(bar.getBoundingClientRect().bottom + 8) + 'px';
}

function open(prefill) {
  if (!sheet) return;
  position();
  sheet.hidden = false;
  void sheet.offsetHeight;                 // force the reflow that makes the transition run. NOT
  sheet.classList.add('is-open');          // requestAnimationFrame — that never fires in a hidden
                                           // tab, which left the panel open-but-invisible.
  btn.setAttribute('aria-expanded', 'true');
  if (prefill != null) { input.value = prefill; autoGrow(); }   // a seeded question must be readable in full
  if (!sheet.classList.contains('has-answer')) body.innerHTML = idleHTML();
  if (window.innerWidth > 760) setTimeout(() => input.focus(), 60);
}
function close() {
  if (!sheet) return;
  sheet.classList.remove('is-open');
  btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!sheet.classList.contains('is-open')) sheet.hidden = true; }, 220);
}
function clearAI() {
  sheet.classList.remove('has-answer');
  _last = null;
  input.value = '';
  S.applyFilters({ ai: null, sort: 'new', priceMin: 0, priceMax: 0, beds: 0, baths: 0, types: [], cities: [], maxTrainMin: 0, q: '' });
  body.innerHTML = idleHTML();
  btn.classList.remove('is-on');
}

/* A location like "Shippan" is a normal search-box query; a sentence is a question
   for the AI. This is the whole reason the feature sits on the search box instead
   of in the nav — the visitor types where they already type, and Enter does the
   smart thing. */
function looksLikeQuestion(v) {
  const s = v.trim();
  if (s.length < 12) return false;
  if (s.split(/\s+/).length < 3) return false;
  // A street address — number first, street suffix last — stays a literal address lookup however
  // many want-words it happens to contain ("50 Fireplace Lane", "12 Park View Drive"). Matching on
  // the leading number alone was wrong: it also swallowed "2 bedroom under 3000 a month".
  if (/^\d+\s+.+\b(?:st|street|ave|avenue|rd|road|ln|lane|dr|drive|ct|court|pl|place|blvd|boulevard|way|ter|terrace|cir|circle|hwy|pkwy|row)\b\.?$/i.test(s)) return false;
  // A digit alone isn't enough ("Stamford CT 06902"); it takes an actual want word.
  return /under|over|below|with|without|near|walk|commut|bed|bath|pet|dog|cat|garage|parking|laundry|pool|yard|quiet|budget|month|\$|sq ?ft|square feet|hoa|train|view|waterfront|renovat|elevator|fireplace|basement|acre|cul.?de.?sac|move.?in|just listed/i.test(s);
}

function boot() {
  sheet = document.getElementById('aiSheet');
  btn = document.getElementById('aiBtn');
  input = document.getElementById('aiInput');
  body = document.getElementById('aiBody');
  if (!sheet || !btn || !input || !body) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (sheet.classList.contains('is-open')) { close(); return; }
    const q = document.getElementById('q');
    open(q && looksLikeQuestion(q.value) ? q.value : undefined);
  });
  document.getElementById('aiClose').addEventListener('click', close);
  document.getElementById('aiSend').addEventListener('click', () => run(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(input.value); }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('input', autoGrow);

  body.addEventListener('click', e => {
    const eg = e.target.closest('[data-eg]');
    if (eg) { input.value = eg.dataset.eg; run(input.value); return; }
    if (e.target.closest('[data-ai-clear]')) { clearAI(); return; }
    if (e.target.closest('[data-relax]') && _relax) { apply(_relax.alt, _factsState === 'ready'); return; }
    const hit = e.target.closest('[data-mls]');
    // Open the real listing card's drawer — one detail view for the whole app, not a second one here.
    if (hit) { const card = document.querySelector(`.card[data-mls="${hit.dataset.mls}"]`); if (card) card.click(); }
  });

  // The search box doubles as the AI's front door: a sentence + Enter runs the AI
  // instead of a fruitless literal address match.
  const q = document.getElementById('q');
  if (q) {
    q.addEventListener('input', () => btn.classList.toggle('is-hot', looksLikeQuestion(q.value)));
    q.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !looksLikeQuestion(q.value)) return;
      e.preventDefault();
      const text = q.value;
      q.value = '';
      open(text);
      run(text);
    });
  }

  window.addEventListener('resize', position);
  window.addEventListener('dts:ai-cleared', () => { sheet.classList.remove('has-answer'); btn.classList.remove('is-on'); _last = null; if (sheet.classList.contains('is-open')) body.innerHTML = idleHTML(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('is-open')) close(); });

  // ?ai=<question> — shareable, and how every "Ask AI" link on the site arrives here.
  // Read it NOW, not inside onReady: app.js's first render() calls syncURL(), which rebuilds the
  // query string from state and would drop the param before the listings finish loading.
  const seed = new URLSearchParams(location.search).get('ai');
  if (seed != null) S.onReady(() => {
    if (seed === '1' || seed === '' || seed === 'true') { open(); return; }
    open(seed);
    run(seed);
  });
}

if (S) boot();
