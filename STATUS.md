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

### 2026-06-02 (later) — TWO-LAYER architecture proven: agnostic frame + self-healing macros
- **Andy's two insights closed the design:** (1) "navigation is app-agnostic —
  THAT's why we have workflows: macros for specific apps"; (2) "the model can save
  a workflow AFTER performing a task" (self-improving); (3) "workflows should start
  from a SECURE POINT — reset to main menu, then open the app."
- **The architecture (PROVEN on the real Moto G06, sent to Andres on WhatsApp):**
  - **Layer 1 — agnostic frame** (`ui frame` + `ui do <n|verb>`): read+do, works on
    any app, no app knowledge. The universal body.
  - **Layer 2 — app macros** (`workflow`): parameterized ($1,$2), self-healing,
    built ON TOP of layer 1. App-specific ergonomics live as DATA, not core code.
- **`ui do` now takes a NUMBER (interactive) OR a VERB (macro).** `do 1` is
  position-specific (fine live, wrong in a macro). `do type "x"` / `do send` /
  `do back` RE-RESOLVE against the live frame each run → macros SELF-HEAL when the
  UI shifts. `do` always rebuilds the frame first (killed the stale-numbering bug).
- **`app fresh <name>`** = Andy's secure start point: force-stop + home + launch, so
  a macro ALWAYS begins at the app's main screen (fixed: `ui tap Andres` had opened
  ContactInfoActivity instead of the chat because replay started mid-app).
- **`workflow run <name> a "b c"`** preserves quoted multi-word args (was shattering
  $2 into $2,$3,$4… via re-join+re-tokenize; now passes argv array through intact).
  `$1,$2,…,$*` substitution in steps.
- **The self-improving loop (DECIDED):** model passes steps directly —
  `workflow add wa-send '["app fresh whatsapp","ui tap $1","ui do type \"$2\"","ui do send"]'`
  — with explicit $-params. No journal/recorder needed; the model knows what it ran.
  Working macro: `workflow run wa-send Andres "..."` → message delivered, verified.
- Classifier fix: phantom `send` on Settings ("Search settings" matched submit) —
  `send` verb only emitted when an input ALSO exists; else demoted to a normal open.
- `_clearInput()` (select-all+DEL) before typing in `do` input path (was appending
  to leftover drafts). Frame `do` list drops nav-dup/timestamps/receipts into `read`.

### 2026-06-02 — THE FRAME: app-agnostic numbered AIX (movicom redesign)
- **Andy's reframe → my design.** Andy: "we should have a super easy android
  remote control AGNOSTIC to apps… process the app to text… actions could be dots
  → open dots… always print result after the action." He said *"this should be
  YOUR design, you're the user."* So I designed the interface I actually want to
  drive — the **FRAME**.
- **The frame** (`movicom ui frame` / `ui f`): every action returns ONE object —
  `{app, read:[...content...], do:["1 type <text>","2 send","3 up","4 down",
  "5 back","6 home","7 open: <row>", … ,"N more (k more)"]}`. Read the content,
  pick `ui do <n>`, get the next frame back. The model NEVER needs app-specific
  labels — movicom CLASSIFIES the raw tree into a fixed vocabulary
  (input/submit/nav/more/open). Same gestures drive WhatsApp, Gmail, Settings.
- **`ui do <n> ["text"]`** runs the nth action and folds the fresh frame into its
  result (`{did, frame}`). Numbered = cheapest AIX; act→see always closed.
- **Proven on WhatsApp:** sent a DM with TWO commands, zero labels/coords:
  `ui do 1 "Decimo test…"` → typed; `ui do 2` → sent. Verified in chat history.
- **Bugs found + fixed by dogfooding the frame live:**
  - `type` APPENDED to an existing draft (leftover "test\> here oNoveno…"). Fixed:
    `_clearInput()` (select-all + DEL) before typing in the `do` input path.
  - `do` list was noisy ("Back" dup of the verb, timestamps, "Delivered" as
    opens). Fixed: classifier drops NAV-dup + status/timestamp rows into `read`.
  - WhatsApp hides Send when the input is empty → no `send` verb until you type
    (correct: can't send empty). Reappears after `do 1`.
- **typeText() escaping rebuilt** (3 sites unified): device `input text` is
  ASCII-ONLY on the Moto G06 — accents AND emoji throw NullPointerException and
  drop the whole message. Now: transliterate accents (qué→que, ñ→n) so LATAM text
  stays readable, drop emoji, escape shell specials (a "->" had tried to REDIRECT
  to a Read-only file). Verified live.
- **Keyboard auto-dismiss** baked into every action (`_dismissKb` = BACK only if
  IME shown). Replaces the broken `kbd off` (`ime disable` doesn't close in-app
  panels on real OEM phones — Andy watched the emoji keyboard stay open).
- **`notif list` is now heartbeat-grade:** full pkg + short app + title (catches
  SpannableString) + text + when(epoch) + key(dedupe/dismiss) + category;
  `--since <ms>` (only-new) and `--apps a,b` (allow-list); default drops OS/OEM
  noise (795 tok → ~0 when nothing real pending). THE cron→heartbeat primitive.
- **Old verbs kept** (`ui see/tap/fill/send`) so nothing breaks; frame is the new
  front door. NEXT: 3-app agnosticism probe (WhatsApp/Gmail/Settings, same `do N`
  grammar), then commit movicom + update skill/README/AGENTS with the frame.

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

### 2026-06-01 (camera + AII/AIX token discipline)
- **`movicom camera shot '{"pull":true}'`** — take a real photo in ONE call:
  opens camera, clears permission dialogs, presses Shutter, finds the new image
  via MediaStore (max _id; file lands in DCIM/ OR Pictures/), pulls it so the
  multimodal brain can SEE it. Verified: captured + viewed a real 1440×1920 JPEG
  (the emulator's green-landscape camera scene). Bug fixed: `--sort` flag quotes
  get mangled through adbShell→execSync; scan rows + take max _id in JS instead.
- **Used the phone for a real task:** "Buenos Aires weather tomorrow in °C" via
  Chrome (open→fill search→ENTER→see). Answer read as TEXT, no screenshot:
  **tomorrow (Tue) = Nublado, máx 14° / mín 11°.** 4 movicom calls.
- **Cost lesson (Andy's question):** for the OPEN web / native apps / logged-in
  stuff (Google search, Instagram, Rappi) there is NO api — movicom is the only
  option, and it beats screenshots (text not pixels, no per-image $) and Chrome
  extensions (no install/maintenance). Use a real API only when one exists (e.g.
  weather). Decision tree lives in head; consider baking into the movicom skill.
- **AII/AIX token fight** (Andy: "the text IS your UI… make it a menu… compact +
  pages… wrap into your desired AI Interface/Experience"). A Google results page
  dumped 115 actions = ~1350 tok of mostly junk (content was ~120). Fixed:
  (1) noise filter (drop tracking URLs, encoded queries, nav/footer boilerplate);
  (2) PAGINATION — show ~12 actions/page, report `page:"N/M"`, `ui more` for the
  next page; full list cached so `ui tap` resolves a label on ANY page (no reach
  lost). **Result: 1350 → 269 tokens (5×), same answer, same reach.**
- movicom committed+pushed (camera, noise filter, pagination, ui more, ui see
  <page#>). AGENTS.md documents the menu/paging AIX. Synced global + mirror.
