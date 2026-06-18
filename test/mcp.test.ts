import { describe, it, expect } from 'vitest'
import worker from '../src/index.js'

function rpc(body: unknown): Request {
  return new Request('https://prose-agent.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  })
}

async function send(body: unknown): Promise<{ status: number; json: any }> {
  const res = await worker.fetch(rpc(body))
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

describe('MCP server', () => {
  it('responds to initialize with capabilities and a negotiated protocol version', async () => {
    const r = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })
    expect(r.status).toBe(200)
    expect(r.json.result.protocolVersion).toBe('2025-06-18')
    expect(r.json.result.capabilities.tools).toBeDefined()
    expect(r.json.result.serverInfo.name).toBe('prose-agent')
  })

  it('falls back to the preferred protocol version for an unknown one', async () => {
    const r = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect(r.json.result.protocolVersion).toBe('2025-06-18')
  })

  it('returns 202 with no body for the initialized notification', async () => {
    const res = await worker.fetch(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('lists the analyze_prose tool with an input schema', async () => {
    const r = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = r.json.result.tools
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('analyze_prose')
    expect(tools[0].inputSchema.required).toContain('markdown')
  })

  it('runs the tool and returns the analysis as content plus structuredContent', async () => {
    const r = await send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'analyze_prose', arguments: { markdown: 'We utilize the tool.', targetGrade: 20 } },
    })
    expect(r.json.result.isError).toBe(false)
    const parsed = JSON.parse(r.json.result.content[0].text)
    expect(parsed.verdict.clean).toBe(false)
    expect(r.json.result.structuredContent.issues.some((i: { category: string }) => i.category === 'inflatedVocabulary')).toBe(
      true,
    )
  })

  it('reports a tool error (not a protocol error) for bad arguments', async () => {
    const r = await send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'analyze_prose', arguments: {} },
    })
    expect(r.json.error).toBeUndefined()
    expect(r.json.result.isError).toBe(true)
  })

  it('returns a JSON-RPC method-not-found for an unknown method', async () => {
    const r = await send({ jsonrpc: '2.0', id: 5, method: 'does/not/exist' })
    expect(r.json.error.code).toBe(-32601)
  })

  it('rejects non-POST with 405', async () => {
    const res = await worker.fetch(new Request('https://prose-agent.test/mcp'))
    expect(res.status).toBe(405)
  })
})

describe('rate limiting', () => {
  const denyEnv = { RATE_LIMITER: { limit: async () => ({ success: false }) } }
  const allowEnv = { RATE_LIMITER: { limit: async () => ({ success: true }) } }

  it('returns 429 with retry-after when the limiter denies a POST', async () => {
    const res = await worker.fetch(
      new Request('https://prose-agent.test/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
        body: JSON.stringify({ markdown: 'hi' }),
      }),
      denyEnv,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
  })

  it('rate limits MCP tool calls too', async () => {
    const res = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), denyEnv)
    expect(res.status).toBe(429)
  })

  it('does not rate limit GET health checks', async () => {
    const res = await worker.fetch(new Request('https://prose-agent.test/health'), denyEnv)
    expect(res.status).toBe(200)
  })

  it('passes through when the limiter allows', async () => {
    const res = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), allowEnv)
    expect(res.status).toBe(200)
  })
})
