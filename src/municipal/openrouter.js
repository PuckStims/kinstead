// Minimal OpenRouter client for a bounded, tool-using municipal investigation.
// It has no game mutation capability: executeTool is supplied by the local
// controller and exposes read-only queries plus a final plan-submission tool.

import { redactSecret } from './config.js';

const API = 'https://openrouter.ai/api/v1';
const MAX_TOOL_RESULT_CHARS = 14000;

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
    if (!res.ok) {
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
  let compatible = model === 'openrouter/free', modelInfo = null;
  try {
    const models = await request('/models', { key, timeoutMs, fetchImpl });
    modelInfo = models?.data?.find(m => m.id === model) || null;
    compatible ||= !!modelInfo?.supported_parameters?.includes('tools');
  } catch {
    // A successful authenticated /key request is still a valid connection
    // test. Model compatibility will be authoritatively checked on first use.
  }
  return {
    ok: true, model, compatible,
    modelName: modelInfo?.name || null,
    key: { limit: account?.data?.limit ?? null, remaining: account?.data?.limit_remaining ?? null, usage: account?.data?.usage ?? null },
    warning: compatible ? null : modelInfo ? 'This model does not advertise tool support. Choose a tool-capable model.' : 'Model was not found in the current OpenRouter catalog.',
  };
}

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
  let requests = 0, rounds = 0, toolCalls = 0, usage = null;

  while (requests < cfg.requestLimit) {
    onStatus({ phase: rounds ? 'investigating' : 'assessing', requests, rounds, toolCalls });
    const data = await request('/chat/completions', {
      key, method: 'POST', timeoutMs: cfg.timeoutMs, fetchImpl,
      body: { model, messages, tools, tool_choice: 'auto', parallel_tool_calls: true, max_tokens: cfg.tokenLimit, temperature: 0.2 },
    });
    requests++;
    usage = data?.usage || usage;
    const message = data?.choices?.[0]?.message;
    if (!message) throw new MunicipalAIError('OpenRouter returned no assistant message.', 'invalid_response');
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    messages.push({ role: 'assistant', content: message.content || null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) throw new MunicipalAIError('The selected model stopped without submitting a municipal plan. Try a model with reliable tool calling.', 'no_plan');
    rounds++;
    if (rounds > cfg.toolRoundLimit) throw new MunicipalAIError(`Investigation stopped at the ${cfg.toolRoundLimit}-round safety limit.`, 'round_limit');

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
  }
  throw new MunicipalAIError(`Investigation stopped at the ${cfg.requestLimit}-request safety limit.`, 'request_limit');
}
