import { analyze } from '../engine/analyze.js'
import { InputTooComplexError } from '../engine/markdown.js'
import { analyzeRequestSchema, MAX_MARKDOWN_CHARS } from './schema.js'

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const PREFERRED_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'prose-agent', version: '0.1.0', title: 'Prose-Agent' }

const TOOL = {
  name: 'analyze_prose',
  title: 'Analyze prose',
  description:
    'Analyze a markdown document for readability and prose quality, deterministically (no model). Returns a verdict (clean or not, reading grade, the worklist), and a list of issues. Each issue has a category, the offending text, a UTF-16 character span where markdown.slice(start,end) equals the excerpt, a plain-word replacement when one exists, and an edit target. Loop on this tool: if verdict.clean is false, apply the edits from the highest span.start down, then call again, until clean is true.',
  inputSchema: {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: 'The markdown document to analyze.' },
      targetGrade: {
        type: 'number',
        minimum: 1,
        maximum: 30,
        description: 'Reading grade the document should hit. Default 8.',
      },
      minSeverity: {
        type: 'string',
        enum: ['info', 'warning', 'error'],
        description: 'Only return issues at or above this severity. Default info.',
      },
      limit: { type: 'number', description: 'Maximum issues to return (1 to 1000). Default 200.' },
      offset: { type: 'number', description: 'Issue pagination offset. Default 0.' },
      includeText: { type: 'boolean', description: 'Include each block raw text in the response. Default false.' },
    },
    required: ['markdown'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'object', description: 'clean flag, grade, counts, hardestBlock, and fixFirst worklist.' },
      document: { type: 'object', description: 'Whole-document metrics and counts by category.' },
      blocks: { type: 'array', description: 'Per-block metrics, grade, and issue ids.' },
      issues: { type: 'array', description: 'Flat, position-sorted issues with spans, replacements, and edit targets.' },
    },
  },
}

interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent?: unknown
  isError: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function rpcResult(id: unknown, result: unknown): object {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: unknown, code: number, message: string): object {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function initializeResult(params: unknown): object {
  const requested = asRecord(params).protocolVersion
  const protocolVersion =
    typeof requested === 'string' && SUPPORTED_VERSIONS.includes(requested) ? requested : PREFERRED_VERSION
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions:
      'Call analyze_prose with a markdown document. Read verdict.clean: if it is false, fix the issues (each carries a span, a replacement when available, and an editTarget) and call again. Repeat until clean is true. Apply edits within one response from the highest span.start down so earlier offsets stay valid. Offsets are UTF-16 code units into the markdown you sent.',
  }
}

function callTool(params: unknown): ToolResult {
  const p = asRecord(params)
  if (p.name !== TOOL.name) return errorResult(`Unknown tool: ${String(p.name)}`)

  const args = asRecord(p.arguments)
  const options: Record<string, unknown> = {}
  for (const key of ['targetGrade', 'minSeverity', 'limit', 'offset', 'includeText'] as const) {
    if (args[key] !== undefined) options[key] = args[key]
  }
  const reshaped = { markdown: args.markdown, ...(Object.keys(options).length > 0 ? { options } : {}) }

  const parsed = analyzeRequestSchema.safeParse(reshaped)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first && first.path.length > 0 ? first.path.join('.') : 'arguments'
    return errorResult(first ? `${where}: ${first.message}` : 'invalid arguments')
  }

  try {
    const result = analyze(parsed.data.markdown, parsed.data.options ?? {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    }
  } catch (error) {
    return errorResult(error instanceof InputTooComplexError ? error.message : 'analysis failed')
  }
}

function handleMessage(msg: Record<string, unknown>): object | null {
  const method = msg.method
  const id = 'id' in msg ? msg.id : null
  if (typeof method !== 'string') return rpcError(id, -32600, 'Invalid Request')
  if (method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize':
      return rpcResult(id, initializeResult(msg.params))
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: [TOOL] })
    case 'tools/call':
      return rpcResult(id, callTool(msg.params))
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

const MCP_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, authorization',
  'access-control-expose-headers': 'mcp-session-id',
}

function mcpJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...MCP_CORS },
  })
}

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: MCP_CORS })
  if (request.method !== 'POST') {
    return mcpJson(rpcError(null, -32000, 'This MCP endpoint is stateless and only accepts POST.'), 405)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_MARKDOWN_CHARS * 4) {
    return mcpJson(rpcError(null, -32600, 'request body too large'), 413)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return mcpJson(rpcError(null, -32700, 'Parse error'), 400)
  }

  const messages = Array.isArray(payload) ? payload : [payload]
  const responses: object[] = []
  for (const raw of messages) {
    const msg = asRecord(raw)
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      responses.push(rpcError(msg.id ?? null, -32600, 'Invalid Request'))
      continue
    }
    const response = handleMessage(msg)
    if (response !== null) responses.push(response)
  }

  if (responses.length === 0) return new Response(null, { status: 202, headers: MCP_CORS })
  return mcpJson(Array.isArray(payload) ? responses : responses[0])
}
