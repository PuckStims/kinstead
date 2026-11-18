// Minimal OpenRouter client for a bounded, tool-using municipal investigation.
// It has no game mutation capability: executeTool is supplied by the local
// controller and exposes read-only queries plus a final plan-submission tool.

import { redactSecret } from './config.js';

const API = 'https://openrouter.ai/api/v1';
const MAX_TOOL_RESULT_CHARS = 14000;
const FINAL_PLAN_PROMPT = `The investigation budget is complete. Produce the final municipal plan now from the evidence already gathered.
Return only one valid JSON object, without Markdown or commentary, with this shape:
{"title":"...","summary":"...","causes":["..."],"actions":[{"id":"...","kind":"place|upgrade|expand|merge|move|demolish|roads|terraform|wait","buildingType":null,"buildingId":null,"otherBuildingId":null,"x":null,"z":null,"to":null,"direction":null,"expansionKind":null,"roadLevel":null,"tiles":[],"terrainMode":null,"waitDays":0,"rationale":"...","expectedOutcome":"...","issueIds":[]}],"naturalProgression":["..."],"unresolved":["..."]}
Use null or an empty array for inapplicable action fields. Do not invent identifiers or facts. An empty actions array is valid when no intervention is justified.`;

export class MunicipalAIError extends Error {
  constructor(message, code = 'openrouter_error') { super(redactSecret(message)); this.name = 'MunicipalAIError'; this.code = code; }
}
const headersFor = (key) => {
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Kinstead Municipal Intelligence' };
  if (globalThis.location?.origin?.startsWith('http')) h['HTTP-Referer'] = globalThis.location.origin;
  return h;
};

async function request(path, { key, method = 'GET', body, timeoutMs = 45000, fetchImpl = globalThis.fetch } = {}) {
  if (!key) throw new MunicipalAIError('Enter an OpenRouter API key first.', 'missing_key');
  if (typeof fetchImpl !== 'function') throw new MunicipalAIError('Network requests are unavailable in this browser.', 'network');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${API}${path}`, { method, headers: headersFor(key), body: body == null ? undefined : JSON.stringify(body), signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch {}
    // Some routed providers return a JSON error envelope with HTTP 200. Treat
    // it exactly like a transport-level API error instead of later reporting
    // the much less useful “no assistant message”.
    if (!res.ok || data?.error) {
      const detail = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
      const code = res.status === 401 || res.status === 403 ? 'authentication' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'provider' : 'request';
      throw new MunicipalAIError(`OpenRouter request failed: ${detail}`, code);
    }
    return data;
  } catch (e) {
    if (e instanceof MunicipalAIError) throw e;
    if (e?.name === 'AbortError') throw new MunicipalAIError('OpenRouter request timed out.', 'timeout');
    throw new MunicipalAIError(`Could not reach OpenRouter: ${e?.message || e}`, 'network');
  } finally { clearTimeout(timer); }
}

export async function testOpenRouterConnection({ key, model, timeoutMs, fetchImpl } = {}) {
  const account = await request('/key', { key, timeoutMs, fetchImpl });
  let compatible = model === 'openrouter/free', structured = model === 'openrouter/free', modelInfo = null;
  try {
    const models = await request('/models', { key, timeoutMs, fetchImpl });
    modelInfo = models?.data?.find(m => m.id === model) || null;
    compatible ||= !!modelInfo?.supported_parameters?.includes('tools');
    structured ||= !!modelInfo?.supported_parameters?.includes('structured_outputs');
  } catch {
    // A successful authenticated /key request is still a valid connection
    // test. Model compatibility will be authoritatively checked on first use.
  }
  return {
    ok: true, model, compatible, structured,
    modelName: modelInfo?.name || null,
    key: { limit: account?.data?.limit ?? null, remaining: account?.data?.limit_remaining ?? null, usage: account?.data?.usage ?? null },
    warning: !compatible ? (modelInfo ? 'This model does not advertise tool support. Choose a tool-capable model.' : 'Model was not found in the current OpenRouter catalog.')
      : !structured ? 'Connected, but this model does not advertise structured outputs. Kinstead will use a locally validated compatibility fallback; a structured-output model is more reliable.'
        : null,
  };
}

function planFromContent(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  let source = content.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) source = fenced[1].trim();
  const first = source.indexOf('{'), last = source.lastIndexOf('}');
  if (first >= 0 && last > first) source = source.slice(first, last + 1);
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

const submissionTools = (tools) => (Array.isArray(tools) ? tools : [])
  .filter(t => t?.function?.name === 'submit_intervention_plan')
  .map(t => {
    // Strict tool schemas are not implemented consistently by routed
    // providers. Local normalization and counterfactual validation remain the
    // security boundary, so the bounded final call may safely be non-strict.
    const { strict: _strict, ...fn } = t.function;
    return { ...t, function: fn };
  });

export async function runMunicipalAgent({ key, model, system, initial, tools, executeTool, limits, onStatus = () => {}, fetchImpl } = {}) {
  const cfg = {
    requestLimit: Math.max(1, limits?.requestLimit || 6),
    toolRoundLimit: Math.max(1, limits?.toolRoundLimit || 5),
    tokenLimit: Math.max(256, limits?.tokenLimit || 1800),
    timeoutMs: Math.max(5000, limits?.timeoutMs || 45000),
  };
  const messages = [{ role: 'system', content: system }, { role: 'user', content: initial }];
  const repeated = new Map();
  const toolCallLimit = Math.min(64, cfg.toolRoundLimit * 8);
  let requests = 0, rounds = 0, toolCalls = 0, usage = null, consecutiveEmpty = 0;

  const requestPlainFinal = async () => {
    let attempts = 0, detail = null;
    while (requests < cfg.requestLimit && attempts < 2) {
      onStatus({ phase: 'finalizing', requests, rounds, toolCalls });
      const data = await request('/chat/completions', {
        key, method: 'POST', timeoutMs: cfg.timeoutMs, fetchImpl,
        body: { model, messages: [...messages, { role: 'user', content: FINAL_PLAN_PROMPT }], max_tokens: cfg.tokenLimit, temperature: 0.2 },
      });
      requests++; attempts++;
      usage = data?.usage || usage;
      const choice = data?.choices?.[0], message = choice?.message, plan = planFromContent(message?.content);
      if (plan) return { plan, requests, rounds: rounds + 1, toolCalls, usage };
      detail = choice?.error?.message || choice?.error?.code || choice?.finish_reason || data?.message || null;
    }
    if (requests >= cfg.requestLimit) throw new MunicipalAIError('The selected provider could not submit a final plan before the API-request safety limit.', 'request_limit');
    throw new MunicipalAIError(`OpenRouter could not produce a valid final municipal plan${detail ? `: ${detail}` : '. Try a model with reliable JSON or structured-output support.'}`, 'invalid_response');
  };

  while (requests < cfg.requestLimit) {
    if (rounds >= cfg.toolRoundLimit) throw new MunicipalAIError(`Investigation stopped at the ${cfg.toolRoundLimit}-round safety limit.`, 'round_limit');
    // Models often keep finding useful questions indefinitely. On the last
    // permitted round expose only the non-mutating submission tool. Named
    // forced tool_choice objects cause some routed providers to return an
    // empty response, so finalization stays automatic and has a JSON fallback.
    const finalRound = rounds === cfg.toolRoundLimit - 1;
    onStatus({ phase: rounds ? 'investigating' : 'assessing', requests, rounds, toolCalls });
    const finalTools = finalRound ? submissionTools(tools) : tools;
    const data = await request('/chat/completions', {
      key, method: 'POST', timeoutMs: cfg.timeoutMs, fetchImpl,
      body: {
        model, messages: finalRound ? [...messages, { role: 'user', content: 'Investigation budget complete. Submit the bounded final plan now; do not investigate further.' }] : messages,
        tools: finalTools,
        tool_choice: 'auto',
        parallel_tool_calls: !finalRound,
        max_tokens: cfg.tokenLimit, temperature: 0.2,
      },
    });
    requests++;
    usage = data?.usage || usage;
    const choice = data?.choices?.[0], message = choice?.message;
    if (!message) {
      if (finalRound) return requestPlainFinal();
      // Free/routed providers occasionally yield an empty choice despite a
      // valid authenticated request. Retry at most twice and count every
      // attempt against the user's hard request budget.
      if (++consecutiveEmpty <= 2 && requests < cfg.requestLimit) {
        onStatus({ phase: 'investigating', requests, rounds, toolCalls, retrying: true });
        continue;
      }
      const detail = choice?.error?.message || choice?.error?.code || choice?.finish_reason || data?.message || null;
      throw new MunicipalAIError(`OpenRouter returned no assistant message${detail ? `: ${detail}` : '. The routed provider supplied an empty response.'}`, 'invalid_response');
    }
    consecutiveEmpty = 0;
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    messages.push({ role: 'assistant', content: message.content || null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      const plan = planFromContent(message.content);
      if (plan) return { plan, requests, rounds: rounds + 1, toolCalls, usage };
      // A number of otherwise capable routed models investigate correctly but
      // conclude in prose instead of invoking the submit tool. Once at least
      // one authoritative tool round has completed, convert that conclusion
      // through the same bounded JSON fallback. A model that ignores tools on
      // its very first response is still rejected as incompatible.
      if (finalRound || rounds > 0) return requestPlainFinal();
      throw new MunicipalAIError('The selected model stopped without submitting a municipal plan. Try a model with reliable tool calling.', 'no_plan');
    }
    rounds++;

    let submitted = null;
    for (const call of calls) {
      const name = call?.function?.name || '', raw = call?.function?.arguments || '{}';
      let args;
      try { args = JSON.parse(raw); } catch { args = null; }
      toolCalls++;
      if (toolCalls > toolCallLimit) throw new MunicipalAIError(`Investigation stopped at the ${toolCallLimit}-tool-call safety limit.`, 'tool_call_limit');
      if (!args || typeof args !== 'object') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Tool arguments were not valid JSON.' }) });
        continue;
      }
      const fingerprint = `${name}:${JSON.stringify(args)}`, seen = (repeated.get(fingerprint) || 0) + 1;
      repeated.set(fingerprint, seen);
      if (seen > 2) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Repeated identical tool call blocked. Use existing evidence or investigate another dependency.' }) });
        continue;
      }
      if (name === 'submit_intervention_plan') {
        submitted = args;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ acceptedForLocalValidation: true }) });
        continue;
      }
      let result;
      try { result = await executeTool(name, args); } catch (e) { result = { error: redactSecret(e?.message || e) }; }
      let content = JSON.stringify(result);
      if (content.length > MAX_TOOL_RESULT_CHARS) content = JSON.stringify({ truncated: true, data: content.slice(0, MAX_TOOL_RESULT_CHARS) });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
    if (submitted) {
      onStatus({ phase: 'validating', requests, rounds, toolCalls });
      return { plan: submitted, requests, rounds, toolCalls, usage };
    }
    if (finalRound) return requestPlainFinal();
  }
  throw new MunicipalAIError(`Investigation stopped at the ${cfg.requestLimit}-request safety limit.`, 'request_limit');
}
