import { MongoClient, type Db } from 'mongodb'

const fiveHoursMs = 5 * 60 * 60 * 1000
const oneWeekMs = 7 * 24 * 60 * 60 * 1000

export interface ProxyUsageDoc {
  _id: string
  label: string
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  last_updated: Date
}

export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  const client = new MongoClient(uri)
  await client.connect()
  return client.db(dbName)
}

export function createUsageTracker(db: Db, flushMs: number) {
  const usage = db.collection<ProxyUsageDoc>('token_usage')
  const windows = db.collection('token_windows')

  const ollamaPending: Array<{
    keyIndex: number
    keyLabel: string
    prompt: number
    completion: number
    total: number
    timestamp: number
  }> = []

  const proxyPending: Array<{
    proxyKeyIndex: number
    prompt: number
    completion: number
    total: number
    timestamp: number
  }> = []

  let flushTimer: ReturnType<typeof setInterval> | null = null

  function pushOllamaUsage(
    keyIndex: number,
    keyLabel: string,
    promptTokens: number,
    completionTokens: number,
  ): void {
    const total = promptTokens + completionTokens
    ollamaPending.push({
      keyIndex,
      keyLabel,
      prompt: promptTokens,
      completion: completionTokens,
      total,
      timestamp: Date.now(),
    })
  }

  function pushProxyUsage(
    proxyKeyIndex: number,
    promptTokens: number,
    completionTokens: number,
  ): void {
    const total = promptTokens + completionTokens
    proxyPending.push({
      proxyKeyIndex,
      prompt: promptTokens,
      completion: completionTokens,
      total,
      timestamp: Date.now(),
    })
  }

  async function flush(): Promise<void> {
    const now = Date.now()

    const ollamaSnapshot = ollamaPending.splice(0)
    try {
      for (const entry of ollamaSnapshot) {
        await windows.updateOne(
          { key_index: entry.keyIndex, window: '5h' },
          {
            $inc: { tokens: entry.total },
            $set: { expires_at: new Date(now + fiveHoursMs) },
          },
          { upsert: true },
        )
        await windows.updateOne(
          { key_index: entry.keyIndex, window: '1w' },
          {
            $inc: { tokens: entry.total },
            $set: { expires_at: new Date(now + oneWeekMs) },
          },
          { upsert: true },
        )
      }
    } catch (err) {
      console.error('[flush] Failed to flush Ollama usage, re-queueing', err)
      ollamaPending.push(...ollamaSnapshot)
    }

    const proxySnapshot = proxyPending.splice(0)
    try {
      for (const entry of proxySnapshot) {
        const proxyId = `proxy-${entry.proxyKeyIndex}`
        const label = `proxy-key-${entry.proxyKeyIndex + 1}`
        await usage.updateOne(
          { _id: proxyId },
          {
            $inc: {
              total_prompt_tokens: entry.prompt,
              total_completion_tokens: entry.completion,
              total_tokens: entry.total,
            },
            $set: { label, last_updated: new Date(entry.timestamp) },
          },
          { upsert: true },
        )
      }
    } catch (err) {
      console.error('[flush] Failed to flush proxy usage, re-queueing', err)
      proxyPending.push(...proxySnapshot)
    }
  }

  function startFlush(): void {
    if (flushTimer) return
    flushTimer = setInterval(flush, flushMs)
  }

  async function stopFlush(): Promise<void> {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    await flush()
  }

  async function getProxyUsage(): Promise<ProxyUsageDoc[]> {
    await flush()
    return usage.find({ _id: { $regex: /^proxy-/ } }).sort({ _id: 1 }).toArray()
  }

  async function isKeyOverLimit(
    keyIndex: number,
    limit5h: number,
    limitWeek: number,
  ): Promise<boolean> {
    const now = Date.now()

    const [window5h, window1w] = await Promise.all([
      windows.findOne({
        key_index: keyIndex,
        window: '5h',
        expires_at: { $gt: new Date(now) },
      }),
      windows.findOne({
        key_index: keyIndex,
        window: '1w',
        expires_at: { $gt: new Date(now) },
      }),
    ])

    if (window5h && (window5h.tokens ?? 0) >= limit5h) return true
    if (window1w && (window1w.tokens ?? 0) >= limitWeek) return true

    return false
  }

  startFlush()

  return { pushOllamaUsage, pushProxyUsage, flush, stopFlush, getProxyUsage, isKeyOverLimit }
}

export type UsageTracker = ReturnType<typeof createUsageTracker>
