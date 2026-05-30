#!/usr/bin/env node
// michi.js — MichiOS entrypoint.
//
//   michi task "…" [--config <profile>]   run one task (root mode)
//   michi serve                           start the API + control panel
//   michi config                          interactive config TUI
//   michi whoami [--config <profile>]     print the resolved brain
//
// Boot order: load .env (secrets) → load config.json profile (control plane) →
// apply config to env → dispatch. --config picks the profile (default if absent).

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { runTask } from '../lib/agent.js';
import { whoami } from '../lib/llm.js';
import { ROOT, HOME } from '../lib/paths.js';
import * as config from '../lib/config.js';

loadEnv(path.join(ROOT, '.env'));

// Parse args: pull out --config <name> and --contact <id>, keep rest positional.
const argv = process.argv.slice(2);
let profile = null;
let contactId = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--config' || argv[i] === '-c') { profile = argv[++i]; }
  else if (argv[i] === '--contact') { contactId = argv[++i]; }
  else rest.push(argv[i]);
}
const cmd = rest.shift();

// Active contact → env, so the loop injects their card + offers the contact tool,
// and the contact tool's ops are scoped to THIS person's sandbox.
if (contactId) process.env.MICHI_CONTACT = contactId;

// Apply the resolved config profile to the environment (brain, boot, limits,
// tool setup) BEFORE anything reads env. config governs; .env only holds secrets.
const activeConfig = config.applyToEnv(config.load(profile));

if (cmd === 'task') {
  const task = rest.join(' ').trim();
  if (!task) { console.error('usage: michi task "…" [--config <profile>]'); process.exit(1); }
  console.error(`[michi] profile: ${activeConfig._profile}  brain: ${JSON.stringify(whoami())}`);
  const res = await runTask(task, {
    mode: 'root',
    onStep: (s) => process.stderr.write(fmtStep(s) + '\n'),
  });
  console.log(JSON.stringify(res, null, 2));
} else if (cmd === 'serve') {
  serve();
} else if (cmd === 'whoami') {
  console.log(JSON.stringify({ profile: activeConfig._profile, contact: contactId || null, ...whoami() }, null, 2));
} else if (cmd === 'contact') {
  await contactCmd(rest);
} else {
  console.error('usage: michi <task|serve|whoami|contact> … [--config <profile>] [--contact <id>]');
  process.exit(1);
}

// michi contact list | show <id> | add <id> '{json patch}' | remember <id> "line"
async function contactCmd(args) {
  const c = await import('../lib/contacts.js');
  const sub = args.shift();
  if (sub === 'list' || !sub) { console.log(JSON.stringify(c.list(), null, 2)); return; }
  if (sub === 'show') { console.log(JSON.stringify(c.get(args[0]), null, 2)); return; }
  if (sub === 'add' || sub === 'set') {
    const id = args.shift();
    let patch = {};
    try { patch = JSON.parse(args.join(' ') || '{}'); } catch { console.error('patch must be JSON'); process.exit(1); }
    console.log(JSON.stringify(c.upsert(id, patch), null, 2));
    return;
  }
  if (sub === 'remember') { console.log(JSON.stringify(c.remember(args.shift(), args.join(' ')))); return; }
  console.error('usage: michi contact <list|show <id>|add <id> \'{json}\'|remember <id> "line">');
  process.exit(1);
}

// ── HTTP server: API + control panel ──
function serve() {
  const port = parseInt(process.env.PORT || '4488', 10);
  const token = process.env.MICHI_TOKEN || '';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // ── API ──
    if (url.pathname === '/api/task' && req.method === 'POST') {
      if (!authed(req, token)) return json(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      const task = (body.task || '').trim();
      if (!task) return json(res, 400, { error: 'task required' });
      // Run async; client can watch via /api/log or the panel.
      runTask(task, { mode: 'root' }).catch(e => console.error('[task error]', e));
      return json(res, 202, { accepted: true, task });
    }

    if (url.pathname === '/api/runs') {
      const dir = path.join(ROOT, 'var', 'log');
      const runs = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => f.startsWith('run-')).sort().reverse()
        : [];
      return json(res, 200, { runs });
    }

    if (url.pathname === '/api/log') {
      const run = url.searchParams.get('run');
      const file = path.join(ROOT, 'var', 'log', run || '');
      if (!run || !fs.existsSync(file)) return json(res, 404, { error: 'no such run' });
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      return json(res, 200, { run, events: lines.map(l => JSON.parse(l)) });
    }

    // ── home/ browser ──
    if (url.pathname === '/api/files') {
      const rel = url.searchParams.get('path') || '';
      const target = safeHome(rel);
      if (!target) return json(res, 400, { error: 'bad path' });
      if (!fs.existsSync(target)) return json(res, 404, { error: 'not found' });
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        const entries = fs.readdirSync(target, { withFileTypes: true })
          .map(e => ({ name: e.name, dir: e.isDirectory() }));
        return json(res, 200, { dir: rel, entries });
      }
      return json(res, 200, { file: rel, content: fs.readFileSync(target, 'utf8') });
    }

    if (url.pathname === '/api/whoami') return json(res, 200, whoami());

    // ── config (admin panel control plane) ──
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, config.list());
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      if (!authed(req, token)) return json(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      if (!body || !body.default) return json(res, 400, { error: 'config must have a default profile' });
      try { config.save(body); }
      catch (e) { return json(res, 500, { error: String(e.message || e) }); }
      return json(res, 200, { saved: true });
    }

    // ── panel UI ──
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'panel', 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }

    json(res, 404, { error: 'not found' });
  });

  server.listen(port, () => {
    console.log(`MichiOS up. Panel: http://localhost:${port}  Brain: ${whoami().provider}/${whoami().model}`);
  });
}

// ── helpers ──
function authed(req, token) {
  if (!token) return true; // localhost dev, no token set
  const h = req.headers.authorization || '';
  return h === `Bearer ${token}`;
}
function safeHome(rel) {
  const p = path.resolve(HOME, rel || '.');
  return (p === HOME || p.startsWith(HOME + path.sep)) ? p : null;
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function fmtStep(s) {
  if (s.kind === 'think') return `  💭 ${s.text}`;
  if (s.kind === 'act') return `  ▶ ${s.tool} ${JSON.stringify(s.args)}`;
  if (s.kind === 'observe') return `  ◀ ${String(s.result).slice(0, 300)}`;
  if (s.kind === 'done') return `  ✅ ${s.summary}`;
  if (s.kind === 'error') return `  ❌ ${s.error}`;
  if (s.kind === 'start') return `  ▶ task: ${s.task}`;
  return `  · ${s.kind}`;
}

// Minimal .env loader (KEY=VALUE, # comments). No dependency.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
