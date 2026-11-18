// Municipal Intelligence settings. The API key deliberately lives only in
// sessionStorage: it is never part of a Kinstead save, report or durable
// settings record, and disappears when the browser session ends.

const SETTINGS_KEY = 'kinstead.municipal.settings.v1';
const KEY_NAME = 'kinstead.municipal.openrouter-key';

export const MUNICIPAL_DEFAULTS = Object.freeze({
  model: 'openrouter/free',
  mode: 'advisory',
  requestLimit: 6,
  toolRoundLimit: 5,
  tokenLimit: 1800,
  commandLimit: 6,
  redevelopmentLimit: 2,
  timeoutMs: 45000,
  permissions: Object.freeze({
    construction: false,
    upgrades: false,
    expansion: false,
    roads: false,
    relocation: false,
    demolishDecorative: false,
    demolishFunctional: false,
    terrain: false,
    advanceTime: false,
  }),
});

const clampInt = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : fallback;

export function cleanMunicipalConfig(raw = {}) {
  const d = MUNICIPAL_DEFAULTS;
  const p = raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : {};
  return {
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim().slice(0, 160) : d.model,
    mode: raw.mode === 'catchup' ? 'catchup' : 'advisory',
    requestLimit: clampInt(raw.requestLimit, 1, 12, d.requestLimit),
    toolRoundLimit: clampInt(raw.toolRoundLimit, 1, 10, d.toolRoundLimit),
    tokenLimit: clampInt(raw.tokenLimit, 256, 6000, d.tokenLimit),
    commandLimit: clampInt(raw.commandLimit, 0, 20, d.commandLimit),
    redevelopmentLimit: clampInt(raw.redevelopmentLimit, 0, 5, d.redevelopmentLimit),
    timeoutMs: clampInt(raw.timeoutMs, 5000, 120000, d.timeoutMs),
    permissions: Object.fromEntries(Object.keys(d.permissions).map(k => [k, p[k] === true])),
  };
}
export function loadMunicipalConfig(storage = globalThis.localStorage) {
  if (!storage) return cleanMunicipalConfig();
  try { return cleanMunicipalConfig(JSON.parse(storage.getItem(SETTINGS_KEY) || '{}')); } catch { return cleanMunicipalConfig(); }
}

export function saveMunicipalConfig(config, storage = globalThis.localStorage) {
  const clean = cleanMunicipalConfig(config);
  storage?.setItem(SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

export function getOpenRouterKey(storage = globalThis.sessionStorage) {
  try { return (storage?.getItem(KEY_NAME) || '').trim(); } catch { return ''; }
}

export function setOpenRouterKey(key, storage = globalThis.sessionStorage) {
  const clean = typeof key === 'string' ? key.trim() : '';
  if (!storage) return clean;
  if (clean) storage.setItem(KEY_NAME, clean); else storage.removeItem(KEY_NAME);
  return clean;
}

export function clearOpenRouterKey(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(KEY_NAME); } catch {}
}

export function redactSecret(value) {
  return String(value ?? '')
    // Accept current and future sk-or-* shapes without assuming the version
    // segment. Stop at whitespace or common JSON / URL delimiters.
    .replace(/sk-or-[^\s"'&?,;]+/gi, '[redacted OpenRouter key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]');
}
