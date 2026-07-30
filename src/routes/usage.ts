import type { FastifyInstance } from 'fastify'
import type { UsageTracker } from '../usage-tracker.js'

export function registerUsage(app: FastifyInstance, tracker?: UsageTracker) {
  app.get('/v1/usage', async (_req, reply) => {
    if (!tracker) {
      return reply.code(503).send({
        error: {
          message: 'Usage tracking is not available (MongoDB not connected)',
          type: 'service_unavailable',
          code: '503',
        },
      })
    }
    const docs = await tracker.getProxyUsage()

    const total = docs.reduce(
      (acc, d) => ({
        total_prompt_tokens: acc.total_prompt_tokens + d.total_prompt_tokens,
        total_completion_tokens: acc.total_completion_tokens + d.total_completion_tokens,
        total_tokens: acc.total_tokens + d.total_tokens,
      }),
      { total_prompt_tokens: 0, total_completion_tokens: 0, total_tokens: 0 },
    )

    return reply.code(200).send({
      object: 'list',
      total,
      proxy_keys: docs.map(d => ({
        key: d._id,
        label: d.label,
        total_prompt_tokens: d.total_prompt_tokens,
        total_completion_tokens: d.total_completion_tokens,
        total_tokens: d.total_tokens,
        last_updated: d.last_updated,
      })),
    })
  })
}
