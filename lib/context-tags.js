// context-tags.js — an in-band protocol for context lifetime.
//
// A small, harness-agnostic directive language a tool (or the model, or a human)
// can embed in message content to tell the ENGINE how long that content should
// live in the conversation. There is no LLM standard for this — context is
// usually trimmed blindly host-side. This makes it DECLARATIVE and LOCAL: the
// content itself says when it stops being useful.
//
// Directives (case-insensitive tag name `context`):
//   <context:rm:N>…</context>        drop this block after N more model-turns
//   <context:rm>…</context>          shorthand for rm:1 (drop after the next turn)
//   <context:keep>…</context>        pin — never trimmed by any budget logic
//   <context:supersede=TAG>…</context>
//                                    only the MOST RECENT block with this TAG
//                                    survives; older same-TAG blocks are dropped
//
// Design choices (Andy, 2026-06-02):
//   • readable, fixed syntax (not a random nonce) — a "standard format for LLMs"
//   • works outside michios — pure string in, string/array out, no deps
//   • the ENGINE parses & enforces; producers just annotate
//
// Collision: the tag is rare enough in practice; we accept the tiny risk that a
// tool reads a document literally containing `<context:…>`. (If that ever bites,
// switch producers to the tool-wrapper-only policy — scan only intentional tags.)

const OPEN_RE = /<context:([a-z]+)(?::([^>=]+))?(?:=([^>]+))?>/i;
// a full block: <context:DIRECTIVE...>BODY</context>  (non-greedy body)
const BLOCK_RE = /<context:([a-z]+)(?::([^>=]+))?(?:=([^>]+))?>([\s\S]*?)<\/context>/gi;

// Parse the directive header of a block. Returns {kind, n?, tag?} or null.
function parseDirective(name, arg, eqval) {
  const k = (name || '').toLowerCase();
  if (k === 'rm') return { kind: 'rm', n: arg != null ? Math.max(1, parseInt(arg, 10) || 1) : 1 };
  if (k === 'keep') return { kind: 'keep' };
  if (k === 'supersede') return { kind: 'supersede', tag: (eqval || arg || 'default').trim() };
  return null; // unknown directive → leave the block untouched
}

// Does a string contain any context directive? (cheap gate)
export function hasContextTag(s) { return typeof s === 'string' && OPEN_RE.test(s); }

// Strip the WRAPPER tags from a block, leaving the inner body. Used when we keep a
// block but don't want the model to keep re-reading the directive syntax. We KEEP
// tags by default (so re-trims still see them); call this only when finalizing.
export function unwrap(s) {
  return String(s).replace(BLOCK_RE, (_m, _n, _a, _e, body) => body);
}

// The core: given the message array, apply context directives. `messages` is the
// OpenAI-shape array ({role, content, ...}). Returns a NEW array; never mutates.
//
// `turn` is the current model-turn counter — used to expire `rm:N` blocks. Each
// message that carries directives also remembers the turn it was ADDED (we stamp
// `_ctxTurn` on it the first time we see it without one).
//
// Algorithm:
//   1) stamp _ctxTurn on any message that has a directive and no stamp yet
//   2) for `supersede=TAG`: find the latest message per TAG; drop the tag's BLOCK
//      from all older messages
//   3) for `rm:N`: if (turn - _ctxTurn) >= N, drop the block
//   4) `keep`: marked so budget-trimmers skip it (we set message._ctxKeep = true)
// "Drop the block" = remove just that <context>…</context> span from the content,
// leaving any surrounding text. If a message becomes empty, replace with a stub.
export function applyContextTags(messages, turn) {
  // 1) stamp
  const msgs = messages.map((m) => {
    if (m.content && hasContextTag(m.content) && m._ctxTurn == null) {
      return { ...m, _ctxTurn: turn };
    }
    return { ...m };
  });

  // 2) supersede: latest index per tag
  const latestForTag = new Map();
  msgs.forEach((m, i) => {
    if (!m.content) return;
    let mm; const re = new RegExp(BLOCK_RE.source, 'gi');
    while ((mm = re.exec(m.content))) {
      const d = parseDirective(mm[1], mm[2], mm[3]);
      if (d && d.kind === 'supersede') latestForTag.set(d.tag, i);
    }
  });

  // 3+4) rewrite each message's content. We KEEP the wrapper tags on surviving
  // blocks (so later passes can still see the directive — critical for supersede
  // and rm:N, which must re-evaluate each turn). We only REPLACE a block with a
  // stub when it's actually dropped. Final unwrap (stripping tags for the model)
  // is a separate optional step the engine can call right before send.
  return msgs.map((m, i) => {
    if (!m.content || !hasContextTag(m.content)) return m;
    let keepPin = false;
    const re = new RegExp(BLOCK_RE.source, 'gi');
    const newContent = m.content.replace(re, (full, name, arg, eqval/*, body*/) => {
      const d = parseDirective(name, arg, eqval);
      if (!d) return full;
      if (d.kind === 'keep') { keepPin = true; return full; }   // pin; keep tag
      if (d.kind === 'supersede') {
        return latestForTag.get(d.tag) === i ? full : `[${d.tag} superseded — re-read if needed]`;
      }
      if (d.kind === 'rm') {
        const age = turn - (m._ctxTurn ?? turn);
        return age >= d.n ? '[expired — re-fetch if needed]' : full;
      }
      return full;
    });
    const out = { ...m, content: newContent };
    if (keepPin) out._ctxKeep = true;
    return out;
  });
}

// Convenience for producers (tools): wrap a payload with a directive.
export const ctx = {
  rm:   (s, n = 1) => `<context:rm:${n}>${s}</context>`,
  keep: (s)        => `<context:keep>${s}</context>`,
  supersede: (s, tag = 'default') => `<context:supersede=${tag}>${s}</context>`,
};
