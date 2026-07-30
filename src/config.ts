import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './types/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadKeys(): string[] {
  const keysPath = resolve(__dirname, '..', 'ollama_keys.txt')
  if (!existsSync(keysPath)) {
    console.warn('WARN: ollama_keys.txt not found, using empty key pool')
    return []
  }
  const content = readFileSync(keysPath, 'utf-8')
  const keys: string[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^\d+:\s*(.+)$/)
    if (match) {
      keys.push(match[1].trim())
    } else {
      keys.push(trimmed)
    }
  }
  return keys
}

function loadProxyKeys(): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PROXY_API_KEY') && value?.trim()) {
      keys.push(value.trim())
    }
  }
  return keys
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    host: process.env.HOST ?? '0.0.0.0',
    upstreamBase: (process.env.UPSTREAM_BASE ?? 'https://ollama.com').replace(/\/+$/, ''),
    proxyApiKeys: loadProxyKeys(),
    keys: loadKeys(),
    keyCooldownMs: parseInt(process.env.KEY_COOLDOWN_MS ?? '60000', 10),
    maxRetries: parseInt(process.env.MAX_KEY_RETRIES ?? '3', 10),
    keyTokenLimit5h: parseInt(process.env.KEY_TOKEN_LIMIT_5H ?? '2000000', 10),
    keyTokenLimitWeek: parseInt(process.env.KEY_TOKEN_LIMIT_WEEK ?? '5000000', 10),
    usageFlushMs: parseInt(process.env.USAGE_FLUSH_MS ?? '60000', 10),
    mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
    mongodbDatabase: process.env.MONGODB_DATABASE ?? 'ollama_proxy',
  }
}
