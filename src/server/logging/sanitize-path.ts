import { homedir, tmpdir } from 'node:os'

export interface PathRedactionContext {
  /** Repository root in development; replaces the prefix with `<repo>`. */
  repoRoot?: string
  /** Directory containing the executable; replaces the prefix with `<exe-dir>`. */
  exeDir?: string
}

interface RedactionRule {
  prefix: string
  label: string
}

const USER_PROFILE = homedir()
const TEMP_DIR = tmpdir()

/**
 * Renders a filesystem path for the log file without leaking identifying
 * prefixes. Sensitive roots are replaced, longest match first:
 *
 * - user profile  -> `%USERPROFILE%`
 * - temp dir      -> `%TEMP%`
 * - repository    -> `<repo>`
 * - executable    -> `<exe-dir>`
 *
 * The Windows username must never appear in logs; because every absolute
 * development path starts with the user profile, replacing it first (it is
 * always at least as long as any path beneath it) guarantees that.
 */
export function sanitizePathForLog(path: string, context: PathRedactionContext = {}): string {
  if (!path) return path
  const normalized = path.replace(/\\/g, '/')
  const rules: RedactionRule[] = [
    { prefix: normalize(USER_PROFILE), label: '%USERPROFILE%' },
    { prefix: normalize(TEMP_DIR), label: '%TEMP%' },
    ...(context.repoRoot ? [{ prefix: normalize(context.repoRoot), label: '<repo>' }] : []),
    ...(context.exeDir ? [{ prefix: normalize(context.exeDir), label: '<exe-dir>' }] : [])
  ]
  // Longest match first so e.g. <repo>/data wins over %USERPROFILE% when the
  // repository itself lives under the user profile.
  rules.sort((a, b) => b.prefix.length - a.prefix.length)
  for (const rule of rules) {
    if (!rule.prefix) continue
    const lowerPath = normalized.toLowerCase()
    const lowerPrefix = rule.prefix.toLowerCase()
    if (lowerPath === lowerPrefix) return rule.label
    if (lowerPath.startsWith(lowerPrefix)) {
      return rule.label + normalized.slice(rule.prefix.length)
    }
  }
  return normalized
}

function normalize(path: string): string {
  if (!path) return ''
  let normalized = path.replace(/\\/g, '/')
  while (normalized.endsWith('/') && normalized !== '/') {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}
