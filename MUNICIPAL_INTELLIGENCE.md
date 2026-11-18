# Kinstead Municipal Intelligence

Municipal Intelligence adds an OpenRouter-backed **Catch Up** assessment to the existing Issues panel. It is an administrative layer over Kinstead, not a second simulation and not a cheat system: the model investigates and proposes; the local game validates, authorizes and executes; the simulation decides what happens.

## Architecture

The implementation has five boundaries:

1. `src/ui/issues.js` remains the source of current municipal issues. Issues now also have stable comparison ids; their existing text, sorting and click behavior are unchanged.
2. `src/municipal/diagnostics.js` exposes compact read-only tools for town summaries, issues, buildings, neighborhoods, services, workforce, education, utilities, pollution, construction sites, redevelopment sites and upgrades. It never gives the model a save or the complete mutable world.
3. `src/municipal/openrouter.js` runs a bounded tool-calling loop. OpenRouter can only call the declared investigative tools and the final plan-submission tool. Repeated calls, requests, tool rounds, tokens and time are capped.
4. `src/municipal/plan.js` converts the submitted plan into a small allowlist of ordinary Kinstead commands. It checks schemas, preservation, session scope and player permissions, then runs the sequence against `deserialize(serialize(world))`. It never evaluates arbitrary JavaScript.
5. `src/municipal/controller.js` creates a browser save-slot checkpoint, revalidates authorized actions against current state immediately before execution, and calls `game.cmd()`. An unexpected command failure restores the checkpoint. The post-run report compares the real Issues result; estimates are not labeled as verified improvements.

The allowed first-version interventions are placement, upgrades, expansion/consolidation, roads, relocation, demolition and terrain work. Waiting for natural progression is a reportable strategy, not a hidden time advance. The “advance time” permission is visibly reserved and disabled until a deterministic bounded-time execution mechanism exists.

## Credentials and OpenRouter

The OpenRouter key is stored only in `sessionStorage`. It is never written to durable settings, saves, reports, source code or diagnostic output, and it disappears with the browser session. Non-secret model, limit, mode and permission choices use a separate local settings record. Errors are redacted before reaching the interface.

**Test connection** authenticates against OpenRouter's current-key endpoint and checks the chosen model catalog entry for tool support where possible. `openrouter/free` is the default router choice; a player may enter any compatible model id. If OpenRouter is missing, unavailable or rejects the request, Catch Up reports the problem and performs no local substitute reasoning. Ordinary Kinstead play is unaffected.

## Preservation and redevelopment

Every building can be designated in its inspector:

- **Protected Landmark** — never altered directly or indirectly by Municipal Intelligence.
- **Preserve if Possible** — may be investigated, but is emitted as a proposal rather than an automatic action.
- **Unrestricted** — may be used when the matching permission is granted.

The designation is an ordinary multiplayer-aware command, survives saves, and follows a building through moves or consolidations. Manual player building tools remain available; preservation specifically limits municipal automation.

Construction-site searches use `World.checkBuild`. Redevelopment searches remove a candidate only in an isolated copy and then call the same placement validator, returning the lost residents, jobs, capacity and services. Candidates are ordered by a contextual civic hierarchy, with redundant/decorative land considered before essential utilities, services, housing and productive capacity. The model must still compare those losses and validate the complete sequence.

## Modes and safety limits

**Advisory Mode** investigates and validates but changes nothing. **Catch Up Mode** may execute only actions covered by the explicit checkboxes. Protected buildings override every permission. A multiplayer guest can assess, but only the host can execute.

Each session has configurable caps for API requests, tool rounds, response tokens, commands and redevelopment operations. Identical investigative calls are blocked after two repeats. A checkpoint is created before the first API request. The entire performed batch is rolled back if a later live command fails.

## Current v0.1 boundaries

- Counterfactuals validate deterministic command feasibility and immediate rule effects; they do not advance a cloned simulation through future days. Staffing, graduation, construction and migration outcomes remain projections until the live simulation produces them.
- Building-level preservation is implemented. Multi-building district designation is intentionally deferred.
- Proposed actions are explained in the report. Changing permissions and rerunning is the approval path; the report does not contain a one-click bypass.
- OpenRouter protocol behavior is covered with mock responses in automated checks. A live model call requires the player's own key and is not part of the repository test suite.
- Municipal reports live for the current browser session. The recoverable town checkpoint is persisted in the existing local Save & Load interface as **Catch Up checkpoint**.

## Verification

`npm run check` includes `scripts/municipal-check.js`. It covers credential separation, bounded configuration, read-only diagnostics, staffing dependency visibility, save persistence, protected and preserve-if-possible behavior, invalid AI actions, full rollback after a failed live intervention, dense neighborhoods with no vacant plots but valid redevelopment candidates, request termination and a valid no-action judgment.
