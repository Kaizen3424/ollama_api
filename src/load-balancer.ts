let index = 0
const cooldowns = new Map<number, number>()

export function createLoadBalancer(
  keys: string[],
  cooldownMs: number,
) {
  function markKeyFailed(idx: number): void {
    cooldowns.set(idx, Date.now() + cooldownMs)
  }

  async function getNextKey(
    isAvailable?: (index: number) => boolean | Promise<boolean>,
  ): Promise<{ key: string; index: number } | null> {
    if (keys.length === 0) return null

    const start = index
    for (let i = 0; i < keys.length; i++) {
      const idx = index % keys.length
      index = (idx + 1) % keys.length

      const cooldownUntil = cooldowns.get(idx)
      if (cooldownUntil && Date.now() < cooldownUntil) continue

      if (isAvailable && !(await isAvailable(idx))) continue

      return { key: keys[idx], index: idx }
    }

    index = 0
    cooldowns.clear()
    return keys.length > 0 ? { key: keys[0], index: 0 } : null
  }

  function getKeyAt(idx: number): string | null {
    if (idx < 0 || idx >= keys.length) return null
    return keys[idx]
  }

  function getKeyCount(): number {
    return keys.length
  }

  function reset(): void {
    index = 0
    cooldowns.clear()
  }

  return { getNextKey, getKeyAt, getKeyCount, reset, markKeyFailed }
}

export type LoadBalancer = ReturnType<typeof createLoadBalancer>
