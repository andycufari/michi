// policy.js — the permission gate for Michi's shell.
//
// Model proposes a command; we check it AFTER the ask, BEFORE we run it
// (Claude Code's model). Rules live in policy.json (allow/deny glob lists).
// Precedence:  deny wins  →  allow  →  otherwise BLOCK (default-deny).
//
// A compound command (a && b | c ; d) is only permitted if EVERY sub-command
// passes — so Michi can't smuggle a denied command behind an allowed one.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

let CACHE = null;
function load() {
  if (CACHE) return CACHE;
  const file = path.join(ROOT, 'policy.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    CACHE = { allow: raw.allow || [], deny: raw.deny || [] };
  } catch {
    CACHE = { allow: [], deny: [] }; // no policy → deny everything, fail safe
  }
  return CACHE;
}

// glob → regex: '*' = any chars, everything else literal. Whole-string match,
// case-sensitive, whitespace-normalized.
function globToRe(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$');
}

function norm(s) { return String(s).trim().replace(/\s+/g, ' '); }

// Split a command line into sub-commands on shell operators, so each piece is
// judged independently. Crude but safe-leaning (over-splitting only adds checks).
function subcommands(cmd) {
  return cmd
    .split(/&&|\|\||[;|]|\n/)
    .map(norm)
    .filter(Boolean);
}

function matchesAny(cmd, patterns) {
  return patterns.some(p => globToRe(norm(p)).test(cmd));
}

// Decide one sub-command: 'deny' | 'allow' | 'block'
function judgeOne(cmd, pol) {
  if (matchesAny(cmd, pol.deny)) return 'deny';
  if (matchesAny(cmd, pol.allow)) return 'allow';
  return 'block';
}

// Public: judge a full command line.
// Returns { ok:true } or { ok:false, reason, offending, allow:[...sample] }
export function check(command) {
  const pol = load();
  const parts = subcommands(command);
  if (!parts.length) return { ok: false, reason: 'empty command' };

  for (const part of parts) {
    const verdict = judgeOne(part, pol);
    if (verdict === 'deny') {
      return { ok: false, reason: 'denied by policy', offending: part };
    }
    if (verdict === 'block') {
      return {
        ok: false,
        reason: 'not on allowlist (default-deny)',
        offending: part,
        hint: 'This command is not permitted. Use an allowed command, or ask Andy to add it to policy.json.',
        allowed: pol.allow.slice(0, 20),
      };
    }
  }
  return { ok: true };
}

export function reload() { CACHE = null; return load(); }
