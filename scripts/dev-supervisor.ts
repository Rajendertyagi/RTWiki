/**
 * Test-only server supervisor used by Playwright's webServer.
 *
 * Playwright starts ONE process and never restarts it, which makes genuine
 * application-restart journeys impossible. This supervisor spawns the real
 * RTWiki server as a child and respawns it whenever the child exits — so an
 * owner journey can exercise the app's own shutdown endpoint and then watch
 * the application come back, exactly like restarting the portable exe.
 *
 * Arguments: [--port N] (forwarded to the server; defaults to 8080).
 * SIGINT/SIGTERM tear the supervisor and child down so Playwright can stop.
 */
import { type ChildProcess, spawn } from 'node:child_process'

const args = process.argv.slice(2)
const portFlag = args.includes('--port') ? ['--port', String(args[args.indexOf('--port') + 1])] : []

let shuttingDown = false
let child: ChildProcess | null = null

function start(): void {
  child = spawn(process.execPath, ['src/server/index.ts', '--no-open', ...portFlag], {
    stdio: 'inherit'
  })
  child.on('exit', () => {
    if (shuttingDown) return
    // Small backoff so a crash-loop cannot spin the runner.
    setTimeout(start, 300)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shuttingDown = true
    child?.kill()
    process.exit(0)
  })
}

start()
