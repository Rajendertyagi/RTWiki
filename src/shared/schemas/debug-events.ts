import { z } from 'zod'
import { CLIENT_DEBUG_MAX_EVENTS_PER_BATCH } from '../constants/index.js'

/**
 * Structured client debug events (Debug Mode).
 *
 * Privacy contract, enforced by construction:
 * - The event name and every field are CLOSED allowlists. There is no field
 *   that could carry note content, HTML/CSS/JS source, titles, DOM text,
 *   aria-labels, input values or arbitrary metadata — only IDs, view type,
 *   revision/generation numbers, lengths, a short non-reversible hash,
 *   durations and result codes.
 * - `strictObject` REJECTS unknown fields instead of stripping them, so a
 *   buggy caller can never smuggle content into the log.
 * - Event names are grouped per category; the schema rejects an event whose
 *   name does not belong to its declared category.
 */

export const DEBUG_EVENT_CATEGORIES = [
  'ui',
  'editor',
  'autosave',
  'preview',
  'navigation',
  'error'
] as const

export type DebugEventCategory = (typeof DEBUG_EVENT_CATEGORIES)[number]

/** View/source discriminator. `preview` is the rendered parent view. */
export const DEBUG_SOURCE_FIELDS = ['preview', 'html', 'css', 'javascript'] as const

export type DebugSourceField = (typeof DEBUG_SOURCE_FIELDS)[number]

/**
 * Allowlisted event names, grouped by category. This object is the single
 * source of truth: the client API is typed against it and the server schema
 * validates against the flattened union plus the category mapping below.
 */
export const DEBUG_EVENT_NAMES = {
  ui: [
    'ui_tree_row_open',
    'ui_card_open',
    'ui_tab_select',
    'ui_context_menu_action',
    'ui_return_to_preview',
    'ui_refresh_preview',
    'ui_rename_start',
    'ui_rename_commit',
    'ui_rename_cancel',
    'ui_drag_start',
    'ui_drag_hint_changed',
    'ui_drag_drop',
    'ui_drag_cancel',
    'ui_browser_reload_restore'
  ],
  editor: [
    'editor_mount',
    'editor_unmount',
    'editor_field_selected',
    'editor_transaction',
    'editor_draft_created',
    'editor_draft_replaced',
    'editor_source_switch_requested',
    'editor_source_switch_completed',
    'editor_stale_update_rejected',
    'editor_block_render_requested',
    'editor_block_render_succeeded',
    'editor_block_render_failed'
  ],
  autosave: [
    'autosave_scheduled',
    'autosave_cancelled',
    'autosave_flush_requested',
    'autosave_request_started',
    'autosave_success',
    'autosave_failure',
    'autosave_revision_applied',
    'autosave_stale_ignored'
  ],
  preview: [
    'preview_render_requested',
    'preview_render_built',
    'preview_iframe_ready',
    'preview_runtime_error',
    'preview_manual_refresh',
    'preview_blank_detected'
  ],
  navigation: [
    'nav_tab_opened',
    'nav_tab_activated',
    'nav_tab_closed',
    'nav_active_page_changed',
    'nav_source_view_changed',
    'nav_session_state_stored',
    'nav_session_restored',
    'nav_session_invalid_discarded'
  ],
  error: ['error_boundary', 'error_global', 'error_unhandled_rejection', 'error_api_failure']
} as const satisfies Record<DebugEventCategory, readonly [string, ...string[]]>

export type DebugEventName = {
  [K in keyof typeof DEBUG_EVENT_NAMES]: (typeof DEBUG_EVENT_NAMES)[K][number]
}[keyof typeof DEBUG_EVENT_NAMES]

const ALL_EVENT_NAMES = Object.values(DEBUG_EVENT_NAMES).flat() as DebugEventName[]

/** Maps every allowlisted event name to exactly one category. */
export function debugEventCategory(event: DebugEventName): DebugEventCategory {
  for (const category of DEBUG_EVENT_CATEGORIES) {
    if ((DEBUG_EVENT_NAMES[category] as readonly string[]).includes(event)) {
      return category
    }
  }
  // Unreachable for names of the DebugEventName union; guards raw strings.
  throw new Error(`Unknown debug event name: ${event}`)
}

/** Bounded identifier token: UUIDs, hex ids and short dashed tokens only. */
const idToken = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)

/** Short non-reversible content fingerprint (FNV-1a 32-bit as 8 hex chars). */
const safeHash = z.string().regex(/^[0-9a-f]{8}$/)

/** Bounded machine-readable result/error code token (never free text). */
const codeToken = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

export const DebugEventSchema = z
  .strictObject({
    ts: z.number().int().positive(),
    cat: z.enum(DEBUG_EVENT_CATEGORIES),
    evt: z.enum(ALL_EVENT_NAMES as unknown as [string, ...string[]]),
    pageId: idToken.optional(),
    /** Target of an operation (e.g. drop/move destination page or row). */
    targetId: idToken.optional(),
    tabId: idToken.optional(),
    field: z.enum(DEBUG_SOURCE_FIELDS).optional(),
    rev: z.number().int().nonnegative().optional(),
    gen: z.number().int().nonnegative().optional(),
    len: z.number().int().nonnegative().optional(),
    hash: safeHash.optional(),
    durMs: z.number().nonnegative().optional(),
    result: z.enum(['ok', 'error', 'cancelled', 'rejected', 'stale', 'skipped']).optional(),
    code: codeToken.optional()
  })
  .refine((event) => debugEventCategory(event.evt as DebugEventName) === event.cat, {
    message: 'Event name does not belong to the declared category'
  })

export type DebugEvent = z.infer<typeof DebugEventSchema>

/**
 * Ingest envelope: one batch of events sharing a debug session ID. Keeping
 * the session ID at envelope level means every persisted line still carries
 * it (the server merges it in) without repeating it per event on the wire.
 */
export const DebugEventBatchSchema = z
  .strictObject({
    session: idToken,
    events: z.array(DebugEventSchema).min(1).max(CLIENT_DEBUG_MAX_EVENTS_PER_BATCH)
  })
  .refine((batch) => batch.events.length > 0, { message: 'Empty batch' })

export type DebugEventBatch = z.infer<typeof DebugEventBatchSchema>
