// Focused checks for Living Window's presentation-only chromatic layer.

import * as THREE from 'three';
import { IDENTITY_PALETTE, TRAIT_PALETTE, chromaticOf, identityOf, luminosityOf } from '../src/render/chromatic.js';
import { OrbView, orbActivityOf } from '../src/render/orbs.js';
import { orbIcon } from '../src/ui/orbIcon.js';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok  ', msg); else { failures++; console.error('FAIL', msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const identityHex = ['#67C9C0', '#4FAFA3', '#8EBB8A', '#A7C97A', '#D8B45C', '#D8925B', '#D97C89', '#B982B8', '#9B8FD1', '#789EDB', '#5C7FC9', '#8FD6E1'];
const traitHex = {
  early: '#F2C14E', owl: '#4C5C96', homebody: '#D98A8A', social: '#F28C6B', shopper: '#D95FA8', thrifty: '#8D9A52',
  bookish: '#5E81C5', playful: '#F4A261', curious: '#4EC5D4', diligent: '#7D6AA8', outdoorsy: '#66B96D', devout: '#F3E7B3',
};
ok(same(IDENTITY_PALETTE.map(c => c.hex), identityHex), 'the twelve approved identity colors are exact and ordered');
ok(same(Object.fromEntries(Object.entries(TRAIT_PALETTE).map(([k, v]) => [k, v.hex])), traitHex), 'the twelve approved trait accents are exact');

const resident = { id: 41, look: 0x12345678, age: 'adult', mood: 72, job: 9, home: 3, loc: 'walk', first: 'Ada' };
const before = JSON.stringify(resident), first = chromaticOf(resident), reloaded = chromaticOf(JSON.parse(JSON.stringify(resident)));
ok(first.identity.hex === reloaded.identity.hex && same(first.accents, reloaded.accents), 'identity and personality colors survive a save-shaped JSON reload');
ok(JSON.stringify(resident) === before, 'chromatic calculations do not mutate resident data');

const otherLife = { ...resident, age: resident.age, mood: 4, job: 88, home: 77, loc: 'in', school: 12 };
ok(identityOf(otherLife).hex === first.identity.hex, 'mood, work, home, school and location do not change permanent identity');
const dim = chromaticOf({ ...resident, mood: 0 }), bright = chromaticOf({ ...resident, mood: 100 });
ok(dim.identity.hex === bright.identity.hex && same(dim.accents, bright.accents) && dim.luminosity.intensity < bright.luminosity.intensity, 'mood changes luminosity only');
ok(luminosityOf(-50).mood === 0 && luminosityOf(500).mood === 100 && luminosityOf(0).intensity >= 0.45, 'mood is visually clamped with a visible brightness floor');

const socialA = chromaticOf({ id: 1, look: 1, age: 'adult', mood: 50, _traits: ['social'], _traitAge: 'adult' });
const socialB = chromaticOf({ id: 2, look: 2, age: 'adult', mood: 50, _traits: ['social'], _traitAge: 'adult' });
ok(socialA.identity.hex !== socialB.identity.hex && socialA.accents[0].hex === traitHex.social && socialB.accents[0].hex === traitHex.social, 'the same trait keeps its accent across different identities');

const idFallback = identityOf({ id: 'resident-9' });
ok(idFallback.hex === identityOf({ id: 'resident-9', mood: 1, age: 'elder' }).hex, 'stable id is a deterministic fallback when look is missing');
const safe = chromaticOf(null);
ok(/^#[0-9A-F]{6}$/.test(safe.identity.hex) && safe.accents.length === 0 && safe.luminosity.intensity > 0, 'missing resident data produces a visible neutral fallback');

const frozen = Object.freeze({ id: 8, look: 8877, age: 'child', mood: 30 });
let frozenSafe = true;
try { chromaticOf(frozen); } catch { frozenSafe = false; }
ok(frozenSafe, 'frozen resident data can be mapped without a write');

const oldRandom = Math.random;
let randomSafe = true;
try { Math.random = () => { throw new Error('visual identity used Math.random'); }; chromaticOf(resident); } catch { randomSafe = false; } finally { Math.random = oldRandom; }
ok(randomSafe, 'chromatic identity does not use Math.random or advance simulation randomness');

ok(orbActivityOf({ moving: true, mode: 'path' }) === 'walking'
  && orbActivityOf({ moving: false, working: true, mode: 'wander' }) === 'working'
  && orbActivityOf({ moving: false, mode: 'wait' }) === 'waiting'
  && orbActivityOf({ moving: false, sit: true, mode: 'wait' }) === 'sitting'
  && orbActivityOf({ moving: false, mode: 'ride' }) === 'riding', 'existing walker flags map to the five specified activity rhythms');

const scene = new THREE.Scene(), view = new OrbView(scene, 8);
const walker = { x: 3, y: 0.4, z: 5, delay: 0, heading: 0.7, moving: true, working: false, sit: false, mode: 'path', speedK: 1.1, lk: { scale: 0.95 }, r: resident, lamp: false };
const movementBefore = JSON.stringify({ x: walker.x, y: walker.y, z: walker.z, heading: walker.heading, moving: walker.moving, mode: walker.mode, speedK: walker.speedK });
view.draw([walker], {}, null);
ok(view.core.count === 1 && view.mantle.count === 1 && view.wisps.every(w => w.count === 1), 'OrbView draws one walker through shared instanced layers');
ok([view.core, view.mantle, view.halo, ...view.wisps].every(m => !m.material.vertexColors && m.instanceColor && m.instanceColor.array.some(v => v > 0)), 'Orb layers use non-black instance colors without a missing vertex-color attribute');
ok(JSON.stringify({ x: walker.x, y: walker.y, z: walker.z, heading: walker.heading, moving: walker.moving, mode: walker.mode, speedK: walker.speedK }) === movementBefore, 'drawing an Orb does not change movement state');
const svg = orbIcon(resident);
ok(svg.includes(first.identity.hex) && first.accents.every(a => svg.includes(a.hex)), 'the SVG portrait uses the same identity and trait colors as the world Orb');
const owned = scene.children.length;
view.dispose();
ok(owned === 7 && scene.children.length === 0, 'OrbView creates and disposes all shared rendering resources');

console.log(failures ? `\n${failures} chromatic check(s) failed` : '\nall chromatic checks passed');
process.exit(failures ? 1 : 0);
