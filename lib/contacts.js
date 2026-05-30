// contacts.js — Michi's relationships.
//
// A contact is a person Michi deals with. Each is a SANDBOXED folder under
// contacts/<id>/ holding a contact.json (identity + trust + memory) and all of
// the agent's work files FOR that person (the site it built, drafts, notes).
//
// Two halves:
//  - identity: name, phone, email → lets the heartbeat match an incoming
//    notification/message to a known contact (recognition).
//  - trust: owner | client | stranger → scopes what Michi will do unprompted FOR
//    this contact, layered on top of the global shell policy.
//
// API:
//   list()                       -> [{id, name, trust, phone, email}]
//   get(id)                      -> full contact.json (or null)
//   upsert(id, patch)            -> create/merge a contact
//   matchBySender(sender)        -> contact whose phone/email matches (or null)
//   dir(id)                      -> absolute path to contacts/<id>/ (sandbox root)
//   read(id, rel) / write(id, rel, content) / listFiles(id, rel) -> sandboxed fs
//   remember(id, line)           -> append a timestamped memory line
//   card(id)                     -> compact text block to inject when active

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './paths.js';

const BASE = path.join(ROOT, 'contacts');

const TRUST_LEVELS = ['owner', 'client', 'stranger'];

function cfile(id) { return path.join(BASE, id, 'contact.json'); }

export function dir(id) {
  const p = path.join(BASE, id);
  // sandbox guard — id must not escape contacts/
  if (p !== path.join(BASE, id) || !p.startsWith(BASE + path.sep)) {
    throw new Error('bad contact id');
  }
  return p;
}

export function list() {
  if (!fs.existsSync(BASE)) return [];
  return fs.readdirSync(BASE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => get(e.name))
    .filter(Boolean)
    .map(c => ({ id: c.id, name: c.name, trust: c.trust, phone: c.phone, email: c.email }));
}

export function get(id) {
  try { return JSON.parse(fs.readFileSync(cfile(id), 'utf8')); }
  catch { return null; }
}

export function upsert(id, patch = {}) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`bad contact id "${id}"`);
  fs.mkdirSync(dir(id), { recursive: true });
  const existing = get(id) || {
    id, name: id, trust: 'stranger', phone: '', email: '',
    created: nowIso(), memory: [],
  };
  const merged = { ...existing, ...patch, id };
  if (patch.trust && !TRUST_LEVELS.includes(patch.trust)) {
    throw new Error(`trust must be one of ${TRUST_LEVELS.join('|')}`);
  }
  fs.writeFileSync(cfile(id), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

// Recognition: find the contact a phone/email/string belongs to.
export function matchBySender(sender) {
  if (!sender) return null;
  const s = String(sender).toLowerCase().trim();
  const digits = s.replace(/[^0-9]/g, '');
  for (const c of list().map(x => get(x.id))) {
    if (!c) continue;
    if (c.email && c.email.toLowerCase() === s) return c;
    if (c.phone) {
      const cd = c.phone.replace(/[^0-9]/g, '');
      // match if either is a suffix of the other (handles +54 / 0 prefixes)
      if (cd && digits && (cd.endsWith(digits) || digits.endsWith(cd))) return c;
    }
    if (c.name && s.includes(c.name.toLowerCase())) return c;
  }
  return null;
}

// ── sandboxed filesystem within a contact's folder ──
function safe(id, rel) {
  const root = dir(id);
  const p = path.resolve(root, rel || '.');
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('path escapes contact sandbox');
  return p;
}

export async function read(id, rel) { return fsp.readFile(safe(id, rel), 'utf8'); }
export async function write(id, rel, content) {
  const p = safe(id, rel);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content ?? '', 'utf8');
  return { wrote: rel, contact: id, bytes: Buffer.byteLength(content ?? '') };
}
export async function listFiles(id, rel) {
  const p = safe(id, rel);
  const entries = await fsp.readdir(p, { withFileTypes: true });
  return entries.map(e => e.isDirectory() ? e.name + '/' : e.name);
}

// Append a memory line (the running relationship log).
export function remember(id, line) {
  const c = get(id);
  if (!c) throw new Error(`no contact "${id}"`);
  c.memory = c.memory || [];
  c.memory.push(`${nowIso()} ${line}`);
  fs.writeFileSync(cfile(id), JSON.stringify(c, null, 2) + '\n');
  return { remembered: line, contact: id };
}

// Compact card injected into the prompt when a contact is active.
export function card(id) {
  const c = get(id);
  if (!c) return '';
  const mem = (c.memory || []).slice(-8).map(m => '  - ' + m).join('\n');
  return [
    `# Active contact: ${c.name} (${c.id}) — trust: ${c.trust}`,
    c.phone ? `phone: ${c.phone}` : '',
    c.email ? `email: ${c.email}` : '',
    c.notes ? `notes: ${c.notes}` : '',
    `Their sandbox is contacts/${c.id}/ — ALL work for ${c.name} goes there (use`,
    `the \`contact\` tool, not \`fs\`/\`shell\`, so it stays in their folder).`,
    `Trust "${c.trust}" scopes what you may do unprompted: owner=full, ` +
      `client=build+report, stranger=read+always ask before acting.`,
    mem ? `Recent memory:\n${mem}` : 'No prior memory with this contact.',
  ].filter(Boolean).join('\n');
}

function nowIso() { return new Date().toISOString(); }
export { BASE as CONTACTS_DIR, TRUST_LEVELS };
