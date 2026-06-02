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
import { applyContextTags, unwrap } from './context-tags.js';

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
// The model drives a STATEFUL screen — only the CURRENT screen matters. Old
// frames/screen-reads are superseded the instant Michi acts again, so keeping
// their full content in context is pure waste (and on a 9B it overflows the
// window — scar 2026-06-02: two `ui frame` reads + boot + tools = "Context size
// exceeded"). Andy's principle: "keep only the current status in messages — the
// model doesn't need to see all the interfaces, just the steps."
//
// So: keep the STEPS (assistant reasoning + which tool was called) verbatim, but
// collapse every screen-read EXCEPT THE LATEST to a one-line marker. The model
// always sees the live screen + the trail of what it did, never stale screens.
// A safety net trim by token budget still runs for non-screen tool spam.
const CHARS_PER_TOKEN = 4;
const HISTORY_BUDGET_TOKENS = parseInt(process.env.HISTORY_BUDGET || '6000', 10);
const KEEP_TURNS = parseInt(process.env.KEEP_TURNS || '8', 10);

function estTokens(messages) {
  let chars = 0;
  for (const m of messages) chars += (m.content ? String(m.content).length : 0) +
    (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// Budget SAFETY-NET. Screen lifecycle is handled by the <context:…> protocol
// (applyContextTags) before this runs; this only catches the residual case of
// lots of NON-screen tool output (a big shell dump, many file reads) pushing past
// the budget. Protects system+task, the recent tail, and any <context:keep> block.
function trimHistory(messages) {
  if (estTokens(messages) <= HISTORY_BUDGET_TOKENS) return messages;
  const head = messages.slice(0, 2);
  const tail = messages.slice(2);
  const protectedTail = tail.slice(-KEEP_TURNS * 2);
  const old = tail.slice(0, tail.length - protectedTail.length)
    .map(m => (m.role === 'tool' && !m._ctxKeep ? { ...m, content: stub(m.content) } : m));
  return [...head, ...old, ...protectedTail];
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

  // Offer the contact tool ONLY when a contact is active (lean prompt otherwise).
  const tools = process.env.MICHI_CONTACT ? [...TOOL_SCHEMAS, CONTACT_TOOL] : TOOL_SCHEMAS;

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
  let nudges = 0;
  const MAX_NUDGES = 2; // re-prompt a stalled weak model at most twice before giving up
  while (step < limit) {
    step++;
    // Context protocol: expire rm:N blocks, collapse superseded screens, pin keeps
    // (Andy's <context:…> design). Then the budget safety-net. Then unwrap the tags
    // so the model sees clean content, not directive syntax.
    messages = applyContextTags(messages, step);
    messages = trimHistory(messages);
    const ctxTokens = estTokens(messages);
    let reply;
    try {
      reply = await chat({ messages: messages.map(m => m.content ? { ...m, content: unwrap(m.content) } : m), tools });
    } catch (e) {
      await emit({ kind: 'error', step, error: String(e.message || e) });
      await log.close();
      return { runId, status: 'error', error: String(e.message || e), steps: step };
    }
    totalTokensSeen = ctxTokens;

    if (reply.text) await emit({ kind: 'think', step, text: reply.text, ctxTokens });

    // No tool calls => Michi may be done... or it may have STALLED. Weak local
    // models (9B) often emit an empty turn right after a tool result instead of
    // continuing or summarising. If the last thing in history was a tool result
    // and this reply has no tool call AND no real text, NUDGE once before
    // accepting "done" — re-prompt it to either keep going or state the answer.
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      const lastWasTool = messages.length && messages[messages.length - 1].role === 'tool';
      const trivialText = !reply.text || reply.text.trim().length < 3;
      if (lastWasTool && trivialText && nudges < MAX_NUDGES) {
        nudges++;
        await emit({ kind: 'nudge', step, n: nudges });
        messages.push({ role: 'assistant', content: reply.text || '' });
        messages.push({ role: 'user', content:
          "Continue the task. If you still need to act on the phone, call the movicom " +
          "tool with the next command (e.g. `ui frame` to read the screen, or `ui do <n>` " +
          "to act). If the task is finished, reply with a short sentence stating the result." });
        continue;
      }
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
