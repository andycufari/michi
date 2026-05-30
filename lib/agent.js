// agent.js — the think→act→observe loop. Provider-agnostic, token-efficient.
//
// Give it a task string; it runs Michi until the model stops calling tools (done)
// or MAX_STEPS is hit. Every step is logged as JSONL so the panel can tail it live.
//
// THREE token-efficiency layers (token cost is a first-class concern here):
//   1. Lean boot   — only KERNEL.md (~1.5KB) is always-on; SOUL/FILESYSTEM/MEMORY
//                    are read on demand by Michi via fs/shell. (was 10.6KB/step)
//   2. Caching     — the system prompt is byte-stable so providers can cache the
//                    prefix; we mark it for Anthropic explicit caching in llm.js.
//   3. History trim — old tool results are squeezed once the convo grows past a
//                    budget, keeping the last N turns verbatim and collapsing the
//                    rest, so per-step cost stops growing unboundedly.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chat, whoami } from './llm.js';
import { TOOL_SCHEMAS, CONTACT_TOOL, execTool } from './tools.js';
import { ROOT } from './paths.js';
import { summaries as skillSummaries } from './skills.js';
import { card as contactCard } from './contacts.js';

const LOG_DIR = path.join(ROOT, 'var', 'log');

// Lean boot: kernel is always-on. The rich files are reference docs Michi pulls
// on demand. Set MICHI_FULL_BOOT=1 to load everything (debug / hard tasks).
const KERNEL = ['KERNEL.md'];
const FULL_BOOT = ['SOUL.md', 'MEMORY.md', 'FILESYSTEM.md', 'AGENT.md'];

export async function loadSystemPrompt() {
  const order = process.env.MICHI_FULL_BOOT === '1' ? FULL_BOOT : KERNEL;
  const parts = [];
  for (const name of order) {
    try {
      const txt = await fs.readFile(path.join(ROOT, 'boot', name), 'utf8');
      parts.push(txt.trim());
    } catch { /* optional */ }
  }
  // Fallback: if kernel missing, use full boot so we never boot empty.
  if (!parts.length && order === KERNEL) {
    for (const name of FULL_BOOT) {
      try { parts.push((await fs.readFile(path.join(ROOT, 'boot', name), 'utf8')).trim()); } catch {}
    }
  }

  // Persona layer (from the active config profile, passed via env):
  //  - context files: arbitrary .md, ALWAYS-ON — this is WHO Michi is for the job.
  //  - skills: one-line summaries ALWAYS visible; full body pulled on demand with
  //    the `skill` tool. Cheap by default, deep when needed (Claude Code's model).
  const ctxFiles = parseList(process.env.MICHI_CONTEXT);
  for (const rel of ctxFiles) {
    try {
      const txt = await fs.readFile(path.join(ROOT, rel), 'utf8');
      parts.push(`# Context: ${rel}\n\n${txt.trim()}`);
    } catch { parts.push(`# Context: ${rel}\n(missing — file not found)`); }
  }

  const skillNames = parseList(process.env.MICHI_SKILLS);
  const sum = skillSummaries(skillNames.length ? skillNames : null);
  if (sum) {
    parts.push(
      `# Skills available\nThese are capabilities you can load. You see only the\n` +
      `summary now; call the \`skill\` tool with a name to load its full instructions\n` +
      `BEFORE doing that kind of work.\n\n${sum}`
    );
  }

  // Active contact (set via --contact / API): inject their card so Michi knows
  // WHO it's working for, their trust level, sandbox, and relationship memory.
  const contactId = process.env.MICHI_CONTACT;
  if (contactId) {
    const card = contactCard(contactId);
    if (card) parts.push(card);
  }

  return parts.join('\n\n---\n\n');
}

function parseList(s) {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ── history trimming ───────────────────────────────────────────────
// Rough token estimate: ~4 chars/token. Keep system + task + the last
// KEEP_TURNS assistant/tool exchanges verbatim; collapse older tool results to a
// one-line stub. Cheap, lossy-but-safe (Michi keeps notes in home/ for anything
// it must not forget).
const CHARS_PER_TOKEN = 4;
const HISTORY_BUDGET_TOKENS = parseInt(process.env.HISTORY_BUDGET || '12000', 10);
const KEEP_TURNS = parseInt(process.env.KEEP_TURNS || '6', 10);

function estTokens(messages) {
  let chars = 0;
  for (const m of messages) chars += (m.content ? String(m.content).length : 0) +
    (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function trimHistory(messages) {
  if (estTokens(messages) <= HISTORY_BUDGET_TOKENS) return messages;
  // messages[0]=system, [1]=task. Protect those + the tail.
  const head = messages.slice(0, 2);
  const tail = messages.slice(2);
  const protectedTail = tail.slice(-KEEP_TURNS * 2); // ~assistant+tool per turn
  const old = tail.slice(0, tail.length - protectedTail.length);
  // Collapse old tool results; keep assistant text (it's the reasoning trail).
  const squeezed = old.map(m => {
    if (m.role === 'tool') {
      return { ...m, content: stub(m.content) };
    }
    return m;
  });
  return [...head, ...squeezed, ...protectedTail];
}

function stub(s) {
  s = String(s);
  if (s.length <= 200) return s;
  return s.slice(0, 160) + ` …[trimmed ${s.length - 160}c]`;
}

// Run one task to completion. `onStep` is called after every step for live UI.
export async function runTask(task, { mode = 'root', onStep = () => {}, maxSteps } = {}) {
  const limit = maxSteps || parseInt(process.env.MAX_STEPS || '25', 10);
  const system = await loadSystemPrompt();
  const brain = whoami();

  let messages = [
    { role: 'system', content: system },
    { role: 'user', content: `[mode: ${mode}]\n\nTask: ${task}` },
  ];

  const runId = stamp();
  const log = await openLog(runId);
  let totalTokensSeen = 0;
  const emit = async (rec) => {
    const full = { t: nowIso(), runId, ...rec };
    await log.write(JSON.stringify(full) + '\n');
    try { onStep(full); } catch {}
  };

  await emit({ kind: 'start', task, mode, brain, bootTokens: Math.ceil(system.length / CHARS_PER_TOKEN) });

  let step = 0;
  while (step < limit) {
    step++;
    messages = trimHistory(messages);
    const ctxTokens = estTokens(messages);
    let reply;
    try {
      reply = await chat({ messages, tools });
    } catch (e) {
      await emit({ kind: 'error', step, error: String(e.message || e) });
      await log.close();
      return { runId, status: 'error', error: String(e.message || e), steps: step };
    }
    totalTokensSeen = ctxTokens;

    if (reply.text) await emit({ kind: 'think', step, text: reply.text, ctxTokens });

    // No tool calls => Michi considers the task done.
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: reply.text || '' });
      await emit({ kind: 'done', step, summary: reply.text || '', ctxTokens });
      await log.close();
      return { runId, status: 'done', summary: reply.text || '', steps: step, ctxTokens };
    }

    // Record the assistant turn (with its tool calls) in OpenAI shape.
    messages.push({
      role: 'assistant',
      content: reply.text || '',
      tool_calls: reply.toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
      })),
    });

    // Execute each tool call, feed results back.
    for (const tc of reply.toolCalls) {
      await emit({ kind: 'act', step, tool: tc.name, args: tc.args });
      const result = await execTool(tc.name, tc.args || {});
      await emit({ kind: 'observe', step, tool: tc.name, result: clip(result) });
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: result });
    }
  }

  await emit({ kind: 'stopped', reason: 'max_steps', steps: step });
  await log.close();
  return { runId, status: 'max_steps', steps: step };
}

// ── helpers ──
async function openLog(runId) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const fh = await fs.open(path.join(LOG_DIR, `run-${runId}.jsonl`), 'a');
  return {
    write: (s) => fh.write(s),
    close: () => fh.close(),
  };
}
function clip(s, n = 2000) { s = String(s); return s.length > n ? s.slice(0, n) + '…[clipped]' : s; }
function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function nowIso() { return new Date().toISOString(); }
