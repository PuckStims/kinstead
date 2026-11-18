// Focused checks for Municipal Intelligence's authority boundary, persistence,
// deterministic diagnostics, dense-site analysis and API termination limits.

import { World } from '../src/world/world.js';
import { growDemoTown } from '../src/world/demo.js';
import { Sim } from '../src/sim/sim.js';
import { serialize, deserialize } from '../src/save/saves.js';
import { runCommand } from '../src/commands.js';
import { inspectTownSummary, inspectActiveIssues, inspectBuilding, inspectEducationPipeline, findConstructionSites, findRedevelopmentSites } from '../src/municipal/diagnostics.js';
import { cleanMunicipalConfig, getOpenRouterKey, setOpenRouterKey, saveMunicipalConfig, redactSecret } from '../src/municipal/config.js';
import { SUBMIT_PLAN_TOOL, validateInterventionPlan } from '../src/municipal/plan.js';
import { runMunicipalAgent } from '../src/municipal/openrouter.js';
import { executeAuthorizedActions } from '../src/municipal/controller.js';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok  ', msg); else { failures++; console.error('FAIL', msg); } };
const stableSave = (world) => { const s = serialize(world); s.savedAt = null; return JSON.stringify(s); };

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.get(k) ?? null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const scene = { add() {}, remove() {} };
const game = { speed: 0, env: { night: 0 }, renderer: { scene }, view: { smoke: { emit() {} } }, _ev: {}, on(e, f) { (this._ev[e] ||= []).push(f); }, emit(e, d) { for (const f of this._ev[e] || []) f(d); } };
const w = World.createNew({ N: 32, seed: 8331, name: 'Civic Test' });
growDemoTown(w, 8331, 1);
game.world = w;
game.sim = new Sim(game);
game.sim.seedFounders();
game.construction = null;
game.demo = false;

// Secrets are session-scoped and durable settings contain no credential.
const durable = new MemoryStorage(), session = new MemoryStorage();
setOpenRouterKey('sk-or-v1-secret-example', session);
saveMunicipalConfig({ model: 'openrouter/free', permissions: { construction: true } }, durable);
ok(getOpenRouterKey(session) === 'sk-or-v1-secret-example' && ![...durable.m.values()].join('').includes('secret-example'), 'the OpenRouter key is session-only and absent from durable settings');
ok(!redactSecret('OpenRouter rejected sk-or-v9-future-secret').includes('future-secret'), 'OpenRouter credentials are redacted without depending on a key-version format');
ok(cleanMunicipalConfig({ requestLimit: 999, commandLimit: -2 }).requestLimit === 12 && cleanMunicipalConfig({ requestLimit: 999, commandLimit: -2 }).commandLimit === 0, 'request and command limits are clamped locally');

// Diagnostic reads are compact and cannot mutate simulation state.
const before = stableSave(w);
const summary = inspectTownSummary(game), issues = inspectActiveIssues(game), education = inspectEducationPipeline(game);
ok(summary.population === w.population && Array.isArray(issues) && Array.isArray(education.institutions), 'town, issue and education tools return structured authoritative data');
ok(stableSave(w) === before, 'read-only municipal diagnostics do not mutate the town');
const understaffed = [...w.buildings.values()].find(b => b.blockers?.includes('workers'));
const staffingFact = understaffed && inspectBuilding(game, understaffed.id);
ok(staffingFact && staffingFact.workers < staffingFact.capacity.jobs && staffingFact.blockers.includes('workers'), 'staffing dependencies are exposed separately from building capacity');

// Preservation is a player command, persists, and reaches multiplayer/save-shaped records.
const protectedBuilding = [...w.buildings.values()].find(b => !b.con);
ok(runCommand(game, { t: 'protect', id: protectedBuilding.id, protection: 'protected' }).ok, 'a building can be designated a Protected Landmark through a game command');
const reloaded = deserialize(JSON.parse(JSON.stringify(serialize(w))));
ok(reloaded.buildings.get(protectedBuilding.id).protection === 'protected', 'preservation designations survive a save round-trip');

const cfg = cleanMunicipalConfig({ mode: 'catchup', commandLimit: 6, redevelopmentLimit: 2, permissions: { demolishFunctional: true, demolishDecorative: true, construction: true, upgrades: true, expansion: true, roads: true, relocation: true, terrain: true } });
const protectedPlan = validateInterventionPlan(game, { actions: [{ id: 'remove-landmark', kind: 'demolish', buildingId: protectedBuilding.id, rationale: 'test', expectedOutcome: 'test' }] }, cfg);
ok(protectedPlan.accepted.length === 0 && protectedPlan.invalid[0]?.reason.includes('Protected Landmark'), 'Protected Landmarks are inviolable even with broad demolition permission');

runCommand(game, { t: 'protect', id: protectedBuilding.id, protection: 'preserve' });
const preservePlan = validateInterventionPlan(game, { actions: [{ id: 'move-preserved', kind: 'move', buildingId: protectedBuilding.id, x: 0, z: 0, rationale: 'test', expectedOutcome: 'test' }] }, cfg);
ok(preservePlan.accepted.length === 0, 'Preserve if Possible buildings are never silently altered');

// Invalid AI output is rejected without changing the active world.
const snapshot = stableSave(w);
const bad = validateInterventionPlan(game, { actions: [{ id: 'off-map', kind: 'place', buildingType: 'clinic', x: -99, z: 999, rationale: 'test', expectedOutcome: 'test' }, { id: 'script', kind: 'javascript', rationale: 'test' }] }, cfg);
ok(bad.invalid.length === 2 && stableSave(w) === snapshot, 'invalid and unknown AI actions are rejected in an isolated copy');

// A live command can still fail after a counterfactual check (for example if
// multiplayer state changes). The executor restores the complete checkpoint.
const open = findConstructionSites(game, { buildingType: 'clinic', limit: 1 }).sites[0];
const livePlan = open && validateInterventionPlan(game, { actions: [{ id: 'clinic', kind: 'place', buildingType: 'clinic', x: open.x, z: open.z, rationale: 'test rollback', expectedOutcome: 'test' }] }, cfg);
const checkpoint = serialize(w), failingGame = {
  ...game, world: w, sim: game.sim, isGuest: false,
  cmd(c, done) { const r = { ok: false, reason: 'Simulated intervening-state failure' }; done?.(r); return r; },
  load(world) { this.world = world; this.sim = new Sim(this); this.sim.recompute(); },
};
const failedRun = livePlan ? await executeAuthorizedActions(failingGame, livePlan, cfg, checkpoint) : null;
ok(failedRun?.rolledBack && failedRun.failures.length === 1 && stableSave(failingGame.world) === stableSave(deserialize(checkpoint)), 'a failed live intervention restores the complete pre-session checkpoint');

// Find a genuinely dense local patch: no accepted empty plot in the radius,
// but at least one occupied plot can be evaluated for legitimate reuse.
let dense = null;
for (const b of w.buildings.values()) {
  if (b.protection || b.con) continue;
  const area = { x: b.x + 0.5, z: b.z + 0.5, radius: 1 };
  const free = findConstructionSites(game, { buildingType: 'clinic', area, limit: 4 });
  const reuse = findRedevelopmentSites(game, { buildingType: 'clinic', area, limit: 4 });
  if (free.count === 0 && reuse.candidates.length) { dense = { free, reuse }; break; }
}
ok(!!dense && dense.free.count === 0 && dense.reuse.candidates.length > 0, 'dense neighborhoods consider validated redevelopment instead of stopping at “no vacant land”');

// The tool loop terminates under a model that keeps asking the same question.
let calls = 0;
const repeatingFetch = async () => ({
  ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: `c${++calls}`, type: 'function', function: { name: 'inspect_town_summary', arguments: '{}' } }] } }] }),
});
let bounded = false;
try {
  await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [], executeTool: () => summary, limits: { requestLimit: 2, toolRoundLimit: 5, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: repeatingFetch });
} catch (e) { bounded = e.code === 'request_limit'; }
ok(bounded && calls === 2, 'an unproductive agent stops at the configured API-request limit');

// Routed providers can return an error envelope with HTTP 200. Surface its
// actual explanation instead of collapsing it to “no assistant message”.
const providerErrorFetch = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ error: { message: 'No eligible tool-capable provider' } }) });
let providerError = null;
try {
  await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [], executeTool: () => ({}), limits: { requestLimit: 1, toolRoundLimit: 1, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: providerErrorFetch });
} catch (e) { providerError = e; }
ok(providerError?.message.includes('No eligible tool-capable provider'), 'provider error envelopes preserve their useful explanation');

// An intermittent empty routed response is retried without consuming a tool
// round, while every attempt still counts against the API-request limit.
let intermittentCalls = 0;
const intermittentFetch = async () => ++intermittentCalls === 1
  ? ({ ok: true, json: async () => ({ choices: [] }) })
  : ({ ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'after-retry', type: 'function', function: { name: 'submit_intervention_plan', arguments: JSON.stringify({ title: 'Recovered', summary: 'The retry succeeded.', causes: [], actions: [], naturalProgression: [], unresolved: [] }) } }] } }] }) });
const intermittent = await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [SUBMIT_PLAN_TOOL], executeTool: () => summary, limits: { requestLimit: 3, toolRoundLimit: 3, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: intermittentFetch });
ok(intermittent.plan.title === 'Recovered' && intermittent.requests === 2 && intermittent.rounds === 1, 'an intermittent empty routed response is retried within the hard request budget');

// A model may investigate correctly and then conclude in prose instead of
// using the submission tool. Preserve the investigation and request bounded
// JSON rather than throwing it away.
let proseCalls = 0;
const proseConclusionFetch = async () => {
  const n = ++proseCalls;
  if (n === 1) return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'inspect-before-prose', type: 'function', function: { name: 'inspect_town_summary', arguments: '{}' } }] } }] }) };
  if (n === 2) return { ok: true, json: async () => ({ choices: [{ message: { content: 'The town should wait for current students to graduate.' } }] }) };
  return { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"Wait for graduates","summary":"Existing capacity should mature first.","causes":[],"actions":[],"naturalProgression":["Allow current students to graduate."],"unresolved":[]}' } }] }) };
};
const proseConclusion = await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [SUBMIT_PLAN_TOOL], executeTool: () => summary, limits: { requestLimit: 4, toolRoundLimit: 4, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: proseConclusionFetch });
ok(proseConclusion.plan.title === 'Wait for graduates' && proseConclusion.requests === 3, 'a prose conclusion after real investigation is converted into a bounded final plan');

// Some routed providers return an empty response for a named forced tool call.
// The last round therefore exposes only a relaxed submit tool, then falls back
// once to plain JSON while the local validation boundary remains unchanged.
let finalRequests = 0, finalShape = null, fallbackShape = null;
const compatibleFinalFetch = async (_url, opts) => {
  const body = JSON.parse(opts.body), n = ++finalRequests;
  if (n === 1) return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'inspect-first', type: 'function', function: { name: 'inspect_town_summary', arguments: '{}' } }] } }] }) };
  if (n === 2) { finalShape = body; return { ok: true, json: async () => ({ choices: [] }) }; }
  fallbackShape = body;
  return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"title":"Bounded conclusion","summary":"Investigation complete.","causes":[],"actions":[],"naturalProgression":[],"unresolved":[]}\n```' } }] }) };
};
const compatibleFinal = await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [SUBMIT_PLAN_TOOL], executeTool: () => summary, limits: { requestLimit: 3, toolRoundLimit: 2, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: compatibleFinalFetch });
ok(compatibleFinal.plan.title === 'Bounded conclusion' && finalShape.tools.length === 1 && finalShape.tools[0].function.name === 'submit_intervention_plan' && finalShape.tools[0].function.strict == null && finalShape.tool_choice === 'auto' && fallbackShape.tools == null, 'the last round tolerates empty forced-tool responses and still produces a bounded locally validated plan');

// A submitted plan ends the loop without executing or exposing mutation tools.
const submittedFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'final', type: 'function', function: { name: 'submit_intervention_plan', arguments: JSON.stringify({ title: 'Wait', summary: 'Capacity is adequate.', causes: [], actions: [], naturalProgression: ['Allow current pupils to graduate.'], unresolved: [] }) } }] } }] }) });
const agent = await runMunicipalAgent({ key: 'sk-or-v1-test', model: 'test', system: 'test', initial: 'test', tools: [], executeTool: () => ({}), limits: { requestLimit: 3, toolRoundLimit: 3, tokenLimit: 256, timeoutMs: 5000 }, fetchImpl: submittedFetch });
ok(agent.plan.title === 'Wait' && agent.requests === 1, 'a no-construction municipal judgment can be submitted as a complete plan');

if (failures) { console.error(`\n${failures} municipal check(s) failed`); process.exit(1); }
console.log('\nMunicipal Intelligence checks passed.');
