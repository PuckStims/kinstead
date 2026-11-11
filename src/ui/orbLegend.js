// Read-only, source-backed guide to the Living Window visual language.

import { IDENTITY_PALETTE, TRAIT_PALETTE } from '../render/chromatic.js';
import { ORB_DETAIL_STOPS } from '../render/orbs.js';

const esc = (value) => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const identitySwatches = () => IDENTITY_PALETTE.map(color => `
  <div class="orb-swatch" title="${esc(color.hex)}">
    <i style="--orb-color:${esc(color.hex)}" aria-hidden="true"></i>
    <span><b>${esc(color.name)}</b><small>Identity ${esc(color.id)}</small></span>
  </div>`).join('');

const traitSwatches = () => Object.values(TRAIT_PALETTE).map(color => `
  <div class="orb-swatch trait" title="${esc(color.hex)}">
    <i style="--orb-color:${esc(color.hex)}" aria-hidden="true"></i>
    <span><b>${esc(color.display)}</b><small>${esc(color.name)}</small></span>
  </div>`).join('');

const detailStages = [
  { at: 0, label: 'Far view', text: 'A calm, monochromatic identity core.' },
  { at: ORB_DETAIL_STOPS.accentStart, label: 'Approaching', text: 'Personality colors begin to surface.' },
  { at: ORB_DETAIL_STOPS.accentClear, label: 'Near view', text: 'One or two trait wisps become readable.' },
  { at: ORB_DETAIL_STOPS.expansionStart, label: 'Closer', text: 'The mantle and wisps gently open outward.' },
  { at: ORB_DETAIL_STOPS.expansionFull, label: 'Expanded', text: 'The mantle and wisps reach their full spread.' },
  { at: ORB_DETAIL_STOPS.circulationFull, label: 'Closest', text: 'Full circulation and breathing detail.' },
];

export function orbLegendHTML() {
  const zoom = detailStages.map(stage => `
    <div class="orb-zoom-stage" data-detail-at="${stage.at}">
      <b>${stage.label}</b><span>${stage.text}</span>
    </div>`).join('');

  return `<h2>Chromatic Orb legend</h2>
    <p class="lead">Every Orb is an existing Kinstead resident. Its colors and motion reveal information the simulation already knows; they never change how that resident lives.</p>

    <div class="orb-legend-intro">
      <div class="orb-legend-demo" aria-hidden="true">
        <i class="halo"></i><i class="core"></i><i class="wisp one"></i><i class="wisp two"></i>
      </div>
      <div class="orb-channels">
        <div><b>Core hue</b><span>Permanent visual identity, stable through the resident's life and after loading a save.</span></div>
        <div><b>Accent wisps</b><span>One or two colors matching the resident's existing personality traits.</span></div>
        <div><b>Luminosity</b><span>Brightness follows Kinstead's modeled-wellbeing score, with a visible minimum.</span></div>
        <div><b>Pulse &amp; circulation</b><span>Subtle rhythms interpret existing walking, working, waiting, sitting and riding states.</span></div>
        <div><b>Outer vapor</b><span>Atmospheric decoration only; it carries no additional simulation meaning.</span></div>
      </div>
    </div>

    <section class="orb-legend-section" aria-labelledby="orbIdentityHead">
      <h3 id="orbIdentityHead">Permanent identity families</h3>
      <p>Twelve curated families provide a consistent core color. Sharing one does not imply a family relationship or any personality, mood or demographic meaning.</p>
      <div class="orb-swatches identities">${identitySwatches()}</div>
    </section>

    <section class="orb-legend-section" aria-labelledby="orbTraitHead">
      <h3 id="orbTraitHead">Personality accent wisps</h3>
      <p>Each displayed accent corresponds to an existing trait. Two traits remain two distinct colors rather than blending into a new meaning.</p>
      <div class="orb-swatches traits">${traitSwatches()}</div>
    </section>

    <section class="orb-legend-section" aria-labelledby="orbZoomHead">
      <h3 id="orbZoomHead">What changes as you zoom</h3>
      <div class="orb-zoom-flow">${zoom}</div>
    </section>

    <section class="orb-legend-section" aria-labelledby="orbActivityHead">
      <h3 id="orbActivityHead">Activity motion</h3>
      <div class="orb-activity-grid">
        <div><b>Stationary</b><span>Slow circulation</span></div>
        <div><b>Walking</b><span>Faint directional trail</span></div>
        <div><b>Working outdoors</b><span>Controlled rhythmic pulse</span></div>
        <div><b>Sitting</b><span>Subdued expansion</span></div>
        <div><b>Waiting for transit</b><span>Slow regular pulse</span></div>
        <div><b>Riding transit</b><span>Contained smooth circulation</span></div>
      </div>
    </section>

    <p class="note orb-legend-note"><b>Color adds context; it never replaces text.</b> The resident inspector still states personality traits and the numeric modeled-wellbeing score. Mood brightness is not presented as a complete account of anyone's emotional or psychological experience.</p>`;
}
