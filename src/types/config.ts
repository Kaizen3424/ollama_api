export interface AppConfig {
  port: number
  host: string
  upstreamBase: string
  proxyApiKeys: string[]
  keys: string[]
  keyCooldownMs: number
  maxRetries: number
  keyTokenLimit5h: number
  keyTokenLimitWeek: number
  usageFlushMs: number
  mongodbUri: string
  mongodbDatabase: string
}
