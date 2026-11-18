// Converts an AI-authored strategy into ordinary Kinstead commands, then
// evaluates them against an isolated save copy. The model never receives a
// mutation primitive; only commands that survive this module may reach Game.cmd.

import { BUILDINGS } from '../defs.js';
import { COMMANDS, runCommand } from '../commands.js';
import { serialize, deserialize } from '../save/saves.js';

export const ACTION_KINDS = Object.freeze(['place', 'upgrade', 'expand', 'merge', 'move', 'demolish', 'roads', 'terraform', 'wait']);

const text = (v, n = 500) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const int = (v) => Number.isInteger(Number(v)) ? Number(v) : null;
const coords = (v, max = 256) => Array.isArray(v) ? v.slice(0, max).map(p => Array.isArray(p) && p.length === 2 ? [int(p[0]), int(p[1])] : null).filter(p => p && p.every(Number.isInteger)) : [];

export function normalizePlan(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(source.actions) ? source.actions : [];
  return {
    title: text(source.title, 100) || 'Municipal assessment',
    summary: text(source.summary, 1200),
    causes: (Array.isArray(source.causes) ? source.causes : []).slice(0, 12).map(v => text(v, 500)).filter(Boolean),
    actions: list.slice(0, 40).map((a, index) => ({
      id: text(a?.id, 80) || `action-${index + 1}`,
      kind: ACTION_KINDS.includes(a?.kind) ? a.kind : 'invalid',
      buildingType: text(a?.buildingType, 80) || null,
      buildingId: int(a?.buildingId), otherBuildingId: int(a?.otherBuildingId),
      x: int(a?.x), z: int(a?.z), to: text(a?.to, 80) || null,
      direction: int(a?.direction), expansionKind: text(a?.expansionKind, 30) || null,
      roadLevel: int(a?.roadLevel), tiles: coords(a?.tiles), terrainMode: text(a?.terrainMode, 20) || null,
      waitDays: Math.max(0, Math.min(30, Number(a?.waitDays) || 0)),
      rationale: text(a?.rationale, 800), expectedOutcome: text(a?.expectedOutcome, 800),
      issueIds: (Array.isArray(a?.issueIds) ? a.issueIds : []).slice(0, 12).map(v => text(v, 80)).filter(Boolean),
    })),
    naturalProgression: (Array.isArray(source.naturalProgression) ? source.naturalProgression : []).slice(0, 12).map(v => text(v, 500)).filter(Boolean),
    unresolved: (Array.isArray(source.unresolved) ? source.unresolved : []).slice(0, 12).map(v => text(v, 500)).filter(Boolean),
  };
}

export function commandForAction(a) {
  switch (a.kind) {
    case 'place': return { t: 'place', type: a.buildingType, x: a.x, z: a.z };
    case 'upgrade': return { t: 'upgrade', id: a.buildingId, ...(a.to ? { to: a.to } : {}) };
    case 'expand': return { t: 'expand', id: a.buildingId, dir: a.direction, kind: a.expansionKind };
    case 'merge': return { t: 'merge', a: a.buildingId, b: a.otherBuildingId };
    case 'move': return { t: 'move', id: a.buildingId, x: a.x, z: a.z };
    case 'demolish': return { t: 'demolish', id: a.buildingId };
    case 'roads': return { t: 'roads', level: a.roadLevel, tiles: a.tiles };
    case 'terraform': return { t: 'terraform', x: a.x, z: a.z, mode: a.terrainMode };
    default: return null;
  }
}

const targetIds = (world, cmd) => {
  const ids = cmd.t === 'merge' ? [cmd.a, cmd.b] : ['upgrade', 'expand', 'move', 'demolish'].includes(cmd.t) ? [cmd.id] : [];
  if (cmd.t === 'expand') {
    const b = world.buildings.get(cmd.id), opt = b && world.expandOptions(b).find(o => o.dir === cmd.dir && o.kind === cmd.kind);
    if (opt?.other) ids.push(opt.other.id);
    for (const o of opt?.absorb || []) ids.push(o.id);
  }
  return [...new Set(ids)];
};
const destructive = (cmd) => ['expand', 'merge', 'move', 'demolish', 'upgrade'].includes(cmd.t);

export function permissionFor(world, cmd) {
  switch (cmd.t) {
    case 'place': return 'construction';
    case 'upgrade': return 'upgrades';
    case 'expand': case 'merge': return 'expansion';
    case 'roads': return 'roads';
    case 'move': return 'relocation';
    case 'terraform': return 'terrain';
    case 'demolish': {
      const b = world.buildings.get(cmd.id), d = b && BUILDINGS[b.type];
      return d && (d.park || d.cat === 'parks') ? 'demolishDecorative' : 'demolishFunctional';
    }
    default: return null;
  }
}

export function permissionsFor(world, cmd) {
  const out = [permissionFor(world, cmd)].filter(Boolean);
  if (cmd.t === 'expand') {
    const b = world.buildings.get(cmd.id), opt = b && world.expandOptions(b).find(o => o.dir === cmd.dir && o.kind === cmd.kind);
    const removed = [opt?.other, ...(opt?.absorb || [])].filter(Boolean);
    for (const victim of removed) {
      const d = BUILDINGS[victim.type], p = d && (d.park || d.cat === 'parks') ? 'demolishDecorative' : 'demolishFunctional';
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export function preservationCheck(world, cmd) {
  if (!destructive(cmd)) return { ok: true };
  const buildings = targetIds(world, cmd).map(id => world.buildings.get(id)).filter(Boolean);
  const landmark = buildings.find(b => b.protection === 'protected');
  if (landmark) return { ok: false, hard: true, reason: `Building ${landmark.id} is a Protected Landmark` };
  const preserve = buildings.find(b => b.protection === 'preserve');
  if (preserve) return { ok: false, hard: false, reason: `Building ${preserve.id} is marked Preserve if Possible` };
  return { ok: true };
}

function schemaValid(world, cmd) {
  const def = cmd && COMMANDS[cmd.t];
  if (!def) return false;
  try { return !!def.check(world, cmd); } catch { return false; }
}

export function validateInterventionPlan(game, rawPlan, config) {
  const plan = normalizePlan(rawPlan), original = serialize(game.world), clone = deserialize(original);
  const fake = { world: clone, demo: false, emit() {} };
  const accepted = [], proposals = [], invalid = [];
  let commands = 0, redevelopment = 0;

  for (const action of plan.actions) {
    if (action.kind === 'wait') {
      proposals.push({ action, command: null, reason: action.waitDays ? `Allow ${action.waitDays} day(s) of natural simulation progression` : 'Await natural simulation progression', wait: true });
      continue;
    }
    const cmd = commandForAction(action);
    if (!cmd || !schemaValid(clone, cmd)) { invalid.push({ action, command: cmd, reason: 'Invalid or unsupported command shape' }); continue; }
    if (commands >= config.commandLimit) { invalid.push({ action, command: cmd, reason: `Session command limit is ${config.commandLimit}` }); continue; }
    const protect = preservationCheck(clone, cmd);
    if (!protect.ok && protect.hard) { invalid.push({ action, command: cmd, reason: protect.reason }); continue; }
    const r = runCommand(fake, cmd);
    if (!r || (r.ok === false && r.placed === undefined)) { invalid.push({ action, command: cmd, reason: r?.reason || 'Kinstead rejected the action' }); continue; }
    if (r.placed === 0) { invalid.push({ action, command: cmd, reason: r.failed || 'No road tiles could be placed' }); continue; }
    commands++;
    const isRedevelopment = ['demolish', 'move'].includes(cmd.t) || cmd.t === 'expand' && ['takeover', 'strip'].includes(cmd.kind);
    if (isRedevelopment && ++redevelopment > config.redevelopmentLimit) {
      proposals.push({ action, command: cmd, reason: `Redevelopment scope exceeds this session’s limit of ${config.redevelopmentLimit}` });
      continue;
    }
    const permissions = permissionsFor(game.world, cmd);
    const authorized = config.mode === 'catchup' && permissions.length && permissions.every(p => config.permissions[p] === true) && protect.ok;
    const entry = { action, command: cmd, permission: permissions.join(', '), permissions, result: { ok: true, cost: r.cost ?? r.spent ?? null } };
    if (authorized) accepted.push(entry);
    else proposals.push({ ...entry, reason: !protect.ok ? protect.reason : config.mode !== 'catchup' ? 'Advisory Mode does not change the town' : `Permission “${permissions.filter(p => !config.permissions[p]).join(', ')}” is not granted` });
  }

  return {
    plan, accepted, proposals, invalid,
    safe: invalid.length === 0,
    checkedAgainst: { day: game.world.day, buildings: game.world.buildings.size, residents: game.world.residents.size },
    note: 'Feasibility was tested sequentially against an isolated copy. Hypothetical effects are estimates until the live simulation verifies them.',
  };
}

const actionProperties = {
  id: { type: 'string' }, kind: { type: 'string', enum: ACTION_KINDS }, buildingType: { type: ['string', 'null'] },
  buildingId: { type: ['integer', 'null'] }, otherBuildingId: { type: ['integer', 'null'] }, x: { type: ['integer', 'null'] }, z: { type: ['integer', 'null'] },
  to: { type: ['string', 'null'] }, direction: { type: ['integer', 'null'] }, expansionKind: { type: ['string', 'null'] },
  roadLevel: { type: ['integer', 'null'] }, tiles: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
  terrainMode: { type: ['string', 'null'] }, waitDays: { type: 'number' }, rationale: { type: 'string' }, expectedOutcome: { type: 'string' },
  issueIds: { type: 'array', items: { type: 'string' } },
};
export const SUBMIT_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'submit_intervention_plan',
    description: 'Submit the final bounded municipal plan after investigation. This does not execute anything; Kinstead validates every action locally.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, summary: { type: 'string' }, causes: { type: 'array', items: { type: 'string' } },
        actions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: actionProperties, required: ['id', 'kind', 'buildingType', 'buildingId', 'otherBuildingId', 'x', 'z', 'to', 'direction', 'expansionKind', 'roadLevel', 'tiles', 'terrainMode', 'waitDays', 'rationale', 'expectedOutcome', 'issueIds'] } },
        naturalProgression: { type: 'array', items: { type: 'string' } }, unresolved: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'summary', 'causes', 'actions', 'naturalProgression', 'unresolved'],
    },
  },
};
