// llm.js — provider-agnostic chat completion with tool-calling.
//
// Everyone EXCEPT Anthropic speaks the OpenAI Chat Completions shape, so we
// normalize to that internally and only special-case Anthropic's Messages API.
// Swap providers by changing LLM_PROVIDER in .env — the agent loop never changes.
//
// Exposes one function:
//   chat({ messages, tools }) -> { text, toolCalls: [{id, name, args}], raw }
//
// `messages` use the OpenAI shape:
//   {role:'system'|'user'|'assistant'|'tool', content, tool_calls?, tool_call_id?, name?}
// `tools` use the OpenAI function-tool shape:
//   {type:'function', function:{name, description, parameters}}

const PROVIDERS = {
  deepseek:  { baseUrl: 'DEEPSEEK_BASE_URL', key: 'DEEPSEEK_API_KEY', model: 'DEEPSEEK_MODEL', kind: 'openai' },
  qwen:      { baseUrl: 'QWEN_BASE_URL',     key: 'QWEN_API_KEY',     model: 'QWEN_MODEL',     kind: 'openai' },
  openai:    { baseUrl: 'OPENAI_BASE_URL',   key: 'OPENAI_API_KEY',   model: 'OPENAI_MODEL',   kind: 'openai' },
  ollama:    { baseUrl: 'OLLAMA_BASE_URL',   key: null,               model: 'OLLAMA_MODEL',   kind: 'openai' },
  lmstudio:  { baseUrl: 'LMSTUDIO_BASE_URL', key: null,               model: 'LMSTUDIO_MODEL', kind: 'openai' },
  anthropic: { baseUrl: null,                key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL', kind: 'anthropic' },
};

// Which providers/models can see images. Qwen3-VL and the named GPT/Claude vision
// models are multimodal; gate on a per-provider flag where it's model-dependent.
const VISION = {
  qwen: () => process.env.QWEN_VISION === '1' || /(-vl|vision)/i.test(process.env.QWEN_MODEL || ''),
  openai: () => /(4o|4\.1|o4|vision)/i.test(process.env.OPENAI_MODEL || ''),
  anthropic: () => true,           // all current Claude models are multimodal
  ollama: () => /(-vl|vision|llava|qwen3-vl)/i.test(process.env.OLLAMA_MODEL || ''),
  lmstudio: () => process.env.LMSTUDIO_VISION === '1' || /(vl|vision|3\.5)/i.test(process.env.LMSTUDIO_MODEL || ''),
  deepseek: () => false,           // deepseek-chat is text-only
};

function cfg() {
  const name = (process.env.LLM_PROVIDER || 'qwen').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown LLM_PROVIDER "${name}". Options: ${Object.keys(PROVIDERS).join(', ')}`);
  return {
    name,
    kind: p.kind,
    baseUrl: p.baseUrl ? process.env[p.baseUrl] : null,
    apiKey: p.key ? process.env[p.key] : null,
    model: process.env[p.model] || null,
    vision: (VISION[name] || (() => false))(),
  };
}

export function whoami() {
  const c = cfg();
  return { provider: c.name, model: c.model, kind: c.kind, vision: c.vision };
}

// Does the current brain support images? The loop checks this before letting
// Michi use `ui shot` as a multimodal observation.
export function hasVision() {
  return cfg().vision;
}

export async function chat({ messages, tools }) {
  const c = cfg();
  if (c.kind === 'anthropic') return chatAnthropic(c, messages, tools);
  return chatOpenAI(c, messages, tools);
}

// ── OpenAI-compatible (deepseek, qwen, openai, ollama) ──────────────
async function chatOpenAI(c, messages, tools) {
  if (!c.model) throw new Error(`No model configured for provider ${c.name}`);
  const body = {
    model: c.model,
    messages,
    tools: tools && tools.length ? tools : undefined,
    tool_choice: tools && tools.length ? 'auto' : undefined,
    temperature: 0.3,
  };
  const headers = { 'content-type': 'application/json' };
  if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;

  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${c.name} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map(tc => ({
    id: tc.id,
    name: tc.function?.name,
    args: safeParse(tc.function?.arguments),
  }));
  return { text: msg.content || '', toolCalls, raw: msg };
}

// ── Anthropic native Messages API ───────────────────────────────────
async function chatAnthropic(c, messages, tools) {
  if (!c.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!c.model) throw new Error('ANTHROPIC_MODEL not set');

  // Split system out; convert OpenAI roles -> Anthropic content blocks.
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const amsgs = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      amsgs.push({ role: 'user', content: [{
        type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content,
      }]});
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name,
          input: safeParse(tc.function.arguments) });
      }
      amsgs.push({ role: 'assistant', content: blocks });
      continue;
    }
    amsgs.push({ role: m.role, content: m.content || '' });
  }

  const atools = (tools || []).map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  // Token efficiency layer 2: explicit prompt caching. The system prompt (boot)
  // is byte-stable across a run, so we mark it cacheable — Anthropic then charges
  // the cached prefix at ~10% on repeat steps. Same idea applies free on DeepSeek/
  // OpenAI (they auto-cache stable prefixes), which is why the boot text never
  // varies per step.
  const systemBlocks = system
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : undefined;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: c.model, system: systemBlocks, messages: amsgs,
      tools: atools.length ? atools : undefined,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input });
  }
  return { text, toolCalls, raw: data };
}

function safeParse(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
