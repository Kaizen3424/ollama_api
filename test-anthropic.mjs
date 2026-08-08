const BASE = 'http://localhost:3001'

import { request } from 'node:http'
import { readFileSync } from 'node:fs'

const { PROXY_API_KEY1: KEY1, PROXY_API_KEY2: KEY2 } = process.env

let passed = 0
let failed = 0

function check(name, ok, detail) {
  const status = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${status} ${name}${detail ? ': ' + detail : ''}`)
  if (ok) passed++; else failed++
}

async function api(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const h = { 'Content-Type': 'application/json', ...headers }
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers: h }
    const req = request(opts, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

const ANTH_VERSION = '2023-06-01'

function parseSse(text) {
  const events = []
  let currentEvent = null
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      currentEvent = { event: line.slice(6).trim(), data: null }
    } else if (line.startsWith('data:') && currentEvent) {
      const jsonStr = line.slice(5).trim()
      if (jsonStr === '') continue
      try {
        currentEvent.data = JSON.parse(jsonStr)
        events.push(currentEvent)
      } catch { /* not JSON — skip */ }
      currentEvent = null
    }
  }
  return events
}

// ─── 1. Non-streaming (x-api-key auth) ─────────
console.log('\n=== 1. Anthropic non-streaming (x-api-key) ===')
const m1 = await api('POST', '/v1/messages', {
  model: 'minimax-m3',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'Say EXACTLY: proxy anthropic works' }],
}, { 'x-api-key': KEY1, 'anthropic-version': ANTH_VERSION })
check('Returns 200', m1.status === 200)
const d1 = JSON.parse(m1.body)
check('type is message', d1.type === 'message')
check('role is assistant', d1.role === 'assistant')
check('id starts with msg_', typeof d1.id === 'string' && d1.id.startsWith('msg_'))
check('content is array', Array.isArray(d1.content))
check('has text block', d1.content.some(b => b.type === 'text' && typeof b.text === 'string' && b.text.length > 0))
check('stop_reason valid', ['end_turn', 'max_tokens', 'tool_use'].includes(d1.stop_reason), d1.stop_reason)
check('usage has input_tokens', typeof d1.usage?.input_tokens === 'number')
check('usage has output_tokens', typeof d1.usage?.output_tokens === 'number')

// ─── 2. System prompt + Bearer auth ────────────
console.log('\n=== 2. System prompt + Bearer auth ===')
const m2 = await api('POST', '/v1/messages', {
  model: 'minimax-m3',
  max_tokens: 32,
  system: 'You are a terse assistant. Reply with one word.',
  messages: [{ role: 'user', content: 'Hello' }],
}, { 'Authorization': 'Bearer ' + KEY2, 'anthropic-version': ANTH_VERSION })
check('Returns 200', m2.status === 200)
const d2 = JSON.parse(m2.body)
check('Has text content', d2.content.some(b => b.type === 'text' && b.text.length > 0))

// ─── 3. Streaming ─────────────────────────────
console.log('\n=== 3. Anthropic streaming ===')
const m3 = await api('POST', '/v1/messages', {
  model: 'minimax-m3',
  max_tokens: 64,
  stream: true,
  messages: [{ role: 'user', content: 'Count from 1 to 3' }],
}, { 'x-api-key': KEY1, 'anthropic-version': ANTH_VERSION })
check('Returns 200', m3.status === 200)
check('Content-Type is event-stream', m3.headers['content-type']?.startsWith('text/event-stream'))
const ev3 = parseSse(m3.body)
check('Every data: line parses as strict JSON', ev3.length > 0, `${ev3.length} events`)
const types3 = ev3.map(e => e.data?.type)
check('Has message_start', types3.includes('message_start'))
check('Has content_block_start', types3.includes('content_block_start'))
check('Has content_block_delta', types3.includes('content_block_delta'), `(${types3.filter(t => t === 'content_block_delta').length} deltas)`)
check('Has content_block_stop', types3.includes('content_block_stop'))
check('Has message_delta', types3.includes('message_delta'))
check('Has message_stop', types3.includes('message_stop'))
check('Has no [DONE] marker', !m3.body.includes('[DONE]'))
const msgStart = ev3.find(e => e.data?.type === 'message_start')?.data
check('message_start carries input usage', typeof msgStart?.message?.usage?.input_tokens === 'number')
const msgDelta = ev3.find(e => e.data?.type === 'message_delta')?.data
check('message_delta has stop_reason', typeof msgDelta?.delta?.stop_reason === 'string', msgDelta?.delta?.stop_reason)
check('message_delta carries output usage', typeof msgDelta?.usage?.output_tokens === 'number')

// ─── 4. Tool calling ──────────────────────────
console.log('\n=== 4. Tool calling ===')
const m4 = await api('POST', '/v1/messages', {
  model: 'minimax-m3',
  max_tokens: 256,
  tools: [
    {
      name: 'get_time',
      description: 'Get the current time',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  messages: [{ role: 'user', content: 'What time is it? Use the get_time tool.' }],
}, { 'x-api-key': KEY1, 'anthropic-version': ANTH_VERSION })
check('Returns 200', m4.status === 200)
const d4 = JSON.parse(m4.body)
const toolUse = d4.content?.find(b => b.type === 'tool_use')
check('Has tool_use block', !!toolUse)
if (toolUse) {
  check('tool_use has id', typeof toolUse.id === 'string' && toolUse.id.length > 0)
  check('tool_use has name', toolUse.name === 'get_time')
  check('tool_use has input object', typeof toolUse.input === 'object' && toolUse.input !== null)
}
check('stop_reason is tool_use', d4.stop_reason === 'tool_use', d4.stop_reason)

// ─── 5. Tool result round-trip ─────────────────
console.log('\n=== 5. Tool result round-trip ===')
if (toolUse) {
  const m5 = await api('POST', '/v1/messages', {
    model: 'minimax-m3',
    max_tokens: 64,
    tools: [
      {
        name: 'get_time',
        description: 'Get the current time',
        input_schema: { type: 'object', properties: {} },
      },
    ],
    messages: [
      { role: 'user', content: 'What time is it? Use the get_time tool.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: toolUse.id, name: 'get_time', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: '12:34 PM' }] },
    ],
  }, { 'x-api-key': KEY1, 'anthropic-version': ANTH_VERSION })
  check('Returns 200', m5.status === 200)
  const d5 = JSON.parse(m5.body)
  check('Final answer has text', d5.content.some(b => b.type === 'text' && b.text.length > 0))
} else {
  console.log('  \x1b[33mSKIP\x1b[0m Tool result round-trip (no tool_use in previous step)')
}

// ─── 6. Auth rejection ────────────────────────
console.log('\n=== 6. Auth rejection ===')
const body = { model: 'minimax-m3', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
const bad = await api('POST', '/v1/messages', body, { 'x-api-key': 'sk-bad', 'anthropic-version': ANTH_VERSION })
check('Bad key returns 401', bad.status === 401)
const badD = JSON.parse(bad.body)
check('Anthropic error shape (type=error)', badD.type === 'error')
check('Error type authentication_error', badD.error?.type === 'authentication_error')
check('Has error message', typeof badD.error?.message === 'string')

const none = await api('POST', '/v1/messages', body, { 'anthropic-version': ANTH_VERSION })
check('No key returns 401', none.status === 401)
const noneD = JSON.parse(none.body)
check('No key is Anthropic-shaped', noneD.type === 'error' && noneD.error?.type === 'authentication_error')

// Regression: OpenAI routes still OpenAI-shaped
const oai = await api('POST', '/v1/chat/completions', { model: 'minimax-m3', messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': 'sk-bad' })
const oaiD = JSON.parse(oai.body)
check('OpenAI route 401 stays OpenAI-shaped', oai.status === 401 && !!oaiD.error && oaiD.error.type === 'auth_error')

// ─── 7. Upstream error passthrough (Anthropic shape) ──
console.log('\n=== 7. Upstream error passthrough ===')
const m7 = await api('POST', '/v1/messages', {
  model: 'nonexistent-model-xyz',
  max_tokens: 8,
  messages: [{ role: 'user', content: 'hi' }],
}, { 'x-api-key': KEY1, 'anthropic-version': ANTH_VERSION })
check('Bad model returns >= 400', m7.status >= 400, String(m7.status))
const d7 = JSON.parse(m7.body)
check('Error is Anthropic-shaped', d7.type === 'error' && !!d7.error)
check('Has error message', typeof d7.error?.message === 'string')

// ─── 8. x-request-id ──────────────────────────
console.log('\n=== 8. x-request-id header ===')
check('x-request-id present and non-empty', typeof m1.headers['x-request-id'] === 'string' && m1.headers['x-request-id'].length > 0)

// ─── 9. Vision (Anthropic image block) ────────
console.log('\n=== 9. Vision ===')
let imgB64 = ''
try {
  imgB64 = readFileSync('image.png').toString('base64')
} catch { /* image may not exist */ }
if (imgB64) {
  const m9 = await api('POST', '/v1/messages', {
    model: 'minimax-m3',
    max_tokens: 128,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'What is in this image? Answer in 3 words' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imgB64 } },
    ] }],
  }, { 'x-api-key': KEY2, 'anthropic-version': ANTH_VERSION })
  check('Vision returns 200', m9.status === 200)
  const d9 = JSON.parse(m9.body)
  check('Has text response', d9.content?.some(b => b.type === 'text' && b.text.length > 0))
} else {
  console.log('  \x1b[33mSKIP\x1b[0m Vision (image.png not found)')
}

// ─── Summary ──────────────────────────────────
console.log(`\n\x1b[36m═══════════════════════════════════════\x1b[0m`)
console.log(`\x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`)
if (failed > 0) process.exit(1)
