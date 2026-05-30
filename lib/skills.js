// skills.js — the skill library (Claude Code's model, minimal).
//
// A skill is a folder under skills/<name>/ with a SKILL.md. SKILL.md has YAML-ish
// frontmatter (name, description) + a markdown body. The DESCRIPTION is cheap and
// shown to Michi always (so it knows the skill exists); the BODY is loaded only
// when Michi invokes the skill via the `skill` tool. This keeps the prompt lean
// while making capabilities discoverable.
//
//   summaries(names) -> "[skill] name — description" lines for the system prompt
//   body(name)       -> full markdown body of one skill (for the `skill` tool)
//   list()           -> all skills on disk [{name, description}]

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const DIR = path.join(ROOT, 'skills');

function read(name) {
  const file = path.join(DIR, name, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return parse(raw, name);
}

// Parse frontmatter (--- ... ---) + body. Tolerant: no frontmatter => all body.
function parse(raw, fallbackName) {
  let meta = {}, body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k) meta[k] = v;
    }
  }
  return {
    name: meta.name || fallbackName,
    description: meta.description || '(no description)',
    body: body.trim(),
  };
}

export function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => read(e.name))
    .filter(Boolean)
    .map(({ name, description }) => ({ name, description }));
}

// One-line summaries for the named skills (or all on disk if names omitted).
export function summaries(names) {
  const want = names && names.length ? names : list().map(s => s.name);
  const lines = [];
  for (const n of want) {
    const s = read(n);
    if (s) lines.push(`- ${s.name} — ${s.description}`);
  }
  return lines.join('\n');
}

// Full body of one skill — what the `skill` tool returns when Michi invokes it.
export function body(name) {
  const s = read(name);
  if (!s) return null;
  return `# Skill: ${s.name}\n${s.description}\n\n${s.body}`;
}

export { DIR as SKILLS_DIR };
