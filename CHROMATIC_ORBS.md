# Living Window — Chromatic Orbs v0.1

Chromatic Orbs are a presentation layer over Kinstead's existing residents. They do not create or modify resident state, paths, schedules, collisions, transit, economics, relationships, or saves.

## Visual channels

| Channel | Existing source | Meaning |
| --- | --- | --- |
| Core hue | `resident.look`, with stable `resident.id` fallback | Permanent visual identity from one of twelve curated families |
| Accent wisps | `traitsOf(resident)` | The resident's existing one or two personality traits |
| Luminosity | `resident.mood` | A smooth, clamped view of Kinstead's modeled-wellbeing score, with a visible floor |
| Pulse and circulation | Existing walker flags | Walking, outdoor work, sitting, transit waiting, riding, or stationary |
| Outer mantle | Renderer time plus a deterministic resident phase | Decorative atmosphere only |

The identity and trait palettes in [`src/render/chromatic.js`](src/render/chromatic.js) are the canonical Supplement A values. Identity variation is deterministic and bounded to ±3° hue, ±5% saturation, and ±7% lightness. No visual mapping uses `Math.random()` or writes to a resident.

### Identity families

| 01 Sea Glass | 02 Verdigris | 03 Moss Sage | 04 Willow | 05 Honey Gold | 06 Amber Clay |
| --- | --- | --- | --- | --- | --- |
| `#67C9C0` | `#4FAFA3` | `#8EBB8A` | `#A7C97A` | `#D8B45C` | `#D8925B` |
| 07 Rose Ember | 08 Mauve Bloom | 09 Lavender Smoke | 10 Cornflower | 11 Twilight Blue | 12 Pearl Aqua |
| `#D97C89` | `#B982B8` | `#9B8FD1` | `#789EDB` | `#5C7FC9` | `#8FD6E1` |

### Personality accents

| Trait key | Display name | Accent | Hex |
| --- | --- | --- | --- |
| `early` | Early riser | Dawn Gold | `#F2C14E` |
| `owl` | Night owl | Midnight Indigo | `#4C5C96` |
| `homebody` | Homebody | Hearth Rose | `#D98A8A` |
| `social` | Sociable | Bright Coral | `#F28C6B` |
| `shopper` | Big spender | Hot Magenta | `#D95FA8` |
| `thrifty` | Thrifty | Olive Brass | `#8D9A52` |
| `bookish` | Bookish | Ink Blue | `#5E81C5` |
| `playful` | Playful | Candy Peach | `#F4A261` |
| `curious` | Curious | Electric Turquoise | `#4EC5D4` |
| `diligent` | Hard-working | Iron Violet | `#7D6AA8` |
| `outdoorsy` | Outdoorsy | Leaf Green | `#66B96D` |
| `devout` | Devout | Candle Ivory | `#F3E7B3` |

Mood is an existing, limited household-and-employment model. Orb brightness therefore describes **modeled wellbeing**, not a comprehensive emotional or psychological state. The inspector retains the numeric mood and personality text and also explains the Orb channels, so color is never the only source of information.

## Rendering

[`src/render/orbs.js`](src/render/orbs.js) consumes the exact walker list already culled and crowd-thinned by `Agents`. Every Orb is assembled from shared instanced meshes: core, mantle, two optional wisps, halo, ground contact, and one invisible sun-shadow stand-in. Resident count does not create per-resident materials, particle systems, or draw calls.

The renderer only reads walker position and activity flags. Selection, picking, building visibility, lantern ownership, camera behavior, and simulation movement remain in their existing systems. Settings → Display → Villager style can hot-swap the view between **Orbs** (default) and the original **Minions** without replacing walkers or changing save data.

[`src/ui/orbIcon.js`](src/ui/orbIcon.js) uses the same mapping for static SVG portraits and generic population clusters.

## Compatibility contract

`lookOf()`, `dressOf()`, `carryFrom()`, and `strideLen()` remain in [`src/render/villagers.js`](src/render/villagers.js). `Agents` still uses their scale, lane, speed, stride, clothing/carry metadata, and the existing `draw(walkers, env, camera)` handoff. The legacy `VillagerView` and Minion assets remain available as the visual fallback.

Focused checks live in [`scripts/chromatic-check.js`](scripts/chromatic-check.js) and are included in `npm run check`.
