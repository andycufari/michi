# MichiOS — Project Status Log

> Living status. **Always update this file** every meaningful step (Andy's
> standing directive, 2026-05-31). Newest entry on top.

## Snapshot
- **What:** MichiOS — runtime turning any LLM API into autonomous agent **Michi**;
  one body (a phone via `movicom`) + a web builder (`cm64`) replace dozens of
  integrations. Repo `github.com/andycufari/michi` (local `~/DEUS/PROJECTS/michios`,
  dir `michios`, slug `michi`). Git author Andy / andycufari@gmail.com, **no
  co-author trailer**. `.env` gitignored.
- **OS works end-to-end** (boot → loop → local brain → tool dispatch → done).
- **Current blocker:** sending an email via the Gmail app — a movicom field-focus
  race in multi-field forms (see below).

## Architecture (DECIDED — do not relitigate)
- **4 tools only:** `movicom` (body), `fs` (home/), `shell` (any CLI, policy-gated),
  `skill` (load how-to docs on demand). **No bespoke per-CLI tool, no MCP.** `cm64`
  runs THROUGH `shell`; a skill teaches it. `contact` tool added only when a
  contact is active.
- **Boot:** lean `KERNEL.md` always-on (~300 tok) + SOUL/MEMORY/FILESYSTEM/AGENT on
  demand (`MICHI_FULL_BOOT=1` loads all). Filesystem-as-interface.
- **config.json** = control plane (brain/boot/limits/persona) · **.env** = secrets ·
  **policy.json** = shell security (deny>allow>block, default-deny, compound-split).
- **Profiles:** default, deep, cheap, heartbeat, **webmaster**, local. A profile
  composes a persona = context files (always-on) + skills (summary always, body
  on-demand). `webmaster` = context/webmaster.md + skills [cm64, movicom], brain
  lmstudio `qwen/qwen3.5-9b`.
- **Brain swappable** via `LLM_PROVIDER`: qwen|deepseek|openai|anthropic|ollama|
  lmstudio. `lib/config.js applyToEnv` bridges config→env (base-URL defaults for
  local providers, per-provider vision flag).
- **Contacts:** `lib/contacts.js`, `contacts/<id>/` sandbox + contact.json (identity
  phone/email, trust owner|client|stranger, memory[]). `matchBySender(phone|email)`
  for future heartbeat. Card injected when active. **Verified 11/11.**
- **Token layers:** lean boot + prompt caching (cache_control) + history trimming.
- **Panel:** `michi serve` (:4488) — live JSONL stream + home browser + config admin.

## Proven working
- `michi whoami --config webmaster` → lmstudio qwen/qwen3.5-9b, vision:true.
- Intro task: Michi loaded the **webmaster persona**, listed its tools, done — OS
  end-to-end confirmed.
- doctor task: Michi emitted real OpenAI `tool_calls`, ran `movicom doctor`.
- Emulator `emulator-5554` up; Gmail configured, signed in as **Rune
  rune.agent.44@gmail.com**.

## Log

### 2026-05-31 (later) — EMAIL SENT ✅ + movicom root cause found & fix spec'd
- **Andy's call (correct):** fix movicom BEFORE a 9B model uses it. I sent the
  email by hand to pin the bug. **Result: email "Hello from Michi" → andycufari@
  gmail.com SENT and confirmed in the Sent folder.** (account on device: Rune.)
- **ROOT CAUSE (two real movicom bugs, seen in raw XML):**
  1. **Stale dump after keyboard opens.** When the soft keyboard appears the
     layout shifts ~436px (Subject moved from y=953 → y=517 between dumps). But
     `tap()` reuses `this._els` from the LAST `see()` (line ~224 sets `_els=[]`,
     but `_find` calls `_silentSee` only if empty — after a `type()` the cached
     els are stale, not empty). Tapping a field by old coords lands ~436px off →
     "tap Subject" hit the attachment/camera area. **Fix: `tap()` must ALWAYS
     re-dump fresh immediately before resolving coords.**
  2. **`type()` types into whatever is focused — it never focuses the target
     field first.** So after the recipient commits (focus still in To), the next
     `type()` calls dumped Subject+Body INTO To
     (`andycufari@gmail.comHello from Michi`). **Fix: add an optional field arg to
     `type(field, text)` OR a `fill` that, per field, re-dumps → taps the field →
     types → settles.**
  - Also: `ui see --raw` and `--coords` flags don't surface XML/coords via the CLI
    path (minor bugs to fix while in there).
- **The working recipe (validated by hand, /tmp/send_email.py):** fresh-dump
  before EACH field tap; To=empty-EditText → type → KEYCODE_ENTER (commits chip);
  Subject=EditText text="Subject" → tap fresh coords → type; Body=EditText
  text="Compose email" → tap fresh coords → type; Send=node content-desc="Send".
- **NEXT (do this):** patch `~/DEUS/PROJECTS/movicom/movicom.js` so `tap()`
  always re-dumps, and add `fill`/`type(field,text)` that focuses-then-types with
  a settle. Sync to npm global + Claudia mirror. Then re-run the SAME email task
  via `michi task --config webmaster` and watch even the 9B do it. Update the
  movicom skill with the Gmail recipe.

### 2026-05-31 — Gmail send: movicom multi-field focus race (BLOCKER)
- Goal: Michi sends an email by driving the Gmail app (Andy: no new tool, just
  movicom; "just send, trust it").
- **9B model:** loaded the movicom skill then stalled (empty turn → loop treated as
  done). Too weak to chain a 10-step UI task **— but not the only problem.**
- **Real bug (Andy's screenshot confirmed):** tapping field-by-field
  (`tap "Subject"`, `tap "Compose email"`) does **not** move focus in Gmail compose
  — text mashes into the To field (`andycufari@gmail.comHello from Michi`). This is
  movicom's documented async-input + soft-keyboard-shift race biting Gmail.
- Tried `ui key TAB` to advance fields → **bounces to inbox / dismisses compose**
  (Gmail auto-saves a draft). Not the field-advance.
- **What DOES work:** type recipient in the already-focused To field, then
  `ui key ENTER` → recipient commits as a chip (verified: To = andycufari@gmail.com).
- **Open question / next:** reliable way to focus Subject then Body. Try: tap the
  literal "Subject" label with a settle + RE-READ before typing; same for "Compose
  email". If still racing, the fix belongs in **movicom** (focus/settle logic) or
  the **movicom skill** must spell out the Gmail-compose recipe. Andy's framing:
  "make movicom/skill easier to follow" → improve skill/movicom, don't blame model.
- State left dirty: stray Gmail draft(s) from the failed attempts — discard before
  retrying; start ONE fresh compose and fill in an uninterrupted pass.

### 2026-05-30 → 05-31 — Build sprint (all pushed, 7 commits)
- v0.1 walking skeleton (lean boot, tools, policy gate, token layers).
- Config control plane + profiles + persona system (context + skills, on-demand).
- LM Studio provider + `local`/`webmaster` profiles; Qwen3.5-VL 9B default dev brain.
- Fixed config→env bridge (base URL + vision flag); fixed import cycle (lib/paths.js).
- Webmaster persona; cm64 + movicom skills (point at each CLI's own self-docs).
- Contacts foundation (sandbox + memory + trust), verified 11/11.

## Open TODOs
- [x] **Gmail send proven by hand** (2026-05-31) — email confirmed in Sent.
- [ ] **Patch movicom**: `tap()` always re-dumps fresh; add `type(field,text)` /
      `fill` that focuses-then-types-then-settles. Fix `--raw`/`--coords`. Sync
      global + Claudia mirror. THEN re-run the email task through Michi (even 9B).
- [ ] Update the movicom skill with the Gmail-compose recipe.
- [ ] Loop nudge: if model returns no tool-call AND no real text early, re-prompt
      instead of marking done (helps weak local models persist).
- [ ] Allowlist `Bash(node bin/michi.js:*)` in `.claude/settings.local.json` so Andy
      stops approving every MichiOS command (offered, not done).
- [ ] Heartbeat: read `movicom notif list` → matchBySender → load contact → act.
- [ ] `michi config` TUI (referenced in code but NOT implemented — would crash).
- [ ] Approval brake for outbound (currently "just send" for testing only).
- [ ] Real device (Moto G04s) once it arrives; Docker for `allow:["*"]` safely.

## Andy's standing directives
- No co-author trailer on commits. Author = Andy / andycufari@gmail.com.
- Keep it SIMPLE — no over-engineering (he killed the bespoke cm64 tool + MCP client).
- Tools are movicom/fs/shell/skill only; other CLIs via shell + a skill.
- Token efficiency is first-class.
- **Always update this STATUS.md.**
