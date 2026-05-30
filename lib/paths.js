// paths.js — the OS roots, in one dependency-free module.
//
// Everything that needs ROOT/HOME imports from HERE, not from tools.js, so we
// avoid import cycles (tools ↔ skills ↔ policy ↔ config all need ROOT).

import path from 'node:path';

// Project root = one level up from lib/.
export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const HOME = path.join(ROOT, 'home');
