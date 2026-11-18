// End-to-end Catch Up workflow. Strategic investigation happens through
// OpenRouter; every fact, permission check and mutation remains local.

import { BUILDINGS, servicesOf } from '../defs.js';
import { serialize, deserialize, LocalSaves } from '../save/saves.js';
import { inspectTownSummary, inspectActiveIssues, executeReadTool, MUNICIPAL_READ_TOOLS } from './diagnostics.js';
import { SUBMIT_PLAN_TOOL, validateInterventionPlan } from './plan.js';
import { runMunicipalAgent } from './openrouter.js';
import { cleanMunicipalConfig, redactSecret } from './config.js';

const VALIDATE_TOOL = {
  type: 'function',
  function: {
    name: 'validate_intervention_plan',
    description: 'Dry-run candidate actions sequentially against an isolated town copy. Returns feasibility, permission, preservation and limit findings without changing the town.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { actions: SUBMIT_PLAN_TOOL.function.parameters.properties.actions },
      required: ['actions'],
    },
  },
};

const SYSTEM = `You are Kinstead's municipal intelligence: a careful administrator and urban planner, not a cheat engine.
Investigate root causes and interconnected dependencies before proposing action. Prefer restoring, upgrading or consolidating existing capacity before construction; prefer the smallest effective intervention. In dense areas, investigate legitimate redevelopment and explicitly account for lost housing, jobs, services, workforce, utilities, access, pollution, time and aesthetic preservation.

Rules:
- Use only the supplied read-only tools. They return authoritative local facts.
- Never invent ids, building types, state, permissions, commands or verified outcomes.
- Protected Landmarks are inviolable. Treat Preserve if Possible sites as proposals only after less disruptive options.
- A lack of vacant land is not a conclusion until redevelopment opportunities are checked.
- Do not construct an institution without checking staffing, access, utilities and the education/workforce pipeline.
- Do not assume every issue should be fixed now. Normal progression or no action can be the responsible answer.
- Distinguish a deterministic feasibility check from a verified live-simulation result.
- Call validate_intervention_plan on candidate actions before the final submission, then call submit_intervention_plan exactly once.
- The local engine alone decides authorization and execution.`;

const catalog = () => Object.entries(BUILDINGS).filter(([, d]) => !d.hidden).map(([type, d]) => ({
  type, name: d.name, category: d.cat, size: d.size, services: servicesOf(d),
}));

const actionLine = (e) => ({ id: e.action.id, kind: e.action.kind, rationale: e.action.rationale, expectedOutcome: e.action.expectedOutcome, command: e.command, reason: e.reason || null });

export async function executeAuthorizedActions(game, validation, config, checkpoint, onStatus = () => {}) {
  const performed = [], failures = [];
  if (config.mode === 'catchup' && validation.safe && validation.accepted.length) {
    onStatus({ phase: 'executing', text: 'Executing authorized actions through Kinstead commands' });
    for (const entry of validation.accepted) {
      // Town state can change while the model investigates. Revalidate the
      // exact next command immediately before it reaches Game.cmd.
      const fresh = validateInterventionPlan(game, { actions: [entry.action] }, config);
      const next = fresh.accepted[0];
      if (!next || fresh.invalid.length) { failures.push({ ...actionLine(entry), reason: fresh.invalid[0]?.reason || 'No longer authorized or feasible' }); break; }
      const result = await new Promise(resolve => {
        const immediate = game.cmd(next.command, resolve);
        if (immediate && !game.isGuest) resolve(immediate);
      });
      if (!result || (result.ok === false && result.placed === undefined) || result.placed === 0) {
        failures.push({ ...actionLine(entry), reason: result?.reason || result?.failed || 'Command failed' });
        break;
      }
      performed.push({ ...actionLine(entry), result: { ok: true, cost: result.cost ?? result.spent ?? null } });
      game.sim?.recompute();
    }
  }
  let rolledBack = false;
  if (failures.length) {
    onStatus({ phase: 'rollback', text: 'Restoring the pre-session checkpoint after a failed intervention' });
    game.load(deserialize(checkpoint));
    performed.length = 0;
    rolledBack = true;
  }
  return { performed, failures, rolledBack };
}
export class MunicipalController {
  constructor(game) { this.game = game; this.running = false; this.lastReport = null; }

  async run(rawConfig, key, onStatus = () => {}) {
    if (this.running) throw new Error('A municipal assessment is already running.');
    const game = this.game, config = cleanMunicipalConfig(rawConfig);
    if (!game.world || game.demo) throw new Error('Open a town before running Catch Up.');
    if (game.isGuest && config.mode === 'catchup') throw new Error('Only the multiplayer host may authorize municipal changes. Advisory Mode remains available.');
    this.running = true;
    const beforeIssues = inspectActiveIssues(game), checkpoint = serialize(game.world);
    try {
      onStatus({ phase: 'checkpoint', text: 'Creating a recoverable checkpoint' });
      try { LocalSaves.save('municipal-checkpoint', checkpoint, null); } catch (e) { throw new Error(`Could not create the required checkpoint: ${e.message}`); }

      const initial = JSON.stringify({
        instruction: 'Investigate the current issues, their shared causes, and bounded legitimate responses. Use compact targeted queries rather than requesting everything.',
        operatingMode: config.mode, grantedPermissions: config.permissions,
        town: inspectTownSummary(game), issues: beforeIssues, placeableBuildingCatalog: catalog(),
      });
      const tools = [...MUNICIPAL_READ_TOOLS, VALIDATE_TOOL, SUBMIT_PLAN_TOOL];
      const ai = await runMunicipalAgent({
        key, model: config.model, system: SYSTEM, initial, tools, limits: config,
        onStatus: (s) => onStatus({ ...s, text: s.phase === 'assessing' ? 'Assessing municipal conditions' : s.phase === 'investigating' ? 'Investigating underlying causes' : 'Validating the proposed strategy' }),
        executeTool: async (name, args) => {
          if (name === 'validate_intervention_plan') {
            const v = validateInterventionPlan(game, { title: 'Candidate', actions: args.actions }, config);
            return { accepted: v.accepted.map(actionLine), proposals: v.proposals.map(actionLine), invalid: v.invalid.map(actionLine), note: v.note };
          }
          return executeReadTool(game, name, args);
        },
      });

      onStatus({ phase: 'validating', text: 'Revalidating against the current town' });
      const validation = validateInterventionPlan(game, ai.plan, config);
      const { performed, failures, rolledBack } = await executeAuthorizedActions(game, validation, config, checkpoint, onStatus);
      game.sim?.recompute();
      onStatus({ phase: 'verifying', text: 'Verifying outcomes in the live simulation' });
      const afterIssues = inspectActiveIssues(game), beforeIds = new Set(beforeIssues.map(i => i.id)), afterIds = new Set(afterIssues.map(i => i.id));
      const report = {
        createdAt: new Date().toISOString(), mode: config.mode, title: validation.plan.title,
        summary: validation.plan.summary, causes: validation.plan.causes,
        investigated: beforeIssues,
        performed, rolledBack,
        proposals: validation.proposals.map(actionLine),
        invalid: [...validation.invalid.map(actionLine), ...failures],
        verified: {
          resolvedIssues: beforeIssues.filter(i => !afterIds.has(i.id)).map(i => ({ id: i.id, text: i.text })),
          remainingIssues: afterIssues,
          newIssues: afterIssues.filter(i => !beforeIds.has(i.id)).map(i => ({ id: i.id, text: i.text })),
        },
        naturalProgression: validation.plan.naturalProgression,
        unresolved: validation.plan.unresolved,
        checkpoint: 'municipal-checkpoint',
        limits: { requests: ai.requests, toolRounds: ai.rounds, toolCalls: ai.toolCalls, commands: config.commandLimit, redevelopment: config.redevelopmentLimit },
        note: validation.note,
      };
      this.lastReport = report;
      onStatus({ phase: validation.proposals.length ? 'approval' : 'complete', text: validation.proposals.length ? 'Assessment complete — proposals await player approval' : 'Municipal assessment complete' });
      return report;
    } catch (e) {
      throw new Error(redactSecret(e?.message || e));
    } finally { this.running = false; }
  }
}
