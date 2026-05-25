import { parse as parseYaml } from 'yaml'

export interface GeneratedFile {
  relativePath: string
  content: string
}

export interface ImportResult {
  files: GeneratedFile[]
  count: number
  warnings: string[]
}

export function parseSpec(raw: string): unknown {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }
  return parseYaml(trimmed)
}

export function generateMocks(spec: unknown): ImportResult {
  const s = spec as Record<string, unknown>
  const files: GeneratedFile[] = []
  const warnings: string[] = []

  const resolved = resolveRefs(s, s) as Record<string, unknown>
  const paths = (resolved.paths ?? {}) as Record<string, unknown>

  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

  for (const [apiPath, pathItem] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = (pathItem as Record<string, unknown>)?.[method] as Record<string, unknown> | undefined
      if (!operation) continue

      const expressPath = convertPath(apiPath)
      const tags = operation.tags as string[] | undefined
      const folder = toFolderName(tags, apiPath)
      const fileName = toFileName(method, apiPath)
      const relativePath = `${folder}/${fileName}`

      const description =
        (operation.summary as string | undefined) ??
        (operation.description as string | undefined) ??
        `${method.toUpperCase()} ${apiPath}`

      const features = analyzeOperation(operation)
      files.push({
        relativePath,
        content: generateMockSource(method.toUpperCase(), expressPath, description, features),
      })
    }
  }

  if (files.length === 0) {
    warnings.push('No routes found in spec — make sure the spec has a "paths" object.')
  }

  return { files, count: files.length, warnings }
}

// ─── Operation analysis ───────────────────────────────────────────────────────

interface ErrorResponseDef {
  status: number
  description: string
}

interface OperationFeatures {
  isSSE: boolean
  requiredBodyFields: string[]
  errorResponses: ErrorResponseDef[]
  successValue: unknown
  successStatus: number
}

function analyzeOperation(operation: Record<string, unknown>): OperationFeatures {
  const responses = (operation.responses ?? {}) as Record<string, unknown>

  // SSE: any response with text/event-stream content
  const isSSE = Object.values(responses).some(
    (r) => !!(r as Record<string, unknown>)?.['content'] &&
      !!((r as Record<string, unknown>)['content'] as Record<string, unknown>)?.['text/event-stream'],
  )

  // Request body required fields
  const requestBody = operation.requestBody as Record<string, unknown> | undefined
  const bodyJsonContent = ((requestBody?.content as Record<string, unknown> | undefined)?.['application/json']) as Record<string, unknown> | undefined
  const bodySchema = bodyJsonContent?.schema as Record<string, unknown> | undefined
  const requiredBodyFields: string[] = Array.isArray(bodySchema?.required)
    ? (bodySchema!.required as string[])
    : []

  // Error responses (4xx / 5xx)
  const errorResponses: ErrorResponseDef[] = Object.entries(responses)
    .map(([code, resp]) => ({
      status: Number(code),
      description: ((resp as Record<string, unknown>)?.description as string | undefined) ?? '',
    }))
    .filter((r) => r.status >= 400)
    .sort((a, b) => a.status - b.status)

  // Success value + status
  let successValue: unknown = {}
  let successStatus = 200

  if (isSSE) {
    const sseResp = Object.values(responses).find(
      (r) => !!((r as Record<string, unknown>)?.['content'] as Record<string, unknown> | undefined)?.['text/event-stream'],
    ) as Record<string, unknown> | undefined
    const sseSchema = ((sseResp?.['content'] as Record<string, unknown> | undefined)?.['text/event-stream'] as Record<string, unknown> | undefined)?.schema
    successValue = sseSchema ? schemaToValue(sseSchema) : { type: 'message', id: '1' }
  } else {
    const schema = getResponseSchema(responses)
    successValue = schema ? schemaToValue(schema) : {}
    for (const code of ['200', '201', '202', '204']) {
      if (responses[code]) { successStatus = Number(code); break }
    }
  }

  return { isSSE, requiredBodyFields, errorResponses, successValue, successStatus }
}

// ─── Code generation ──────────────────────────────────────────────────────────

function buildImports(features: OperationFeatures): string {
  const imports = new Set<string>(['defineMock'])

  if (features.isSSE) {
    imports.add('sse')
  } else if (features.successStatus === 204) {
    imports.add('noContent')
  } else {
    imports.add('ok')
  }

  if (features.requiredBodyFields.length > 0) imports.add('error')

  for (const er of features.errorResponses) {
    switch (er.status) {
      case 404: imports.add('notFound'); break
      case 401: imports.add('unauthorized'); break
      case 403: imports.add('forbidden'); break
      case 500: imports.add('serverError'); break
      default:  imports.add('error'); break
    }
  }

  return `import { ${[...imports].join(', ')} } from '@tsandbox/sdk'`
}

function buildHandlerBody(features: OperationFeatures): string {
  const lines: string[] = []

  // Request body validation
  if (features.requiredBodyFields.length > 0) {
    const fieldList = features.requiredBodyFields.map((f) => `'${f}'`).join(', ')
    lines.push(`    const _b = body as Record<string, unknown> | undefined`)
    lines.push(`    const _missing = [${fieldList}].filter(f => !_b || !(f in _b))`)
    lines.push(`    if (_missing.length) return error(\`Missing required fields: \${_missing.join(', ')}\`, 400)`)
    lines.push(``)
  }

  // Multi-response simulation via ?__status=<code>
  if (features.errorResponses.length > 0) {
    lines.push(`    // Simulate error responses: append ?__status=<code> to the request URL`)
    lines.push(`    const __sim = Number(query.__status) || 0`)
    for (const er of features.errorResponses) {
      lines.push(`    if (__sim === ${er.status}) return ${errorHelper(er)}`)
    }
    lines.push(``)
  }

  // Success branch
  if (features.isSSE) {
    const dataJson = JSON.stringify(features.successValue)
    lines.push(`    return sse([`)
    lines.push(`      { event: 'message', data: ${dataJson} },`)
    lines.push(`    ])`)
  } else if (features.successStatus === 204) {
    lines.push(`    return noContent()`)
  } else {
    const valueLines = JSON.stringify(features.successValue, null, 2).split('\n')
    const indented = valueLines.map((l, i) => (i === 0 ? l : '    ' + l)).join('\n')
    lines.push(`    return ok(${indented})`)
  }

  return lines.join('\n')
}

function errorHelper(er: ErrorResponseDef): string {
  const desc = er.description ? `'${er.description.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : undefined
  switch (er.status) {
    case 404: return `notFound(${desc ?? "'Not found'"})`
    case 401: return `unauthorized(${desc ?? "'Unauthorized'"})`
    case 403: return `forbidden(${desc ?? "'Forbidden'"})`
    case 500: return `serverError(${desc ?? "'Internal server error'"})`
    default:  return `error(${desc ?? `'Error'`}, ${er.status})`
  }
}

function generateMockSource(
  method: string,
  apiPath: string,
  description: string,
  features: OperationFeatures,
): string {
  const safeDesc = description.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const importLine = buildImports(features)
  const handlerBody = buildHandlerBody(features)

  return `${importLine}

export default defineMock({
  method: '${method}',
  path: '${apiPath}',
  description: '${safeDesc}',

  async handler({ params, query, body, headers }) {
${handlerBody}
  },
})
`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function convertPath(p: string): string {
  return p.replace(/\{(\w+)\}/g, ':$1')
}

function toFileName(method: string, apiPath: string): string {
  const slug =
    apiPath
      .replace(/[{}]/g, '')
      .replace(/\//g, '-')
      .replace(/^-+/, '')
      .replace(/-+/g, '-')
      .replace(/-$/, '')
      .toLowerCase() || 'index'
  return `${method.toLowerCase()}-${slug}.ts`
}

function toFolderName(tags: string[] | undefined, apiPath: string): string {
  if (tags?.length) {
    return tags[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-$/, '')
  }
  const seg = apiPath.split('/').filter((s) => s && !s.startsWith('{'))[0] ?? 'api'
  return seg.toLowerCase()
}

function getResponseSchema(responses: Record<string, unknown>): unknown {
  for (const code of ['200', '201', '202']) {
    const r = responses[code] as Record<string, unknown> | undefined
    const schema = ((r?.content as Record<string, unknown> | undefined)?.['application/json'] as Record<string, unknown> | undefined)?.schema
    if (schema) return schema
  }
  for (const [code, r] of Object.entries(responses)) {
    if (code.startsWith('2')) {
      const schema = (((r as Record<string, unknown>)?.content as Record<string, unknown> | undefined)?.['application/json'] as Record<string, unknown> | undefined)?.schema
      if (schema) return schema
    }
  }
  return null
}

function schemaToValue(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 5) return null
  const s = schema as Record<string, unknown>

  if (s.example !== undefined) return s.example
  if (s.examples && typeof s.examples === 'object') {
    const first = Object.values(s.examples)[0] as Record<string, unknown> | undefined
    if (first?.value !== undefined) return first.value
  }

  if (Array.isArray(s.allOf) && s.allOf.length) return schemaToValue(s.allOf[0], depth)
  if (Array.isArray(s.oneOf) && s.oneOf.length) return schemaToValue(s.oneOf[0], depth)
  if (Array.isArray(s.anyOf) && s.anyOf.length) return schemaToValue(s.anyOf[0], depth)

  if (s.type === 'object' || s.properties) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries((s.properties as Record<string, unknown>) ?? {})) {
      result[k] = schemaToValue(v, depth + 1)
    }
    return result
  }

  if (s.type === 'array') return [schemaToValue(s.items, depth + 1)]

  switch (s.type as string) {
    case 'string': {
      if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
      const fmt = s.format as string | undefined
      if (fmt === 'date-time') return '2024-01-01T00:00:00Z'
      if (fmt === 'date') return '2024-01-01'
      if (fmt === 'uuid') return '00000000-0000-0000-0000-000000000000'
      if (fmt === 'email') return 'user@example.com'
      if (fmt === 'uri' || fmt === 'url') return 'https://example.com'
      return 'string'
    }
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return null
  }
}

function resolveRefs(obj: unknown, root: unknown, depth = 0): unknown {
  if (depth > 20 || obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((item) => resolveRefs(item, root, depth + 1))

  const record = obj as Record<string, unknown>
  if (typeof record['$ref'] === 'string') {
    const ref = record['$ref']
    if (ref.startsWith('#/')) {
      const parts = ref
        .slice(2)
        .split('/')
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      let current: unknown = root
      for (const part of parts) {
        if (current === null || typeof current !== 'object') return obj
        current = (current as Record<string, unknown>)[part]
      }
      return resolveRefs(current, root, depth + 1)
    }
    return obj
  }

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    result[k] = resolveRefs(v, root, depth + 1)
  }
  return result
}
