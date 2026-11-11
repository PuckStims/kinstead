// Compact, static SVG counterparts to the 3D Orbs. Both views ask the same
// chromatic module for identity, traits and modeled-wellbeing luminosity.

import { chromaticOf } from '../render/chromatic.js';

const cache = new Map();
const n2 = (v) => Math.round(v * 100) / 100;

export function orbIcon(r) {
  const c = chromaticOf(r), core = c.identity.hex;
  const accents = c.accents.map(a => a.hex);
  const glow = n2(c.luminosity.halo), light = n2(c.luminosity.intensity);
  const key = `${c.seed}|${core}|${accents.join('|')}|${glow}|${light}`;
  let svg = cache.get(key);
  if (svg) return svg;

  const id = `og${c.seed.toString(36)}${c.identity.index}${Math.round(light * 100)}`;
  const second = accents[1]
    ? `<path d="M6.3 18.8C7.1 12.8 15.1 9.2 18.1 14.8" fill="none" stroke="${accents[1]}" stroke-width="1.45" stroke-linecap="round" opacity=".76"/>`
    : '';
  const first = accents[0]
    ? `<path d="M5.4 13.5C8.5 8.2 16.4 9.2 18.4 15.6" fill="none" stroke="${accents[0]}" stroke-width="1.65" stroke-linecap="round" opacity=".82"/>`
    : '';
  svg = `<svg class="orb" viewBox="0 0 24 30" aria-hidden="true">` +
    `<defs><radialGradient id="${id}" cx="38%" cy="30%" r="70%"><stop offset="0" stop-color="#fffdf3" stop-opacity="${n2(0.3 + light * 0.42)}"/><stop offset=".28" stop-color="${core}"/><stop offset="1" stop-color="${core}" stop-opacity=".72"/></radialGradient></defs>` +
    `<circle cx="12" cy="15" r="10.5" fill="${core}" opacity="${n2(0.05 + glow * 0.09)}"/>` +
    `<ellipse cx="12" cy="15.2" rx="8.8" ry="9.2" fill="${core}" opacity=".18"/>` +
    `<circle cx="12" cy="15" r="7.2" fill="url(#${id})" stroke="#fffdf3" stroke-opacity="${n2(0.08 + glow * 0.13)}" stroke-width=".45"/>` +
    first + second +
    `<path d="M7.2 10.7C8.8 7.8 13.1 6.9 15.6 8.8" fill="none" stroke="#fffdf3" stroke-width="1" stroke-linecap="round" opacity="${n2(0.1 + light * 0.26)}"/>` +
    `<ellipse cx="12" cy="25.2" rx="5.8" ry="1.1" fill="#172126" opacity=".19"/>` +
    `</svg>`;
  if (cache.size > 2048) cache.clear();
  cache.set(key, svg);
  return svg;
}

// Generic people symbols are deliberately a small chromatic cluster rather
// than pretending to describe any particular resident.
export const ORB = `<svg class="orb1" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#67C9C0" opacity=".14"/><circle cx="12" cy="12" r="7.1" fill="#67C9C0" opacity=".88"/><circle cx="9.7" cy="9.7" r="2.3" fill="#fffdf3" opacity=".42"/><path d="M6.5 13.8c2.4-5.4 8.9-5.8 11.2-.7" fill="none" stroke="#F2C14E" stroke-width="1.7" stroke-linecap="round" opacity=".86"/></svg>`;

export const ORBS = `<svg class="orb1" viewBox="0 0 24 24" aria-hidden="true"><g opacity=".96"><circle cx="8" cy="14.5" r="6.3" fill="#D97C89" opacity=".2"/><circle cx="8" cy="14.5" r="4.5" fill="#D97C89"/><path d="M4.8 15.2c1.9-3.4 5.1-3.2 6.8-.3" fill="none" stroke="#4EC5D4" stroke-width="1.1" stroke-linecap="round"/></g><g opacity=".96"><circle cx="15.7" cy="9.2" r="6.5" fill="#789EDB" opacity=".2"/><circle cx="15.7" cy="9.2" r="4.7" fill="#789EDB"/><circle cx="14.2" cy="7.8" r="1.5" fill="#fffdf3" opacity=".4"/><path d="M12.1 10c1.5-3.1 5-3.5 7.1-.7" fill="none" stroke="#66B96D" stroke-width="1.2" stroke-linecap="round"/></g></svg>`;
