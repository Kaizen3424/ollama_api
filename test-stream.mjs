// Unit tests for the SSE line splitter + pipeStream corruption hardening.
// Run after build:  node test-stream.mjs
import { Readable } from 'node:stream'
import { createSseLineSplitter, pipeStream } from './dist/proxy/stream-handler.js'

let passed = 0
let failed = 0

function check(name, ok, detail) {
  const status = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${status} ${name}${detail ? ': ' + detail : ''}`)
  if (ok) passed++; else failed++
}

class FakeRes {
  constructor() {
    this._chunks = []
    this.destroyed = false
    this.writableEnded = false
    this.status = 0
    this.headers = {}
  }
  writeHead(status, headers) {
    this.status = status
    Object.assign(this.headers, headers)
  }
  write(chunk) {
    if (this.destroyed || this.writableEnded) return false
    this._chunks.push(String(chunk))
    return true
  }
  end() {
    if (!this.writableEnded) this.writableEnded = true
  }
  get body() {
    return this._chunks.join('')
  }
}

// Strict SSE consumer: every data: line must parse as JSON (except [DONE]).
function parseSseStrict(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const jsonStr = line.slice(5).trim()
    if (jsonStr === '[DONE]' || jsonStr === '') continue
    events.push(JSON.parse(jsonStr))
  }
  return events
}

async function pipe(chunks, opts = {}) {
  const res = new FakeRes()
  await pipeStream(Readable.from(chunks), res, opts)
  return res
}

// ─── Splitter: event chopped mid-JSON across chunks (the reported bug) ─
console.log('\n=== Line splitter: chunk boundaries inside SSE lines ===')
{
  const event = {
    id: 'chatcmpl-1', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'question', arguments: '{"q":1}' } }] } }],
  }
  const full = 'data: ' + JSON.stringify(event)
  const cut = Math.floor(full.length * 0.7)
  const s = createSseLineSplitter()
  const l1 = s.push(full.slice(0, cut))
  check('No complete line until newline arrives', l1.length === 0)
  const l2 = s.push(full.slice(cut) + '\n\ndata: [DONE]\n\n')
  check('Split event reassembled into one line', l2.length === 4 && l2[0] === full)
  check('Empty separator line preserved', l2[1] === '')
  check('DONE line preserved', l2[2] === 'data: [DONE]')
  check('Buffer empty at end', s.flush() === undefined)
}

console.log('\n=== Line splitter: multiple events in one chunk ===')
{
  const s = createSseLineSplitter()
  const lines = s.push('data: {"a":1}\n\ndata: {"b":2}\n\n')
  check('Both events extracted', lines.length === 4)
  check('First event intact', lines[0] === 'data: {"a":1}')
  check('Second event intact', lines[2] === 'data: {"b":2}')
}

console.log('\n=== Line splitter: CRLF normalization + trailing partial ===')
{
  const s = createSseLineSplitter()
  const lines = s.push('data: {"a":1}\r\ndata: {"b')
  check('CR stripped', lines.length === 1 && lines[0] === 'data: {"a":1}')
  const partial = s.flush()
  check('Trailing partial line reported by flush', partial === 'data: {"b')
}

console.log('\n=== Line splitter: empty chunk is a no-op ===')
{
  const s = createSseLineSplitter()
  const lines = s.push('')
  check('No lines from empty chunk', lines.length === 0)
}

// ─── pipeStream: byte-faithful reassembly of split events ─
console.log('\n=== pipeStream: split event (old code corrupted this) ===')
{
  const event = {
    id: 'chatcmpl-1', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'question', arguments: '{"q":1}' } }] } }],
  }
  const line = 'data: ' + JSON.stringify(event)
  const cut = Math.floor(line.length * 0.6)
  const upstream = [line.slice(0, cut), line.slice(cut) + '\n\n', 'data: [DONE]\n\n']
  const res = await pipe(upstream)
  const input = upstream.join('')
  check('Output byte-identical to upstream bytes', res.body === input)
  const parsed = parseSseStrict(res.body)
  check('Every data: line parses as strict JSON', parsed.length === 1)
  check('Content intact after reassembly', parsed[0]?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments === '{"q":1}')
}

console.log('\n=== pipeStream: continuation chunk does not start with data: ===')
{
  const line = 'data: ' + JSON.stringify({ a: 'xy' })
  const upstream = [line.slice(0, 9), line.slice(9) + '\n\n', 'data: [DONE]\n\n']
  const res = await pipe(upstream)
  check('Byte-identical output', res.body === upstream.join(''))
  const events = parseSseStrict(res.body)
  check('Reassembled JSON parses', events[0]?.a === 'xy')
}

console.log('\n=== pipeStream: usage tracking on complete lines ===')
{
  const chunks = [
    'data: {"id":"1","choices":[]}\n\n',
    'data: {"id":"2","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    'data: [DONE]\n\n',
  ]
  const usages = []
  const res = await pipe(chunks, { onUsage: (u) => { usages.push(u) } })
  check('Usage callback fired exactly once', usages.length === 1)
  check('Usage values correct', usages[0]?.total_tokens === 15)
  check('Body byte-identical', res.body === chunks.join(''))
}

console.log('\n=== pipeStream: mid-stream upstream failure emits error event ===')
{
  const upstream = new Readable({
    read() {
      this.push('data: {"id":"1","choices":[]}\n\n')
      this.push('data: {"id":"2","choices":[{"delta":{"content":"par')
      this.destroy(new Error('upstream connection reset'))
    },
  })
  const res = new FakeRes()
  await pipeStream(upstream, res)
  check('No partial line in output', !res.body.includes('"par'))
  const events = parseSseStrict(res.body)
  check('Error event emitted', events.length === 2 && events[1]?.error?.type === 'proxy_error')
  check('Error message preserved', events[1]?.error?.message === 'upstream connection reset')
  check('Stream terminated with [DONE]', res.body.trimEnd().endsWith('data: [DONE]'))
}

console.log('\n=== pipeStream: client abort -> clean end, no error event ===')
{
  const controller = new AbortController()
  controller.abort()
  const res = await pipe(['data: {"a":1}\n\n'], { signal: controller.signal })
  check('Nothing emitted when already aborted', res.body === '')
  check('No error event', !res.body.includes('"error"'))
  check('Response ended', res.writableEnded)
}

console.log('\n=== pipeStream: CRLF upstream stays valid SSE ===')
{
  const res = await pipe(['data: {"a":1}\r\n', 'data: {"b":2}\r\n', 'data: [DONE]\r\n'])
  const events = parseSseStrict(res.body)
  check('CRLF lines parse as strict JSON', events.length === 2)
  check('Normalized to LF', res.body === 'data: {"a":1}\ndata: {"b":2}\ndata: [DONE]\n')
}

console.log(`\n${'='.repeat(46)}\nPassed: ${passed}  Failed: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
