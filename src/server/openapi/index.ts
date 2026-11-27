/**
 * Shared OpenAPI integration helpers for the external-AI capability surface.
 *
 * The root app stays a plain `Hono` instance: `describeRoute` only attaches
 * metadata (it calls `next()` and changes nothing), and the document is built
 * once with `generateSpecs` after every route is mounted. The AI tool manifest
 * is then *derived* from that document by filtering on `AI_SAFE_TAG` — there is
 * no second, hand-maintained list of tools or descriptions.
 *
 * The validation hook and the request guard below are the two adapters ADR-025
 * requires: `hono-openapi`'s `validator()` answers 400 directly with a
 * library-specific body, and it has no media-type gate of its own. Both are
 * defined once here so no route has to restate either rule.
 */
import { APP_VERSION } from '@rtwiki/shared/constants'
import type { Context, MiddlewareHandler } from 'hono'
import type { DescribeRouteOptions } from 'hono-openapi'
import { readJson } from '../utils/read-json.js'

/** The one tag that marks an operation as safe to expose to external AI tools. */
export const AI_SAFE_TAG = 'ai-safe' as const

/**
 * The multipart request body shared by every file-upload AI tool.
 *
 * Both `POST /api/attachments` and `POST /api/import` accept the same envelope:
 * one required binary `file` field. Defining it once here means the manifest
 * derived from the OpenAPI document can tell a caller how to build the request,
 * and the two routes cannot drift apart. Typed through `DescribeRouteOptions`
 * so the literal schema values are checked against hono-openapi's own types.
 */
export const MULTIPART_FILE_REQUEST_BODY: DescribeRouteOptions['requestBody'] = {
  required: true,
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'The file to upload.'
          }
        },
        required: ['file']
      }
    }
  }
}

/** OpenAPI document metadata. Defined once; the cached spec is built from it. */
export const OPENAPI_DOCUMENTATION = {
  openapi: '3.1.0',
  info: {
    title: 'RTWiki API',
    version: APP_VERSION,
    description:
      'RTWiki local API. Operations tagged ai-safe are exposed to external AI tools; every other operation is deliberately absent.'
  }
} as const

/**
 * The shape `validator()` passes to its hook. Kept structural rather than
 * importing a transitive package's `Hook` type, so the dependency stays private
 * to `hono-openapi`.
 */
type ValidationResult =
  | { success: true; data: unknown; target: string }
  | { success: false; error: readonly { message?: string }[]; data: unknown; target: string }

/**
 * Rewrites the library's raw 400 body into RTWiki's `{error: string}` shape.
 * `validator()` returns this response directly, so the app's `onError` never
 * sees it — the hook is the only place the rewrite can happen.
 */
export function rtwikiValidationHook(result: ValidationResult, c: Context): Response | undefined {
  if (!result.success) {
    return c.json({ error: result.error[0]?.message ?? 'Invalid input' }, 400)
  }
  return undefined
}

/**
 * Guards a `validator('json', ...)` route with the *same* media-type gate, byte
 * ceiling and error shapes every other JSON route uses. Reusing `readJson`
 * rather than restating those rules is deliberate: a validator reads the body
 * itself and would otherwise bypass the ceiling. Hono caches the body text, so
 * the validator's later `c.req.json()` re-parses the bytes already checked here.
 */
export function jsonRequestGuard(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const result = await readJson(c, maxBytes)
    if (!result.ok) return result.response
    await next()
  }
}

/** Minimal structural view of the generated document, for tag introspection. */
export interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: unknown[]
  requestBody?: unknown
}

export interface OpenApiSpec {
  paths?: Record<string, Record<string, OpenApiOperation | undefined> | undefined>
}

/** One derived tool. Every field comes from the operation in the cached spec. */
export interface AiTool {
  name: string
  description: string
  method: string
  path: string
  parameters: unknown[]
  requestBody: unknown
}

/**
 * Filters the cached OpenAPI document on `AI_SAFE_TAG`. Untagged operations are
 * absent from the document in the first place (hono-openapi skips routes with
 * no metadata), so a newly added dangerous route cannot leak into the manifest.
 */
export function deriveAiTools(spec: OpenApiSpec): AiTool[] {
  const tools: AiTool[] = []
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operation) continue
      if (!Array.isArray(operation.tags) || !operation.tags.includes(AI_SAFE_TAG)) continue
      tools.push({
        name:
          operation.operationId ?? `${method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}`,
        description: operation.summary ?? operation.description ?? '',
        method: method.toUpperCase(),
        path,
        parameters: operation.parameters ?? [],
        requestBody: operation.requestBody ?? null
      })
    }
  }
  return tools
}
