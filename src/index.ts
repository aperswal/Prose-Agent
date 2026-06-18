import { analyze } from './engine/analyze.js'
import { InputTooComplexError } from './engine/markdown.js'
import { CATALOG } from './engine/registry.js'
import { MAX_MARKDOWN_CHARS, analyzeRequestSchema } from './api/schema.js'
import { handleMcp } from './api/mcp.js'

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

interface Env {
  RATE_LIMITER?: RateLimiter
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extraHeaders },
  })
}

function ok(data: Record<string, unknown>, status = 200): Response {
  return json({ ok: true, ...data }, status)
}

function fail(blame: 'client' | 'server', message: string, status: number): Response {
  return json({ ok: false, error: { blame, message } }, status)
}

async function rateLimited(request: Request, env: Env): Promise<Response | null> {
  const limiter = env.RATE_LIMITER
  if (!limiter) return null
  const key = request.headers.get('cf-connecting-ip') ?? 'anonymous'
  try {
    const { success } = await limiter.limit({ key })
    if (success) return null
  } catch {
    return null
  }
  return json({ ok: false, error: { blame: 'client', message: 'rate limit exceeded, retry in a moment' } }, 429, {
    'retry-after': '60',
  })
}

const USAGE = `Prose-Agent

Deterministic markdown readability and prose-quality checks for coding agents.
Send a draft, read the issues, rewrite, send again, until the verdict is clean.

POST /mcp       MCP server (Streamable HTTP, stateless): initialize, tools/list, tools/call -> analyze_prose
POST /analyze   body: { "markdown": "...", "options"?: { targetGrade, includeText, minSeverity, limit, offset } }
GET  /checks    the full catalog of checks
GET  /health    liveness
GET  /          this message

Offsets are UTF-16 code units into the markdown you sent: markdown.slice(span.start, span.end) === excerpt.
Apply edits within one response from the highest span.start down, then send again.
Max markdown length: ${MAX_MARKDOWN_CHARS} characters. Requests are rate limited per client IP.
`

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'POST') {
      const limit = await rateLimited(request, env)
      if (limit) return limit
    }

    if (path === '/mcp') return handleMcp(request)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    if (request.method === 'GET' && path === '/') {
      return new Response(USAGE, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } })
    }
    if (request.method === 'GET' && path === '/health') {
      return ok({ status: 'ok' })
    }
    if (request.method === 'GET' && path === '/checks') {
      return ok({ checks: CATALOG, maxMarkdownChars: MAX_MARKDOWN_CHARS, offsetUnit: 'utf-16' })
    }
    if (path === '/analyze') {
      if (request.method !== 'POST') return fail('client', 'use POST for /analyze', 405)

      const declaredLength = Number(request.headers.get('content-length') ?? '0')
      if (declaredLength > MAX_MARKDOWN_CHARS * 4) {
        return fail('client', `request body exceeds the ${MAX_MARKDOWN_CHARS} character limit`, 413)
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return fail('client', 'request body must be valid JSON', 400)
      }

      const parsed = analyzeRequestSchema.safeParse(body)
      if (!parsed.success) {
        const first = parsed.error.issues[0]
        const where = first && first.path.length > 0 ? first.path.join('.') : 'body'
        return fail('client', first ? `${where}: ${first.message}` : 'invalid request', 400)
      }

      try {
        const result = analyze(parsed.data.markdown, parsed.data.options ?? {})
        return ok(result as unknown as Record<string, unknown>)
      } catch (error) {
        if (error instanceof InputTooComplexError) return fail('client', error.message, 400)
        return fail('server', 'analysis failed', 500)
      }
    }

    return fail('client', `no route for ${request.method} ${path}`, 404)
  },
}
