import { describe, it, expect } from 'vitest'
import worker from '../src/index.js'
import { MAX_MARKDOWN_CHARS } from '../src/api/schema.js'

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://prose-agent.test/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function call(request: Request): Promise<{ status: number; body: any }> {
  const res = await worker.fetch(request)
  const text = await res.text()
  const isJson = res.headers.get('content-type')?.includes('application/json')
  return { status: res.status, body: isJson ? JSON.parse(text) : text }
}

describe('routes', () => {
  it('GET /health returns the ok envelope', async () => {
    const r = await call(new Request('https://prose-agent.test/health'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, status: 'ok' })
  })

  it('GET /checks lists the catalog and the offset unit', async () => {
    const r = await call(new Request('https://prose-agent.test/checks'))
    expect(r.body.ok).toBe(true)
    expect(Array.isArray(r.body.checks)).toBe(true)
    expect(r.body.checks.length).toBeGreaterThan(10)
    expect(r.body.offsetUnit).toBe('utf-16')
  })

  it('GET / returns plain-text usage', async () => {
    const res = await worker.fetch(new Request('https://prose-agent.test/'))
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toContain('POST /analyze')
  })

  it('POST /analyze returns a verdict and issues', async () => {
    const r = await call(post({ markdown: 'We utilize the tool.', options: { targetGrade: 20 } }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.verdict.clean).toBe(false)
    expect(r.body.issues.some((i: { category: string }) => i.category === 'inflatedVocabulary')).toBe(true)
  })

  it('rejects a missing markdown field with a client-blamed 400', async () => {
    const r = await call(post({ options: {} }))
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ ok: false, error: { blame: 'client' } })
  })

  it('rejects invalid JSON with 400', async () => {
    const r = await call(post('{ not json'))
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
  })

  it('rejects oversized markdown', async () => {
    const r = await call(post({ markdown: 'x'.repeat(MAX_MARKDOWN_CHARS + 1) }))
    expect(r.status).toBe(400)
    expect(r.body.error.message).toContain('at most')
  })

  it('rejects a declared oversized body with 413 before parsing', async () => {
    const r = await call(post({ markdown: 'hi' }, { 'content-length': String(MAX_MARKDOWN_CHARS * 4 + 1) }))
    expect(r.status).toBe(413)
  })

  it('maps pathologically deep nesting to a client-blamed 400, not a 500', async () => {
    const r = await call(post({ markdown: '>'.repeat(5000) + ' hi\n' }))
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ ok: false, error: { blame: 'client' } })
  })

  it('rejects GET on /analyze with 405', async () => {
    const r = await call(new Request('https://prose-agent.test/analyze'))
    expect(r.status).toBe(405)
  })

  it('returns 404 for an unknown route', async () => {
    const r = await call(new Request('https://prose-agent.test/nope'))
    expect(r.status).toBe(404)
  })
})
