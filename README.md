# MichiOS

A tiny operating system for an autonomous LLM agent named **Michi**.

The bet: instead of wiring an agent to dozens of API integrations (email, calendar,
WhatsApp, …), you give it **one body** — a real phone, driven through
[movicom](https://github.com/andycufari/movicom) — and let it use apps the way a
human does. One fat integration replaces a pile of brittle ones. Simpler than
OpenClaw: we don't need 1000 tools, we need a phone and a home.

```
  YOU ──API/panel──▶ MichiOS ──loop──▶ Michi (the LLM)
                        │                   │ thinks, calls a tool
                        ├─ boot/  SOUL → MEMORY → AGENT  (who · knows · how → system prompt)
                        ├─ home/  Michi's files (its scratch workspace, visible to you)
                        ├─ var/log/ every step as JSONL (the panel tails it)
                        └─ tools/ movicom (the body) · fs (the home)
```

## Layers

| Layer | What it is | Status (v0.1) |
|---|---|---|
| **boot** | lean `KERNEL.md` always-on (~260 tok); SOUL/MEMORY/FILESYSTEM/AGENT read on demand | ✅ |
| **brain** | any LLM API, swappable in `.env` (`LLM_PROVIDER`) | ✅ deepseek/qwen/openai/anthropic/ollama |
| **loop** | hand-rolled think→act→observe, ~one file, zero deps | ✅ |
| **tools** | `movicom` (body) · `fs` (home/) · `shell` (terminal, policy-gated) | ✅ |
| **policy** | `policy.json` allow/deny gate on the shell (deny→allow→block) | ✅ |
| **tokens** | lean boot + prompt caching + history trimming | ✅ |
| **home** | `home/` — Michi's persistent workspace & memory | ✅ |
| **log** | `var/log/run-*.jsonl` — every thought & action | ✅ |
| **panel** | web control panel: stream + home/ browser + send-task | ✅ |
| **heartbeat** | wake to read notifications, continue tasks | ⏳ next |
| **scheduler** | cron-driven autonomous runs | ⏳ next |

## Quick start

```bash
cd michios
cp .env.example .env          # then put your API key in it
npm start                     # → panel at http://localhost:4488
```

Or run one task straight from the terminal:

```bash
node bin/michi.js task "open settings on the phone and tell me the wifi network name"
```

### Configure the brain

Edit `.env`. Default is DeepSeek (cheap, capable). To switch:

```ini
LLM_PROVIDER=deepseek        # deepseek | qwen | openai | anthropic | ollama
DEEPSEEK_API_KEY=sk-...
```

Everyone except Anthropic speaks the OpenAI tool-calling shape, so the loop is
identical across providers — flip one line to A/B brains.

### Connect the body

MichiOS calls `movicom`, which must be on your PATH and pointed at a device
(emulator or real phone over adb). See the
[movicom README](https://github.com/andycufari/movicom). Quick check:

```bash
movicom doctor      # should print your device + foreground app
```

## API (root mode)

```bash
# send a task (runs async; watch it in the panel)
curl -X POST localhost:4488/api/task -H 'content-type: application/json' \
  -d '{"task":"check my notifications and summarize anything important"}'

curl localhost:4488/api/runs                  # list runs
curl "localhost:4488/api/log?run=run-….jsonl" # full step log of a run
curl "localhost:4488/api/files?path=notes"    # browse Michi's home/
```

Set `MICHI_TOKEN` in `.env` to require `Authorization: Bearer <token>` on `/api/task`.

## How the loop works

1. `boot/SOUL.md` + `MEMORY.md` + `AGENT.md` are concatenated into the system
   prompt (who Michi is → what it knows → how it operates).
2. Your task becomes the first user message.
3. Michi thinks, then emits tool calls. MichiOS runs each tool (shells out to
   `movicom`, or reads/writes `home/`) and feeds the result back.
4. Repeat until Michi stops calling tools (done) or `MAX_STEPS` is hit.
5. Every step is appended to `var/log/run-*.jsonl` — the panel tails it live.

## Token efficiency

MichiOS treats tokens as a first-class cost (same discipline as movicom reading
the screen as text, not screenshots). Three layers:

1. **Lean boot** — only `boot/KERNEL.md` (~260 tokens) is always in the system
   prompt. The full SOUL / FILESYSTEM / MEMORY / AGENT docs (~2,660 tokens) are
   read **on demand** by Michi via `fs`/`shell` when a task needs the depth. Saves
   ~2,400 tokens *per step* — ~60K over a 25-step task. (`MICHI_FULL_BOOT=1` loads
   everything for debugging/hard tasks.)
2. **Prompt caching** — the boot prefix is byte-stable, so providers cache it:
   explicit `cache_control` on Anthropic, automatic prefix caching on
   DeepSeek/OpenAI. Repeat steps pay a fraction for the system prompt.
3. **History trimming** — once the conversation passes a token budget
   (`HISTORY_BUDGET`, default 12K), old tool results are collapsed to one-line
   stubs while the last `KEEP_TURNS` (default 6) stay verbatim. Per-step cost stops
   growing unboundedly on long runs. Michi keeps anything it must not forget in
   `home/`.

## Security policy

The `shell` tool is gated by `policy.json` (`{allow:[…], deny:[…]}` glob patterns):

- **deny wins → allow → otherwise BLOCK** (default-deny). Nothing runs unless
  matched by `allow` and not by `deny`.
- Compound commands are split and judged per sub-command, so a denied command
  can't ride behind an allowed one (`ls && cat .env` → blocked).
- Default-deny means an unknown command is refused *with a reason*, so the agent
  learns its sandbox rather than failing blind.
- Edit `policy.json` by hand (versioned; the agent never writes it). For a fully
  trusting setup, `allow:["*"]` + a strong denylist — best paired with running the
  shell in Docker (roadmap).

## License

MIT © Andy Cufari
