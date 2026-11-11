// Living Window's visual language for residents.
//
// Each channel deliberately reads existing simulation data without changing it:
//   identity       r.look (stable r.id fallback)     permanent core colour
//   personality    traitsOf(r)                       one or two accent wisps
//   luminosity     r.mood                            modeled-wellbeing glow
// Activity is interpreted by OrbView from the existing walker flags. Decorative
// mantle motion is renderer-only and carries no additional simulation meaning.

import { traitsOf } from '../sim/people.js';

export const IDENTITY_PALETTE = Object.freeze([
  Object.freeze({ id: '01', name: 'Sea Glass', hex: '#67C9C0' }),
  Object.freeze({ id: '02', name: 'Verdigris', hex: '#4FAFA3' }),
  Object.freeze({ id: '03', name: 'Moss Sage', hex: '#8EBB8A' }),
  Object.freeze({ id: '04', name: 'Willow', hex: '#A7C97A' }),
  Object.freeze({ id: '05', name: 'Honey Gold', hex: '#D8B45C' }),
  Object.freeze({ id: '06', name: 'Amber Clay', hex: '#D8925B' }),
  Object.freeze({ id: '07', name: 'Rose Ember', hex: '#D97C89' }),
  Object.freeze({ id: '08', name: 'Mauve Bloom', hex: '#B982B8' }),
  Object.freeze({ id: '09', name: 'Lavender Smoke', hex: '#9B8FD1' }),
  Object.freeze({ id: '10', name: 'Cornflower', hex: '#789EDB' }),
  Object.freeze({ id: '11', name: 'Twilight Blue', hex: '#5C7FC9' }),
  Object.freeze({ id: '12', name: 'Pearl Aqua', hex: '#8FD6E1' }),
]);

export const TRAIT_PALETTE = Object.freeze({
  early: Object.freeze({ trait: 'early', display: 'Early riser', name: 'Dawn Gold', hex: '#F2C14E' }),
  owl: Object.freeze({ trait: 'owl', display: 'Night owl', name: 'Midnight Indigo', hex: '#4C5C96' }),
  homebody: Object.freeze({ trait: 'homebody', display: 'Homebody', name: 'Hearth Rose', hex: '#D98A8A' }),
  social: Object.freeze({ trait: 'social', display: 'Sociable', name: 'Bright Coral', hex: '#F28C6B' }),
  shopper: Object.freeze({ trait: 'shopper', display: 'Big spender', name: 'Hot Magenta', hex: '#D95FA8' }),
  thrifty: Object.freeze({ trait: 'thrifty', display: 'Thrifty', name: 'Olive Brass', hex: '#8D9A52' }),
  bookish: Object.freeze({ trait: 'bookish', display: 'Bookish', name: 'Ink Blue', hex: '#5E81C5' }),
  playful: Object.freeze({ trait: 'playful', display: 'Playful', name: 'Candy Peach', hex: '#F4A261' }),
  curious: Object.freeze({ trait: 'curious', display: 'Curious', name: 'Electric Turquoise', hex: '#4EC5D4' }),
  diligent: Object.freeze({ trait: 'diligent', display: 'Hard-working', name: 'Iron Violet', hex: '#7D6AA8' }),
  outdoorsy: Object.freeze({ trait: 'outdoorsy', display: 'Outdoorsy', name: 'Leaf Green', hex: '#66B96D' }),
  devout: Object.freeze({ trait: 'devout', display: 'Devout', name: 'Candle Ivory', hex: '#F3E7B3' }),
});

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A small integer mixer. It is used only for visual choices; no random state is
// read or advanced, so asking for an Orb cannot change simulation outcomes.
function mix32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function hashString(value) {
  let h = 0x811c9dc5;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// r.look is authoritative. An id is only used when older or incomplete data
// has no appearance seed. The final constant gives malformed records one safe,
// visible and deterministic fallback rather than throwing.
export function chromaticSeed(r) {
  if (r && Number.isFinite(r.look)) return r.look >>> 0;
  if (r && r.id != null && r.id !== '') return typeof r.id === 'number' && Number.isFinite(r.id) ? r.id >>> 0 : hashString(r.id);
  return 0x8fd6e1;
}

function hexToHsl(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >>> 16) & 255) / 255, g = ((n >>> 8) & 255) / 255, b = (n & 255) / 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
  let h = 0;
  if (d) {
    if (hi === r) h = ((g - b) / d) % 6;
    else if (hi === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const l = (hi + lo) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const byte = (v) => clamp(Math.round((v + m) * 255), 0, 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

export function identityOf(r) {
  const seed = chromaticSeed(r), mixed = mix32(seed ^ 0x51f15e5d);
  const index = mixed % IDENTITY_PALETTE.length, family = IDENTITY_PALETTE[index];
  const [h, s, l] = hexToHsl(family.hex);
  const unit = (salt) => mix32(seed ^ salt) / 0xffffffff;
  const hue = h + (unit(0x9e3779b9) * 6 - 3);             // approved ±3°
  const saturation = clamp(s + (unit(0x85ebca6b) * 0.1 - 0.05), 0.25, 0.85); // ±5%
  const lightness = clamp(l + (unit(0xc2b2ae35) * 0.14 - 0.07), 0.35, 0.78);  // ±7%
  return Object.freeze({
    index, id: family.id, name: family.name, baseHex: family.hex,
    hex: hslToHex(hue, saturation, lightness), hue, saturation, lightness,
  });
}

export function traitAccentsOf(r) {
  if (!r) return [];
  // traitsOf maintains a cache on its argument. Give it a shallow copy so the
  // shared chromatic layer stays observational even for frozen resident data.
  // Without a look seed there is no authoritative trait derivation to display.
  if (!Number.isFinite(r.look) && !Array.isArray(r._traits)) return [];
  let keys;
  try { keys = traitsOf({ ...r }); } catch { keys = []; }
  return [...new Set(keys)].map(key => TRAIT_PALETTE[key]).filter(Boolean).slice(0, 2);
}

// Smoothly map the existing 0–100 mood score to a restrained visible glow.
// The returned value is presentation-only; r.mood is never clamped or written.
export function luminosityOf(mood) {
  const value = Number.isFinite(mood) ? clamp(mood, 0, 100) : 60;
  // Smoothstep avoids a mechanical-looking response near either end while
  // retaining a 45% floor so a low-scoring resident never disappears.
  const x = value / 100, smooth = x * x * (3 - 2 * x);
  return Object.freeze({ mood: value, intensity: 0.45 + smooth * 0.55, halo: 0.32 + smooth * 0.68 });
}

export function chromaticOf(r) {
  const seed = chromaticSeed(r);
  return Object.freeze({
    seed,
    identity: identityOf(r),
    accents: Object.freeze(traitAccentsOf(r)),
    luminosity: luminosityOf(r && r.mood),
    phase: (mix32(seed ^ 0x27d4eb2d) / 0xffffffff) * TAU,
    fallback: !(r && (Number.isFinite(r.look) || r.id != null)),
  });
}
