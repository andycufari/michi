// tools.js — the tool contract.
//
// Michi's tools are CLIs on PATH. MichiOS exposes them to the model as
// function-tools, and when the model calls one, we shell out and return its
// output. Adding a tool = adding an entry here (no loop changes). movicom is the
// body; `fs` lets Michi use its home/ folder.

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check as policyCheck } from './policy.js';
import { body as skillBody, list as skillList } from './skills.js';
import { ROOT, HOME } from './paths.js';
import * as contacts from './contacts.js';

const run = promisify(execFile);
const sh = promisify(exec);

// ── Tool definitions exposed to the model (OpenAI function-tool shape) ──
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'movicom',
      description:
        "Michi's body: drive a real Android phone over adb. Pass the movicom " +
        "command line WITHOUT the leading 'movicom' word. The one rule: talk to " +
        "the OS, not the glass, when you can.\n" +
        'Common commands:\n' +
        '  doctor                         — device + foreground app (start here)\n' +
        '  app list | app open <name>     — installed apps / launch by name\n' +
        '  ui see [--raw|--coords]        — read the screen as structured JSON\n' +
        '  ui tap "<label>" | ui type "<text>" | ui key <BACK|HOME|ENTER|...>\n' +
        '  ui scroll <down|up|left|right> | ui back | ui home\n' +
        '  contacts list [q] | contacts find <q> | contacts add \'{json}\'\n' +
        '  notif list                     — read notifications\n' +
        'Output is always one JSON value.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'movicom args, e.g. `ui tap "Settings"`' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs',
      description:
        "Use your home/ folder — your persistent memory and workspace. " +
        "Read, write, list, delete files under home/. Paths are relative to home/.",
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['read', 'write', 'list', 'delete'], description: 'operation' },
          path: { type: 'string', description: 'path relative to home/, e.g. notes/task.md' },
          content: { type: 'string', description: 'content to write (op=write only)' },
        },
        required: ['op'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description:
        "Your terminal. Run a command line inside MichiOS (cwd is the OS root). " +
        "This is how you do anything beyond the body and home/ — read files, " +
        "search, run CLIs (movicom, git, node, curl…). NOT every command is " +
        "allowed: MichiOS checks each against a security policy and BLOCKS " +
        "anything not on the allowlist, telling you why. Prefer the `movicom` " +
        "tool for the phone and `fs` for home/ writes; use `shell` for the rest.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'the command line, e.g. `ls home/` or `grep -r TODO home/`' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill',
      description:
        "Load the full instructions for one of your available skills (you see only " +
        "their one-line summaries in your context). Call this BEFORE doing that kind " +
        "of work, then follow the loaded instructions. Returns the skill's markdown.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'the skill name, e.g. cm64 or movicom' },
        },
        required: ['name'],
      },
    },
  },
];

// The `contact` tool is added ONLY when a contact is active (set via --contact or
// the API). It gives Michi sandboxed read/write inside contacts/<id>/ plus
// memory — so all work for a person stays in their folder. When no contact is
// active, the tool isn't offered (lean prompt).
export const CONTACT_TOOL = {
  type: 'function',
  function: {
    name: 'contact',
    description:
      "Work inside the ACTIVE contact's sandbox (contacts/<id>/). ALL files you " +
      "make for this person go here, not in home/. Ops: read · write · list " +
      "(files in their folder); remember (append a one-line memory of the " +
      "relationship); info (their profile + trust). Respect their trust level.",
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'write', 'list', 'remember', 'info'] },
        path: { type: 'string', description: 'path inside the contact folder (read/write/list)' },
        content: { type: 'string', description: 'content (write) or memory line (remember)' },
      },
      required: ['op'],
    },
  },
};

// ── Execute a tool call. Returns a string (fed back to the model). ──
// Four tools, that's all: movicom (the body), fs (home/), shell (any CLI,
// policy-gated), skill (how-to docs). Other CLIs like `cm64` are run THROUGH
// shell; a skill teaches Michi how. No bespoke wrapper per CLI, no MCP.
export async function execTool(name, args) {
  try {
    if (name === 'movicom') return await execMovicom(args.command);
    if (name === 'fs') return await execFs(args);
    if (name === 'shell') return await execShell(args.command);
    if (name === 'skill') return execSkill(args.name);
    if (name === 'contact') return await execContact(args);
    return JSON.stringify({ error: `unknown tool "${name}"` });
  } catch (e) {
    return JSON.stringify({ error: String(e.message || e) });
  }
}

// The terminal. Every command is gated by policy.json (deny → allow → block)
// and runs jailed to the MichiOS root. Michi sees the policy verdict on refusal
// so it can adapt inside its sandbox.
async function execShell(command) {
  if (!command || typeof command !== 'string') {
    return JSON.stringify({ error: 'shell needs a `command` string' });
  }
  const verdict = policyCheck(command);
  if (!verdict.ok) return JSON.stringify({ blocked: true, ...verdict, command });

  const { stdout, stderr } = await sh(command, {
    cwd: ROOT,                 // jailed to the OS root
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
    shell: '/bin/bash',
  }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || String(err.message || err) }));

  const out = clip((stdout || '').trim());
  const err = clip((stderr || '').trim());
  return JSON.stringify({ ok: true, stdout: out, stderr: err || undefined });
}

function clip(s, n = 20000) { return s.length > n ? s.slice(0, n) + '\n…[clipped]' : s; }

// Sandboxed ops within the ACTIVE contact's folder. The active contact id is
// passed via env (MICHI_CONTACT) by the loop, so the model can't target another
// person's sandbox.
async function execContact({ op, path: rel, content } = {}) {
  const id = process.env.MICHI_CONTACT;
  if (!id) return JSON.stringify({ error: 'no active contact for this run' });
  try {
    if (op === 'read') return await contacts.read(id, rel);
    if (op === 'write') return JSON.stringify(await contacts.write(id, rel, content));
    if (op === 'list') return JSON.stringify(await contacts.listFiles(id, rel || '.'));
    if (op === 'remember') return JSON.stringify(contacts.remember(id, content || ''));
    if (op === 'info') return JSON.stringify(contacts.get(id));
    return JSON.stringify({ error: `unknown contact op "${op}"` });
  } catch (e) {
    return JSON.stringify({ error: String(e.message || e), contact: id });
  }
}

// Load a skill's full body on demand (it was only summarized in the prompt).
function execSkill(name) {
  if (!name) return JSON.stringify({ error: 'skill needs a `name`' });
  const b = skillBody(name);
  if (!b) {
    return JSON.stringify({ error: `no skill "${name}"`, available: skillList().map(s => s.name) });
  }
  return b; // raw markdown — the model reads it as instructions
}

async function execMovicom(command) {
  if (!command || typeof command !== 'string') {
    return JSON.stringify({ error: 'movicom needs a `command` string' });
  }
  // Tokenize respecting quotes (movicom args can contain spaces / JSON).
  const argv = tokenize(command);
  const { stdout, stderr } = await run('movicom', argv, {
    timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || String(err) }));
  const out = (stdout || '').trim() || (stderr || '').trim();
  return out || JSON.stringify({ ok: true, note: 'no output' });
}

async function execFs({ op, path: rel, content }) {
  const safe = resolveHome(rel);
  if (op === 'read') {
    return await fs.readFile(safe, 'utf8');
  }
  if (op === 'write') {
    await fs.mkdir(path.dirname(safe), { recursive: true });
    await fs.writeFile(safe, content ?? '', 'utf8');
    return JSON.stringify({ wrote: rel, bytes: Buffer.byteLength(content ?? '') });
  }
  if (op === 'list') {
    const dir = rel ? resolveHome(rel) : HOME;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return JSON.stringify(entries.map(e => (e.isDirectory() ? e.name + '/' : e.name)));
  }
  if (op === 'delete') {
    await fs.rm(safe, { recursive: true, force: true });
    return JSON.stringify({ deleted: rel });
  }
  return JSON.stringify({ error: `unknown fs op "${op}"` });
}

// Keep Michi inside its home/ — no path traversal out.
function resolveHome(rel) {
  const p = path.resolve(HOME, rel || '.');
  if (p !== HOME && !p.startsWith(HOME + path.sep)) {
    throw new Error('path escapes home/');
  }
  return p;
}

function tokenize(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export { HOME, ROOT };
