// Compact, read-only municipal facts exposed to the planning model. Every
// value is derived from the current World/Sim; these tools never write to it.

import { BUILDINGS, SERVICES, servicesOf } from '../defs.js';
import { capOf, fw, fd, isOpen, buildingCenter } from '../world/world.js';
import { computeIssues } from '../ui/issues.js';
import { eduOf, EDU, yearsOf, stageForAge } from '../sim/people.js';

const round = (n, places = 1) => Number.isFinite(n) ? Number(n.toFixed(places)) : n;
const limit = (a, n = 24) => a.slice(0, n);
const sum = (a) => a.reduce((s, n) => s + n, 0);
const centerOf = (b) => buildingCenter(b);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const safeArea = (w, area = {}) => ({
  x: Number.isFinite(area.x) ? Math.max(0, Math.min(w.N - 1, area.x)) : w.N / 2,
  z: Number.isFinite(area.z) ? Math.max(0, Math.min(w.N - 1, area.z)) : w.N / 2,
  radius: Number.isFinite(area.radius) ? Math.max(1, Math.min(w.N, area.radius)) : w.N,
});

export function buildingFact(b) {
  if (!b || !BUILDINGS[b.type]) return null;
  const d = BUILDINGS[b.type], L = d.levels[b.level];
  return {
    id: b.id, type: b.type, name: L.name, category: d.cat, level: b.level,
    x: b.x, z: b.z, width: fw(b), depth: fd(b), connected: !!b.connected,
    open: isOpen(b), construction: b.con?.kind || null, protection: b.protection || 'unrestricted',
    residents: b.residents?.length || 0, workers: b.workers?.length || 0,
    capacity: { housing: capOf(b, 'housing'), jobs: capOf(b, 'jobs'), seats: capOf(b, 'seats') },
    services: servicesOf(d), working: round(b.working ?? 0, 2), blockers: b.blockers || [],
    happiness: b.happiness ?? null, pollution: L.pollution || 0, power: L.kw || 0, water: L.supply || 0,
  };
}
export function inspectTownSummary(game) {
  const w = game.world, s = game.sim;
  const categories = {};
  for (const b of w.buildings.values()) categories[BUILDINGS[b.type].cat] = (categories[BUILDINGS[b.type].cat] || 0) + 1;
  const adults = [...w.residents.values()].filter(r => r.age === 'adult');
  return {
    town: w.townName, day: w.day, hour: round(w.hours), mapSize: w.N,
    population: w.population, buildings: w.buildings.size, categories,
    money: Number.isFinite(w.money) ? round(w.money) : 'unlimited', dailyBalance: round(s.budget?.net || 0),
    happiness: round(s.happiness || 0),
    housing: { used: s.housing?.used || 0, capacity: s.housing?.cap || 0, open: s.housing?.open || 0 },
    workforce: { adults: adults.length, employed: adults.filter(r => r.job != null).length, unemployed: adults.filter(r => r.job == null && r.school == null).length, skilledVacancies: s.jobsNeedingSkill || 0 },
    utility: s.utility || null,
    constructionSites: [...w.buildings.values()].filter(b => b.con).length,
    sandbox: { ...w.sandbox },
  };
}

export function inspectActiveIssues(game) {
  return computeIssues(game).map((i, index) => ({
    id: i.id || `issue-${index + 1}`, severity: i.sev, text: i.text,
    buildingIds: limit(i.act?.ids || [], 30), residentFilter: i.act?.filter || i.act?.people || null,
    suggestedInterface: i.act?.cat || i.act?.kind || null,
  }));
}

export function inspectIssue(game, issueId) {
  const issues = inspectActiveIssues(game);
  const issue = issues.find(i => i.id === issueId) || issues[Number(String(issueId).replace(/\D/g, '')) - 1];
  if (!issue) return { error: 'Issue not found', available: issues.map(i => i.id) };
  return { ...issue, buildings: issue.buildingIds.map(id => buildingFact(game.world.buildings.get(id))).filter(Boolean) };
}

export function inspectBuilding(game, id) {
  const b = game.world.buildings.get(Number(id));
  if (!b) return { error: 'Building not found' };
  const fact = buildingFact(b);
  fact.upgrades = game.world.upgradeOptions(b).map(o => ({ type: o.type, level: o.level, extend: !!o.extend })).slice(0, 12);
  return fact;
}

export function inspectNeighborhood(game, args = {}) {
  const w = game.world, a = safeArea(w, args), at = { x: a.x, z: a.z };
  const buildings = [...w.buildings.values()].map(b => ({ b, d: dist(centerOf(b), at) })).filter(e => e.d <= a.radius).sort((x, y) => x.d - y.d);
  return {
    area: a,
    buildings: limit(buildings, 40).map(e => ({ ...buildingFact(e.b), distance: round(e.d) })),
    residents: sum(buildings.map(e => e.b.residents?.length || 0)),
    workers: sum(buildings.map(e => e.b.workers?.length || 0)),
  };
}

export function inspectServiceCoverage(game, args = {}) {
  const type = args.serviceType;
  if (!SERVICES[type] && !['power', 'water', 'pollution'].includes(type)) return { error: 'Unknown service type' };
  const w = game.world, s = game.sim, a = safeArea(w, args.area || args), at = { x: a.x, z: a.z };
  const homes = [...w.buildings.values()].filter(b => capOf(b, 'housing') && dist(centerOf(b), at) <= a.radius);
  const coverage = s.coverage?.[type];
  const covered = (b) => {
    if (type === 'pollution') return (b.factors?.pollution || 0) <= 6;
    if (type === 'water') return !!b.factors?.water;
    const c = centerOf(b), x = Math.max(0, Math.min(w.N - 1, Math.floor(c.x))), z = Math.max(0, Math.min(w.N - 1, Math.floor(c.z)));
    return coverage ? coverage[w.idx(x, z)] > 0 : !!b.factors?.[type];
  };
  const missing = homes.filter(b => !covered(b));
  const providers = [...w.buildings.values()].filter(b => servicesOf(BUILDINGS[b.type]).includes(type));
  return {
    serviceType: type, area: a, homes: homes.length, coveredHomes: homes.length - missing.length,
    missingHomes: limit(missing.map(b => b.id), 40),
    providers: limit(providers.map(buildingFact), 20),
    utility: type === 'power' || type === 'water' ? s.utility?.[type] || null : undefined,
  };
}

export function inspectWorkforce(game, args = {}) {
  const w = game.world;
  const residents = [...w.residents.values()].filter(r => r.age === 'adult');
  const levels = {};
  for (const r of residents) {
    const k = eduOf(r); levels[k] ||= { level: k, name: EDU[k], adults: 0, employed: 0, unemployed: 0, studying: 0 };
    levels[k].adults++;
    if (r.job != null) levels[k].employed++; else if (r.school != null) levels[k].studying++; else levels[k].unemployed++;
  }
  const wanted = Number.isFinite(args.educationLevel) ? Number(args.educationLevel) : null;
  return { levels: Object.values(levels).filter(x => wanted == null || x.level === wanted), skilledVacancies: game.sim.jobsNeedingSkill || 0 };
}

export function inspectEducationPipeline(game) {
  const w = game.world, sk = game.sim.schooling || {};
  const pupils = [...w.residents.values()].filter(r => r.age === 'child');
  const byStage = {};
  for (const r of pupils) {
    const stage = stageForAge(yearsOf(r));
    byStage[stage] ||= { stage, pupils: 0, placed: 0, unplaced: 0 };
    byStage[stage].pupils++;
    if (r.school != null) byStage[stage].placed++; else byStage[stage].unplaced++;
  }
  const institutions = [...w.buildings.values()].filter(b => BUILDINGS[b.type].service === 'education' || servicesOf(BUILDINGS[b.type]).includes('education')).map(buildingFact);
  return { stages: Object.values(byStage), reportedShortage: sk.short || null, institutions: limit(institutions, 30), skilledVacancies: game.sim.jobsNeedingSkill || 0 };
}

export function inspectUtilityCapacity(game) {
  const providers = [...game.world.buildings.values()].filter(b => {
    const L = BUILDINGS[b.type].levels[b.level];
    return L.kw || L.supply;
  }).map(buildingFact);
  return { utility: game.sim.utility || null, providers: limit(providers, 30) };
}

export function identifyPollutionSources(game, buildingId) {
  const w = game.world, target = w.buildings.get(Number(buildingId));
  if (!target) return { error: 'Building not found' };
  const at = centerOf(target);
  const sources = [];
  for (const b of w.buildings.values()) {
    const L = BUILDINGS[b.type].levels[b.level], amount = L.pollution || 0;
    if (!amount || !isOpen(b)) continue;
    const d = dist(at, centerOf(b)), radius = L.radius || 5;
    if (d <= radius + 2) sources.push({ ...buildingFact(b), distance: round(d), estimatedContribution: round(Math.max(0, amount * (1 - d / (radius + 2)))) });
  }
  sources.sort((a, b) => b.estimatedContribution - a.estimatedContribution);
  return { target: buildingFact(target), measuredPollution: target.factors?.pollution || 0, sources: limit(sources, 20), note: 'Contributions are deterministic local estimates; the simulation remains authoritative.' };
}

export function findConstructionSites(game, args = {}) {
  const w = game.world, type = args.buildingType;
  if (!BUILDINGS[type] || BUILDINGS[type].hidden) return { error: 'Unknown or non-placeable building type' };
  const a = safeArea(w, args.area || {}), at = { x: a.x, z: a.z }, out = [];
  for (let z = 0; z < w.N; z++) for (let x = 0; x < w.N; x++) {
    if (dist({ x: x + 0.5, z: z + 0.5 }, at) > a.radius) continue;
    const chk = w.checkBuild(type, x, z);
    if (chk.ok) out.push({ x, z, cost: chk.cost, accessChoices: chk.access.length, distance: round(dist({ x, z }, at)) });
  }
  out.sort((x, y) => x.distance - y.distance || x.cost - y.cost);
  return { buildingType: type, area: a, count: out.length, sites: limit(out, Math.max(1, Math.min(24, args.limit || 12))) };
}

const civicPriority = (b) => {
  const d = BUILDINGS[b.type];
  if (d.cat === 'utilities' || ['health', 'safety'].some(s => servicesOf(d).includes(s))) return 1;
  if (d.cat === 'residential' || servicesOf(d).includes('education')) return 2;
  if (d.cat === 'industry' || d.stop) return 3;
  if (d.cat === 'commercial' || servicesOf(d).includes('culture')) return 4;
  return 5;
};

export function findRedevelopmentSites(game, args = {}) {
  const w = game.world, type = args.buildingType;
  if (!BUILDINGS[type] || BUILDINGS[type].hidden) return { error: 'Unknown or non-placeable building type' };
  const a = safeArea(w, args.area || {}), at = { x: a.x, z: a.z }, candidates = [];
  const requested = Math.max(1, Math.min(20, args.limit || 10));
  const pool = [...w.buildings.values()]
    .filter(b => b.protection !== 'protected' && !b.con && dist(centerOf(b), at) <= a.radius)
    .sort((x, y) => civicPriority(y) - civicPriority(x) || dist(centerOf(x), at) - dist(centerOf(y), at))
    .slice(0, Math.max(40, requested * 6));
  for (const b of pool) {
    // A lightweight isolated view is sufficient for checkBuild: remove only
    // the candidate's occupancy and fields while sharing immutable terrain,
    // road and research data. The active World is never touched.
    const probe = Object.assign(Object.create(Object.getPrototypeOf(w)), w, {
      buildings: new Map(w.buildings), buildingAt: w.buildingAt.slice(), fields: w.fields.slice(),
    });
    probe.buildings.delete(b.id);
    for (let dz = 0; dz < fd(b); dz++) for (let dx = 0; dx < fw(b); dx++) {
      const i = probe.idx(b.x + dx, b.z + dz);
      if (probe.buildingAt[i] === b.id) probe.buildingAt[i] = -1;
    }
    for (let i = 0; i < probe.fields.length; i++) if (probe.fields[i] === b.id) probe.fields[i] = -1;
    const chk = probe.checkBuild(type, b.x, b.z);
    if (!chk.ok) continue;
    const fact = buildingFact(b);
    candidates.push({
      buildingId: b.id, x: b.x, z: b.z, replacementCost: chk.cost,
      designation: b.protection || 'unrestricted', civicPriority: civicPriority(b),
      displaced: { name: fact.name, category: fact.category, residents: fact.residents, workers: fact.workers, capacity: fact.capacity, services: fact.services },
      warning: b.protection === 'preserve' ? 'Preserve if possible: proposal only unless the player changes its designation.' : null,
      distance: round(dist(centerOf(b), at)),
    });
  }
  candidates.sort((x, y) => y.civicPriority - x.civicPriority || Number(x.designation === 'preserve') - Number(y.designation === 'preserve') || x.distance - y.distance);
  return { buildingType: type, area: a, candidates: limit(candidates, requested), considered: pool.length, note: 'Each site was checked after removal in an isolated world view; demolition impact still requires full plan validation.' };
}

export function evaluateBuildingUpgrade(game, buildingId) {
  const w = game.world, b = w.buildings.get(Number(buildingId));
  if (!b) return { error: 'Building not found' };
  return {
    building: buildingFact(b),
    options: w.upgradeOptions(b).map(o => {
      const to = o.extend ? 'extend' : o.type;
      const chk = w.upgradeCheck(b, to);
      return { type: o.type, level: o.level, extend: !!o.extend, ok: chk.ok, cost: chk.cost, requirements: chk.reqs?.map(r => ({ label: r.label, met: r.met })) || [], reason: chk.reason || null };
    }).slice(0, 16),
  };
}

const schema = (name, description, properties = {}, required = []) => ({
  type: 'function', function: { name, description, strict: true, parameters: { type: 'object', properties, required, additionalProperties: false } },
});
const area = { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' }, radius: { type: 'number' } }, required: [], additionalProperties: false };

export const MUNICIPAL_READ_TOOLS = [
  schema('inspect_town_summary', 'Compact authoritative town, budget, housing, utility and workforce summary.'),
  schema('inspect_active_issues', 'Current issues from Kinstead’s existing issue detector.'),
  schema('inspect_issue', 'Details and involved buildings for one issue.', { issueId: { type: 'string' } }, ['issueId']),
  schema('inspect_building', 'Authoritative facts about one building.', { buildingId: { type: 'integer' } }, ['buildingId']),
  schema('inspect_neighborhood', 'Buildings and capacity near a location.', { x: { type: 'number' }, z: { type: 'number' }, radius: { type: 'number' } }, ['x', 'z', 'radius']),
  schema('inspect_service_coverage', 'Coverage and underserved homes for a service.', { serviceType: { type: 'string', enum: ['health', 'education', 'safety', 'culture', 'power', 'water', 'pollution'] }, area }, ['serviceType']),
  schema('inspect_workforce', 'Adults by education, employment and study state.', { educationLevel: { type: 'integer' } }),
  schema('inspect_education_pipeline', 'Students, shortages, institutions, staffing and skilled vacancies.'),
  schema('inspect_utility_capacity', 'Power and water demand, supply, and provider state.'),
  schema('identify_pollution_sources', 'Likely local pollution contributors affecting a building.', { buildingId: { type: 'integer' } }, ['buildingId']),
  schema('find_construction_sites', 'Enumerate sites accepted by Kinstead placement rules.', { buildingType: { type: 'string' }, area, limit: { type: 'integer' } }, ['buildingType']),
  schema('find_redevelopment_sites', 'Evaluate occupied sites in isolated copies, respecting preservation designations.', { buildingType: { type: 'string' }, area, limit: { type: 'integer' } }, ['buildingType']),
  schema('evaluate_building_upgrade', 'Exact upgrade options and current requirements.', { buildingId: { type: 'integer' } }, ['buildingId']),
];

export function executeReadTool(game, name, args = {}) {
  switch (name) {
    case 'inspect_town_summary': return inspectTownSummary(game);
    case 'inspect_active_issues': return inspectActiveIssues(game);
    case 'inspect_issue': return inspectIssue(game, args.issueId);
    case 'inspect_building': return inspectBuilding(game, args.buildingId);
    case 'inspect_neighborhood': return inspectNeighborhood(game, args);
    case 'inspect_service_coverage': return inspectServiceCoverage(game, args);
    case 'inspect_workforce': return inspectWorkforce(game, args);
    case 'inspect_education_pipeline': return inspectEducationPipeline(game);
    case 'inspect_utility_capacity': return inspectUtilityCapacity(game);
    case 'identify_pollution_sources': return identifyPollutionSources(game, args.buildingId);
    case 'find_construction_sites': return findConstructionSites(game, args);
    case 'find_redevelopment_sites': return findRedevelopmentSites(game, args);
    case 'evaluate_building_upgrade': return evaluateBuildingUpgrade(game, args.buildingId);
    default: return { error: 'Unknown read-only municipal tool' };
  }
}
