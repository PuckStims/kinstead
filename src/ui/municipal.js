import { MunicipalController } from '../municipal/controller.js';
import { getOpenRouterKey, setOpenRouterKey, clearOpenRouterKey, loadMunicipalConfig, saveMunicipalConfig } from '../municipal/config.js';
import { testOpenRouterConnection } from '../municipal/openrouter.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PERMISSIONS = [
  ['construction', 'New construction'], ['upgrades', 'Building upgrades'], ['expansion', 'Expansion and consolidation'], ['roads', 'Road construction'],
  ['relocation', 'Building relocation'], ['demolishDecorative', 'Demolish unrestricted decorative amenities'], ['demolishFunctional', 'Demolish unrestricted functional buildings'],
  ['terrain', 'Terrain modification'], ['advanceTime', 'Simulation time advancement (reserved)'],
];

const reportHTML = (r) => {
  if (!r) return '<div class="municipal-empty">No assessment has been run in this session.</div>';
  const items = (xs, empty = 'None') => xs?.length ? `<ul>${xs.map(x => {
    if (typeof x === 'string') return `<li>${esc(x)}</li>`;
    const label = x.text || x.rationale || x.id || 'Item';
    return `<li>${esc(label)}${x.reason ? ` — ${esc(x.reason)}` : ''}</li>`;
  }).join('')}</ul>` : `<p class="muted">${empty}</p>`;
  const actions = (xs, empty) => xs?.length ? `<div class="municipal-actions">${xs.map(x => `<div class="municipal-action"><b>${esc(x.kind || x.command?.t || 'Action')}</b><span>${esc(x.rationale || '')}</span>${x.reason ? `<small>${esc(x.reason)}</small>` : ''}${x.command?.id != null ? `<button class="btn small" data-muni-focus="${x.command.id}">Show</button>` : ''}</div>`).join('')}</div>` : `<p class="muted">${empty}</p>`;
  return `<div class="municipal-report">
    <h3>${esc(r.title)}</h3><p>${esc(r.summary || 'Assessment completed.')}</p>
    <div class="municipal-report-grid">
      <section><h4>Shared underlying causes</h4>${items(r.causes, 'No shared cause was established.')}</section>
      <section><h4>Interventions performed</h4>${actions(r.performed, r.mode === 'advisory' ? 'Advisory Mode made no changes.' : 'No automatic action was appropriate.')}</section>
      <section><h4>Verified improvements</h4>${items(r.verified?.resolvedIssues, 'No issue has disappeared yet; construction and population changes can require natural progression.')}</section>
      <section><h4>Awaiting approval</h4>${actions(r.proposals, 'No proposals require additional permission.')}</section>
      <section><h4>Awaiting natural progression</h4>${items(r.naturalProgression, 'None identified.')}</section>
      <section><h4>Unresolved or rejected</h4>${items([...(r.unresolved || []), ...(r.invalid || [])], 'None.')}</section>
    </div>
    ${r.rolledBack ? '<div class="municipal-alert bad">An intervention failed, so the complete session was rolled back to its checkpoint.</div>' : ''}
    <div class="municipal-foot">Checkpoint: Catch Up checkpoint · ${r.limits.requests} API request(s), ${r.limits.toolCalls} investigative call(s). Hypothetical outcomes are not shown as verified.</div>
  </div>`;
};

const formHTML = (cfg, hasKey) => `<div class="municipal-intro"><span class="ms">account_balance</span><div><b>Municipal Intelligence</b><p>OpenRouter investigates. Kinstead supplies facts, enforces your permissions, and remains the final authority.</p></div></div>
  <div class="municipal-tabs"><label><input type="radio" name="muniMode" value="advisory" ${cfg.mode === 'advisory' ? 'checked' : ''}> Advisory</label><label><input type="radio" name="muniMode" value="catchup" ${cfg.mode === 'catchup' ? 'checked' : ''}> Catch Up</label></div>
  <div class="grid2">
    <div class="field"><label>OpenRouter API key <span class="chip">session only</span></label><input id="muniKey" type="password" autocomplete="off" placeholder="${hasKey ? 'Key stored for this browser tab' : 'sk-or-v1-…'}"><small>Never saved in the town, reports, durable settings, or source code.</small></div>
    <div class="field"><label>Tool-capable model</label><input id="muniModel" value="${esc(cfg.model)}"><small><code>openrouter/free</code> asks OpenRouter to choose a compatible free model.</small></div>
  </div>
  <div class="actions"><button class="btn" id="muniTest">Test connection</button><button class="btn" id="muniClear" ${hasKey ? '' : 'disabled'}>Forget key</button><span id="muniConnection" class="muted"></span></div>
  <details><summary>Limits and permissions</summary>
    <div class="municipal-limits">
      <label>API requests <input id="muniRequests" type="number" min="1" max="12" value="${cfg.requestLimit}"></label>
      <label>Tool rounds <input id="muniRounds" type="number" min="1" max="10" value="${cfg.toolRoundLimit}"></label>
      <label>Tokens / request <input id="muniTokens" type="number" min="256" max="6000" value="${cfg.tokenLimit}"></label>
      <label>Commands / session <input id="muniCommands" type="number" min="0" max="20" value="${cfg.commandLimit}"></label>
      <label>Redevelopments <input id="muniRedevelop" type="number" min="0" max="5" value="${cfg.redevelopmentLimit}"></label>
    </div>
    <div class="municipal-permissions">${PERMISSIONS.map(([k, n]) => `<label><input type="checkbox" data-muni-perm="${k}" ${cfg.permissions[k] ? 'checked' : ''} ${k === 'advanceTime' ? 'disabled' : ''}> ${esc(n)}</label>`).join('')}</div>
    <p class="note">Protected Landmarks remain inviolable. “Preserve if Possible” buildings are proposals, not automatic redevelopment.</p>
  </details>
  <div id="muniStatus" class="municipal-status"><span class="ms">info</span><span>Ready to assess the current town.</span></div>
  <div class="actions"><button class="btn primary" id="muniRun"><span class="ms">auto_awesome</span> ${cfg.mode === 'catchup' ? 'Catch Up' : 'Assess town'}</button></div>
  <div id="muniReport"></div>`;

const readForm = (c, prior) => ({
  ...prior,
  mode: c.querySelector('[name="muniMode"]:checked')?.value || 'advisory',
  model: c.querySelector('#muniModel').value,
  requestLimit: Number(c.querySelector('#muniRequests').value), toolRoundLimit: Number(c.querySelector('#muniRounds').value),
  tokenLimit: Number(c.querySelector('#muniTokens').value), commandLimit: Number(c.querySelector('#muniCommands').value), redevelopmentLimit: Number(c.querySelector('#muniRedevelop').value),
  permissions: Object.fromEntries([...c.querySelectorAll('[data-muni-perm]')].map(el => [el.dataset.muniPerm, el.checked])),
});

export function showMunicipal(ui) {
  const controller = ui._municipal ||= new MunicipalController(ui.game);
  const cfg = loadMunicipalConfig(), hasKey = !!getOpenRouterKey();
  ui.openModal(`<h2>Catch Up</h2>${formHTML(cfg, hasKey)}`, (c) => {
    c.classList.add('wide', 'municipal-win');
    const status = (text, kind = '') => {
      const el = c.querySelector('#muniStatus');
      el.className = `municipal-status ${kind}`;
      el.innerHTML = `<span class="ms">${kind === 'bad' ? 'error' : kind === 'good' ? 'check_circle' : 'progress_activity'}</span><span>${esc(text)}</span>`;
    };
    const saveKeyIfEntered = () => {
      const v = c.querySelector('#muniKey').value.trim();
      if (v) { setOpenRouterKey(v); c.querySelector('#muniKey').value = ''; c.querySelector('#muniKey').placeholder = 'Key stored for this browser tab'; c.querySelector('#muniClear').disabled = false; }
      return getOpenRouterKey();
    };
    const renderReport = () => {
      c.querySelector('#muniReport').innerHTML = reportHTML(controller.lastReport);
      for (const b of c.querySelectorAll('[data-muni-focus]')) b.onclick = () => {
        const building = ui.world.buildings.get(Number(b.dataset.muniFocus));
        if (building) { ui.inspect({ kind: 'building', id: building.id }); ui.game.renderer.lookAt(building.x + (building.w ?? building.size) / 2, building.z + (building.d ?? building.size) / 2); }
      };
    };
    renderReport();
    for (const r of c.querySelectorAll('[name="muniMode"]')) r.onchange = () => { c.querySelector('#muniRun').innerHTML = `<span class="ms">auto_awesome</span> ${r.value === 'catchup' && r.checked ? 'Catch Up' : 'Assess town'}`; };
    c.querySelector('#muniClear').onclick = () => { clearOpenRouterKey(); c.querySelector('#muniKey').placeholder = 'sk-or-v1-…'; c.querySelector('#muniClear').disabled = true; c.querySelector('#muniConnection').textContent = 'Key forgotten.'; };
    c.querySelector('#muniTest').onclick = async () => {
      const btn = c.querySelector('#muniTest'), key = saveKeyIfEntered(), next = saveMunicipalConfig(readForm(c, cfg));
      btn.disabled = true; c.querySelector('#muniConnection').textContent = 'Testing…';
      try {
        const r = await testOpenRouterConnection({ key, model: next.model, timeoutMs: next.timeoutMs });
        c.querySelector('#muniConnection').textContent = r.warning || `Connected${r.modelName ? ` · ${r.modelName}` : ''}`;
      } catch (e) { c.querySelector('#muniConnection').textContent = e.message; }
      finally { btn.disabled = false; }
    };
    c.querySelector('#muniRun').onclick = async () => {
      const btn = c.querySelector('#muniRun'), key = saveKeyIfEntered(), next = saveMunicipalConfig(readForm(c, cfg));
      btn.disabled = true;
      try {
        const report = await controller.run(next, key, s => status(s.text || s.phase));
        renderReport();
        status(report.proposals.length ? 'Assessment complete. Some actions need your permission or manual approval.' : 'Assessment complete.', 'good');
        ui.renderIssues();
      } catch (e) { status(e.message, 'bad'); }
      finally { btn.disabled = false; }
    };
  });
}
