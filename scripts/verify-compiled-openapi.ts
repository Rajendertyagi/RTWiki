/**
 * Compiled clean-directory gate for the OpenAPI / AI capability surface.
 *
 * The Windows executable is built with `--external zod-to-json-schema` (see
 * scripts/build.ts). That flag is only safe if the externalised module is never
 * actually loaded at runtime. A unit test against the source cannot prove that:
 * it runs with the repository's node_modules present, where a stray import would
 * silently resolve. This script stages the compiled exe and its web assets into
 * a fresh directory with NO node_modules, starts it, and exercises the exact
 * endpoints the external-AI surface depends on.
 *
 * It also asserts the two properties the derived tool manifest relies on:
 * the cached /openapi.json read is byte-identical across two requests, and the
 * ai-safe tag survives into the generated document.
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.RTWiki_OPENAPI_E2E_PORT ?? 8201)
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = BASE
// import.meta.dir is <repo>/scripts; one level up is the repository root.
const repoRoot = join(import.meta.dir, '..')
const BUILD_DIR = process.env.RTWiki_E2E_BUILD_DIR ?? join(repoRoot, 'build', 'server')

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`)
  }
}

/** True when any directory in the staged tree is named node_modules. */
function containsNodeModules(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') return true
    if (entry.isDirectory() && containsNodeModules(join(dir, entry.name))) return true
  }
  return false
}

async function main(): Promise<void> {
  const exePath = join(BUILD_DIR, 'RTWiki.exe')
  if (!existsSync(exePath)) {
    console.error('FAIL: no compiled executable. Run `bun run build` first.')
    process.exit(1)
  }

  const stage = mkdtempSync(join(tmpdir(), 'rtwiki-openapi-e2e-'))
  cpSync(exePath, join(stage, 'RTWiki.exe'))
  if (existsSync(join(BUILD_DIR, 'web'))) {
    cpSync(join(BUILD_DIR, 'web'), join(stage, 'web'), { recursive: true })
  }
  mkdirSync(join(stage, 'data'), { recursive: true })

  check('staged directory has no node_modules', !containsNodeModules(stage))

  // Guard against testing a stale build, the same way verify-compiled-e2e.ts does.
  const exeAge = Date.now() - statSync(exePath).mtimeMs
  const appAge = Date.now() - statSync(join(repoRoot, 'src', 'server', 'app.ts')).mtimeMs
  console.log(
    `  exe is ${Math.round(exeAge / 1000)}s old; src/server/app.ts changed ${Math.round(appAge / 1000)}s ago` +
      (appAge < exeAge ? '  <-- SOURCE IS NEWER THAN THE BUILD' : '')
  )

  let stopped = false
  let server: ReturnType<typeof spawn> | undefined
  const stopServer = (): void => {
    if (stopped) return
    stopped = true
    try {
      server?.kill()
    } catch {
      // Already gone.
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'exit'] as const) {
    process.on(signal, () => {
      stopServer()
      if (signal !== 'exit') process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }

  // Free the port if a previous run left a server behind.
  for (let i = 0; i < 10; i++) {
    try {
      await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
    } catch {
      break
    }
    stopServer()
    await Bun.sleep(300)
  }

  server = spawn(exePath, ['--no-open', '--port', String(PORT)], {
    cwd: stage,
    stdio: 'ignore',
    windowsHide: true
  })

  let ready = false
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) {
        ready = true
        break
      }
    } catch {
      // not listening yet
    }
  }
  if (!ready) {
    stopServer()
    rmSync(stage, { recursive: true, force: true })
    console.error('FAIL: the compiled server did not become ready')
    process.exit(1)
  }

  try {
    console.log('=== OpenAPI document, from a directory with no node_modules ===')
    const first = await fetch(`${BASE}/openapi.json`)
    const firstText = await first.text()
    check('GET /openapi.json is 200', first.status === 200, `status ${first.status}`)
    check(
      'GET /openapi.json declares JSON',
      (first.headers.get('content-type') ?? '').includes('application/json'),
      first.headers.get('content-type') ?? '(none)'
    )

    const second = await fetch(`${BASE}/openapi.json`)
    const secondText = await second.text()
    check('two cached reads are byte-identical', firstText === secondText)

    const spec = JSON.parse(firstText) as {
      paths?: Record<string, Record<string, { tags?: string[] } | undefined>>
    }
    const taggedPaths = Object.entries(spec.paths ?? {})
      .flatMap(([path, operations]) =>
        Object.entries(operations ?? {})
          .filter(([, operation]) => operation?.tags?.includes('ai-safe'))
          .map(([method]) => `${method.toUpperCase()} ${path}`)
      )
      .sort()
    check('the spec contains tagged parent routes', taggedPaths.includes('GET /api/pages'))
    check(
      'the spec contains app.route()-mounted child routes',
      taggedPaths.some((entry) => entry.includes('/api/attachments')),
      taggedPaths.join(', ').slice(0, 160)
    )
    check(
      'tags survive into the generated document',
      taggedPaths.length > 0 && taggedPaths.every((entry) => entry.length > 0)
    )

    console.log('\n=== derived AI tool manifest ===')
    const toolsRes = await fetch(`${BASE}/api/ai/tools`)
    const toolsBody = (await toolsRes.json()) as {
      tools?: Array<{ name: string; method: string; path: string; description: string }>
    }
    check('GET /api/ai/tools is 200', toolsRes.status === 200, `status ${toolsRes.status}`)
    const tools = toolsBody.tools ?? []
    check('the manifest is non-empty', tools.length > 0, `${tools.length} tools`)
    check(
      'the manifest equals the tagged operations',
      tools.length === taggedPaths.length &&
        tools.every((tool) => taggedPaths.includes(`${tool.method} ${tool.path}`)),
      `${tools.length} tools vs ${taggedPaths.length} tagged operations`
    )
    check(
      'no destructive operation is exposed',
      !tools.some((tool) => /permanent|backup\/restore|shutdown|\/presets\/apply/.test(tool.path))
    )

    console.log('\n=== an AI write endpoint works from the clean directory ===')
    const createRes = await fetch(`${BASE}/api/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ title: 'Clean-dir AI page', pageType: 'rich', content: '[]' })
    })
    check('POST /api/pages is 201', createRes.status === 201, `status ${createRes.status}`)
    const created = (await createRes.json()) as { page?: { title?: string } }
    check('the created page is returned', created.page?.title === 'Clean-dir AI page')
  } finally {
    stopServer()
    await Bun.sleep(500)
    try {
      rmSync(stage, { recursive: true, force: true })
    } catch {
      // A locked file is not a test failure.
    }
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
