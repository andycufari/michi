// config.js — the control plane.
//
// Loads config.json, merges a named profile over `default`, and resolves it into
// the knobs the loop + tools actually read. config.json is non-secret; secrets
// stay in .env and are pulled here by env-var name at use time (never stored).
//
//   load(profileName?) -> resolved config object
//   list()            -> { default, profiles: {name: {...}} } (raw, for TUI/panel)
//   save(raw)         -> write config.json back (used by TUI/panel)
//
// Resolution: profile fields deep-override default fields; anything a profile
// omits inherits from default.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const FILE = path.join(ROOT, 'config.json');

export function raw() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { default: {}, profiles: {} }; }
}

export function list() {
  const r = raw();
  return { default: r.default || {}, profiles: r.profiles || {} };
}

export function save(obj) {
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2) + '\n');
  return true;
}

// Resolve the effective config for a profile (default if none/unknown).
// `context` (arbitrary .md persona files) and `skills` (capability names) are
// MERGED additively: a profile's lists EXTEND default's, so the base persona
// always applies and the profile layers on top.
export function load(profileName) {
  const r = raw();
  const base = r.default || {};
  const prof = (profileName && r.profiles && r.profiles[profileName]) || {};
  if (profileName && !r.profiles?.[profileName] && profileName !== 'default') {
    // unknown profile name — surface it rather than silently using default
    process.stderr.write(`[michi] unknown profile "${profileName}", using default\n`);
  }
  const merged = deepMerge(structuredClone(base), prof);
  // additive lists (deepMerge would have overwritten arrays)
  merged.context = uniq([...(base.context || []), ...(prof.context || [])]);
  merged.skills = uniq([...(base.skills || []), ...(prof.skills || [])]);
  merged._profile = (prof && Object.keys(prof).length) ? profileName : 'default';
  return merged;
}

function uniq(a) { return [...new Set(a)]; }

// Apply a resolved config to process.env so the existing loop/llm/tools — which
// read env — pick it up without rewiring. The single bridge between config and
// the rest of the OS. Secrets are NOT touched (they came from .env already).
// Sensible default base URLs for local/OpenAI-compatible providers, so a profile
// works even if .env omits the URL line. Secret-bearing providers (qwen cloud,
// openai, deepseek, anthropic) are NOT defaulted — they must come from .env.
const DEFAULT_BASE = {
  lmstudio: 'http://localhost:1234/v1',
  ollama: 'http://localhost:11434/v1',
};
const BASE_ENV = {
  lmstudio: 'LMSTUDIO_BASE_URL', ollama: 'OLLAMA_BASE_URL',
  qwen: 'QWEN_BASE_URL', openai: 'OPENAI_BASE_URL', deepseek: 'DEEPSEEK_BASE_URL',
};
const VISION_ENV = {
  qwen: 'QWEN_VISION', lmstudio: 'LMSTUDIO_VISION', ollama: 'OLLAMA_VISION',
};

export function applyToEnv(cfg) {
  const b = cfg.brain || {};
  const prov = (b.provider || '').toLowerCase();
  if (b.provider) process.env.LLM_PROVIDER = b.provider;
  if (b.model) setModelFor(b.provider, b.model);
  // wire the vision flag to the RIGHT provider's var (was hardcoded to qwen)
  if (b.vision != null && VISION_ENV[prov]) process.env[VISION_ENV[prov]] = b.vision ? '1' : '0';
  // ensure a base URL exists for local providers if .env didn't set one
  const baseVar = BASE_ENV[prov];
  if (baseVar && !process.env[baseVar] && DEFAULT_BASE[prov]) {
    process.env[baseVar] = DEFAULT_BASE[prov];
  }

  if (cfg.boot === 'full') process.env.MICHI_FULL_BOOT = '1';
  else if (cfg.boot === 'lean') process.env.MICHI_FULL_BOOT = '0';

  const l = cfg.limits || {};
  if (l.maxSteps != null) process.env.MAX_STEPS = String(l.maxSteps);
  if (l.historyBudget != null) process.env.HISTORY_BUDGET = String(l.historyBudget);
  if (l.keepTurns != null) process.env.KEEP_TURNS = String(l.keepTurns);

  // movicom device target → movicom reads MOVICOM_DEVICE / ANDROID_SERIAL
  const mv = cfg.tools?.movicom || {};
  if (mv.device) { process.env.MOVICOM_DEVICE = mv.device; process.env.ANDROID_SERIAL = mv.device; }

  // cm64 project context (if/when cm64 tool is wired)
  const cm = cfg.tools?.cm64 || {};
  if (cm.project) process.env.CM64_PROJECT = cm.project;

  // Persona: context files (always-on) + skills (on-demand) for this profile.
  // Passed as JSON in env so the loop (separate process or same) can read them.
  process.env.MICHI_CONTEXT = JSON.stringify(cfg.context || []);
  process.env.MICHI_SKILLS = JSON.stringify(cfg.skills || []);

  return cfg;
}

function setModelFor(provider, model) {
  const map = { qwen: 'QWEN_MODEL', deepseek: 'DEEPSEEK_MODEL', openai: 'OPENAI_MODEL',
    anthropic: 'ANTHROPIC_MODEL', ollama: 'OLLAMA_MODEL', lmstudio: 'LMSTUDIO_MODEL' };
  const key = map[(provider || '').toLowerCase()];
  if (key) process.env[key] = model;
}

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
      a[k] = deepMerge(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
    } else {
      a[k] = b[k];
    }
  }
  return a;
}

export { FILE as CONFIG_FILE };
