import { Alert, Stack, Text } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import {
  parseMarkdownPageContent,
  serializeMarkdownContent
} from '@rtwiki/shared/schemas/markdown-content.js'
import { IconAlertCircle, IconCheck } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pageTypeLabel } from './components/page-type-badge.js'
import { WindowChrome } from './components/window-chrome.js'
import { UI_TEXT } from './config/index.js'
import { debugLog } from './diagnostics/debug-log.js'
import { Calendar } from './features/calendar/calendar.js'
import { ScheduleNotifierHost } from './features/calendar/schedule-notifications.js'
import { Dashboard } from './features/dashboard/dashboard.js'
import { QuickFinder } from './features/finder/quick-finder.js'
import type { EditorStatus } from './features/html-editor/use-codemirror.js'
import { DeleteConfirmModal } from './features/pages/delete-confirm-modal.js'
import { NewPageDialog } from './features/pages/new-page-dialog.js'
import { PageWorkspace } from './features/pages/page-workspace.js'
import {
  buildTemplateContent,
  type RichTemplateKey
} from './features/rich-editor/rich-templates.js'
import { SettingsWorkspace } from './features/settings/settings-workspace.js'
import { ShortcutHelpModal } from './features/shortcuts/shortcut-help.js'
import { fetchShutdownToken, requestShutdown } from './features/shutdown/shutdown-client.js'
import { StopConfirmModal } from './features/shutdown/stop-confirm-modal.js'
import { TabStrip } from './features/tabs/tab-strip.js'
import { closeInTabs, type OpenTab, openInTabs, renameInTabs } from './features/tabs/tabs-model.js'
import { TrashView } from './features/trash/trash-view.js'
import {
  type LayoutPreferences,
  loadLayoutPreferences,
  resetLayoutPreferences,
  saveLayoutPreferences
} from './features/workspace/layout-preferences.js'
import { StatusBar, type StatusSaveState } from './features/workspace/status-bar.js'
import {
  loadWorkspaceSession,
  resolveRestorableWorkspace,
  saveWorkspaceSession,
  type WorkspaceStorage
} from './features/workspace/workspace-session.js'
import { usePagesController } from './hooks/use-pages-controller.js'
import { AppShellLayout } from './layout/app-shell.js'
import { Sidebar } from './layout/sidebar.js'
import { UtilityRail } from './layout/utility-rail.js'
import { isNativeMode } from './services/native-bridge.js'
import { downloadTextFile, sanitizeFileName } from './util/file-download.js'
import { pagePreviewText } from './util/page-preview-text.js'
import { recordRecentPage } from './util/recent-pages.js'

/** sessionStorage adapter; unavailable storage degrades to no persistence. */
function createSessionStorage(): WorkspaceStorage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage
    }
  } catch {
    // Privacy modes can throw on access; restoration is best-effort.
  }
  return null
}

/** Builds a clean URL keeping only the host (ip:port) plus an optional
 * ?page=<id> deep-link param — never a path segment. */
function buildPageUrl(id: string | null): string {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set('page', id)
  else params.delete('page')
  const qs = params.toString()
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname
}

/** Mirrors the active page into the URL. Skipped when the URL already matches
 * (avoids duplicate history entries); during a popstate we replace rather than
 * push so the browser's own history entry is authoritative. */
function syncHistory(id: string | null, isPopstate: boolean): void {
  const current = new URLSearchParams(window.location.search).get('page') ?? null
  if (current === id) return
  const url = buildPageUrl(id)
  if (isPopstate) window.history.replaceState({ pageId: id }, '', url)
  else window.history.pushState({ pageId: id }, '', url)
}

/**
 * True when the page runs inside the Tauri desktop shell. Constant for the
 * lifetime of the document: the IPC bridge is injected before the app boots
 * and never appears or disappears at runtime.
 */
const isNative = isNativeMode()

export function App(): JSX.Element {
  const controller = usePagesController()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  // Pane geometry preferences (Slice 2): explicit user widths and collapse
  // flags, persisted to a versioned localStorage store. Never tabs, page
  // IDs, or content — document/session restoration stays in workspace-session.
  const [layoutPrefs, setLayoutPrefs] = useState<LayoutPreferences>(loadLayoutPreferences)
  const [treeWidth, setTreeWidth] = useState(layoutPrefs.treeWidth)
  const [treeOpen, setTreeOpen] = useState(!layoutPrefs.treeCollapsed)
  const prefsRef = useRef(layoutPrefs)
  prefsRef.current = layoutPrefs

  const persistLayoutPrefs = (next: LayoutPreferences): void => {
    setLayoutPrefs(next)
    saveLayoutPreferences(next)
  }

  const handleToggleTree = (): void => {
    const next = !treeOpen
    setTreeOpen(next)
    persistLayoutPrefs({ ...prefsRef.current, treeCollapsed: !next })
  }

  const handleTreeWidthCommit = (width: number): void => {
    persistLayoutPrefs({ ...prefsRef.current, treeWidth: width })
  }

  // --- Browser-refresh workspace restoration (metadata only) ---
  const workspaceStorageRef = useRef<WorkspaceStorage | null>(null)
  if (workspaceStorageRef.current === null) {
    workspaceStorageRef.current = createSessionStorage()
  }
  // Flips true once per app lifetime when loading first completes; guards
  // both the restore attempt and all subsequent saves.
  const sessionReadyRef = useRef(false)
  // Set while we are responding to a browser back/forward (popstate) so the
  // resulting selection does not push a fresh history entry (that would trap
  // the user in a loop).
  const isPopstateRef = useRef(false)
  const [seedExpandedIds, setSeedExpandedIds] = useState<ReadonlySet<string>>(new Set())
  // Live expansion mirror for persistence writes (avoids re-render coupling).
  const expandedIdsRef = useRef<ReadonlySet<string>>(new Set())

  // Runs exactly once, when the initial page load completes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot restoration gated on the first completed load
  useEffect(() => {
    if (controller.loading || sessionReadyRef.current) return
    sessionReadyRef.current = true
    // Deep-link: a ?page=<id> URL opens that page directly (Issue 5), taking
    // precedence over the saved session.
    const deepLinkId = new URLSearchParams(window.location.search).get('page')
    if (deepLinkId) {
      const target = controller.pages.find((p) => p.id === deepLinkId)
      if (target) {
        controller.selectPage(deepLinkId)
        const params = new URLSearchParams(window.location.search)
        params.set('page', deepLinkId)
        window.history.replaceState(
          { pageId: deepLinkId },
          '',
          `${window.location.pathname}?${params.toString()}`
        )
        debugLog('navigation', 'nav_active_page_changed', { pageId: deepLinkId })
        return
      }
    }
    const storage = workspaceStorageRef.current
    if (!storage) return
    const session = loadWorkspaceSession(storage)
    if (!session) return
    debugLog('ui', 'ui_browser_reload_restore', {})
    const resolved = resolveRestorableWorkspace(session, controller.pages)
    if (!resolved) {
      debugLog('navigation', 'nav_session_invalid_discarded', { code: 'no_valid_pages' })
      saveWorkspaceSession(storage, {
        version: 1,
        openPageIds: [],
        activePageId: null,
        sourceField: 'preview',
        expandedTreeIds: []
      })
      return
    }
    setOpenTabs(resolved.tabs)
    controller.selectPage(resolved.activePageId)
    if (resolved.htmlSource) {
      setHtmlSource(resolved.htmlSource)
    }
    if (resolved.expandedTreeIds.length > 0) {
      const seed = new Set(resolved.expandedTreeIds)
      expandedIdsRef.current = seed
      setSeedExpandedIds(seed)
    }
    debugLog('navigation', 'nav_session_restored', {
      pageId: resolved.activePageId ?? undefined,
      field: resolved.htmlSource?.field ?? 'preview'
    })
  }, [controller.loading, controller.pages])

  // Persist workspace metadata after every meaningful navigation change.
  // Defined after the htmlSource state; mirrors for expansion writes live
  // with that state's declarations.
  const selectedId = controller.selectedPage?.id ?? null

  // Any selection (tree click, dashboard card, create, duplicate) opens or
  // activates that page's tab. openInTabs deduplicates by page id.
  useEffect(() => {
    const page = controller.selectedPage
    if (!page) return
    setOpenTabs((prev) => {
      const next = openInTabs(prev, page, UI_TEXT.untitledPage)
      if (next !== prev) {
        debugLog('navigation', 'nav_tab_opened', { pageId: page.id })
      }
      return next
    })
  }, [controller.selectedPage])

  // Display-only parent chain for the open page (Workspace Hierarchy).
  // Kept as {id,title} pairs so the status-bar breadcrumb can navigate;
  // PageWorkspace takes the plain title list derived below.
  const breadcrumbTrail = useMemo(() => {
    const byId = new Map(controller.pages.map((p) => [p.id, p]))
    const chain: Array<{ id: string; title: string }> = []
    let cursor = controller.selectedPage?.parentId ?? null
    while (cursor !== null) {
      const parent = byId.get(cursor)
      if (!parent) break
      chain.unshift({ id: parent.id, title: parent.title || UI_TEXT.untitledPage })
      cursor = parent.parentId ?? null
    }
    return chain
  }, [controller.pages, controller.selectedPage])
  const breadcrumb = breadcrumbTrail.map((b) => b.title)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newDialogType, setNewDialogType] = useState<PageType>('rich')
  // Settings workspace view (replaces the page/dashboard in the main area).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Calendar / study timetable view (replaces the page/dashboard in the main area).
  const [calendarOpen, setCalendarOpen] = useState(false)
  // Trash workspace view (replaces the page/dashboard in the main area).
  const [trashOpen, setTrashOpen] = useState(false)
  // Favorites workspace view (replaces the page/dashboard in the main area).
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  // Keyboard shortcut help modal state.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Opens the Trash view, flushing pending edits first.
  const handleOpenTrash = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setTrashOpen(true)
    setFavoritesOpen(false)
    setSettingsOpen(false)
    setCalendarOpen(false)
  }

  // Opens the Favorites view, flushing pending edits first.
  const handleOpenFavorites = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setFavoritesOpen(true)
    setTrashOpen(false)
    setSettingsOpen(false)
    setCalendarOpen(false)
  }

  // Opens the Settings workspace, flushing pending edits first so leaving a
  // page never silently drops unsaved work.
  const handleOpenSettings = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setSettingsOpen(true)
    setTrashOpen(false)
    setFavoritesOpen(false)
    setCalendarOpen(false)
  }

  const handleCloseSettings = (): void => {
    setSettingsOpen(false)
  }

  // Opens the Calendar view, flushing pending edits first so leaving a page
  // never silently drops unsaved work.
  const handleOpenCalendar = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setCalendarOpen(true)
    setSettingsOpen(false)
    setTrashOpen(false)
    setFavoritesOpen(false)
  }

  const handleCloseCalendar = (): void => {
    setCalendarOpen(false)
  }
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [shutdownToken, setShutdownToken] = useState<string | null>(null)
  const [shutdownStatus, setShutdownStatus] = useState<'idle' | 'stopping' | 'stopped' | 'error'>(
    'idle'
  )
  const [shutdownError, setShutdownError] = useState<string | null>(null)
  const [pendingFlushError, setPendingFlushError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const flushRef = useRef<(() => Promise<boolean>) | null>(null)

  useEffect(() => {
    void fetchShutdownToken().then((token) => {
      if (token) setShutdownToken(token)
    })
  }, [])

  const handleStop = useCallback((): void => {
    setStopDialogOpen(true)
  }, [])

  const handleStopConfirm = useCallback(async (): Promise<void> => {
    if (!shutdownToken) {
      setShutdownError(UI_TEXT.stopError)
      setShutdownStatus('error')
      setStopDialogOpen(false)
      return
    }
    setShutdownStatus('stopping')
    setShutdownError(null)
    setStopDialogOpen(false)
    const result = await requestShutdown(shutdownToken)
    if (result.success) {
      setShutdownStatus('stopped')
    } else {
      setShutdownStatus('error')
      setShutdownError(result.error ?? UI_TEXT.stopError)
    }
  }, [shutdownToken])

  const handleCreateRich = (): void => {
    setNewDialogType('rich')
    setNewDialogOpen(true)
  }

  const handleCreateHtml = (): void => {
    setNewDialogType('html')
    setNewDialogOpen(true)
  }

  // Browser back/forward support: read the deep-link param and select that page.
  useEffect(() => {
    const onPopState = (): void => {
      isPopstateRef.current = true
      const id = new URLSearchParams(window.location.search).get('page') ?? null
      controller.selectPage(id)
      isPopstateRef.current = false
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [controller])

  const handleSelectPage = useCallback(
    async (id: string | null): Promise<void> => {
      if (flushRef.current) {
        const ok = await flushRef.current()
        if (!ok) {
          setPendingFlushError(UI_TEXT.unsavedChangesWarning)
          return
        }
        setPendingFlushError(null)
      }
      controller.selectPage(id)
      if (id !== null) {
        // Genuinely-opened tracking for the Ctrl+K finder (parent pages only:
        // virtual HTML subfiles resolve before this point).
        recordRecentPage(id)
      }
      debugLog('navigation', 'nav_active_page_changed', { pageId: id ?? undefined })
      // Any normal navigation lands on the rendered parent view.
      setHtmlSource(null)
      setSettingsOpen(false)
      setCalendarOpen(false)
      setTrashOpen(false)
      setFavoritesOpen(false)
      syncHistory(id, isPopstateRef.current)
    },
    [controller]
  )

  const handleImportMarkdown = useCallback(
    async (fileName: string, source: string): Promise<void> => {
      const title = fileName.replace(/\.(md|markdown)$/i, '').trim() || UI_TEXT.untitledPage
      const page = await controller.createPage(
        title,
        'markdown',
        serializeMarkdownContent({ version: 1, markdown: source })
      )
      if (!page) return
      if (flushRef.current) await flushRef.current()
      void handleSelectPage(page.id)
    },
    [controller, handleSelectPage]
  )

  const handleExportPage = useCallback(
    (pageId: string): void => {
      const page = controller.pages.find((p) => p.id === pageId)
      if (page?.pageType !== 'markdown') return
      const parsed = parseMarkdownPageContent(page.content)
      const markdown = parsed.ok ? parsed.value.markdown : ''
      const title = page.title.replace(/\.(md|markdown)$/i, '').trim() || UI_TEXT.untitledPage
      downloadTextFile(`${sanitizeFileName(title)}.md`, markdown, 'text/markdown')
    },
    [controller]
  )

  const handleNewPage = (): void => {
    setNewDialogType('rich')
    setNewDialogOpen(true)
  }

  const handleSearchFocus = (): void => {
    searchInputRef.current?.focus()
  }

  const handleHome = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setSettingsOpen(false)
    setCalendarOpen(false)
    setTrashOpen(false)
    setFavoritesOpen(false)
    controller.selectPage(null)
  }

  // Resets persisted layout preferences and re-applies the defaults live.
  const handleLayoutReset = (): void => {
    const defaults = resetLayoutPreferences()
    setLayoutPrefs(defaults)
    setTreeWidth(defaults.treeWidth)
    setTreeOpen(!defaults.treeCollapsed)
  }

  // HTML source-subfile view: which field of which page is being edited.
  const [htmlSource, setHtmlSource] = useState<{
    pageId: string
    field: 'html' | 'css' | 'javascript'
  } | null>(null)

  // Lifted editor status for the global application status bar.
  const [pageSaveState, setPageSaveState] = useState<StatusSaveState>('saved')
  const [pageSaveError, setPageSaveError] = useState<string | null>(null)
  const [editorStatus, setEditorStatus] = useState<EditorStatus | null>(null)

  // Global Ctrl+K page finder and ? Keyboard Shortcuts Modal listeners.
  const [finderOpen, setFinderOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setFinderOpen((open) => !open)
      } else if (event.key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const target = event.target as HTMLElement | null
        const isEditing =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest('.bn-editor'))
        if (!isEditing) {
          event.preventDefault()
          setShortcutsOpen((open) => !open)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Mirrors for session persistence from render-free callbacks.
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs
  const activeIdRef = useRef(selectedId)
  activeIdRef.current = selectedId
  const htmlSourceRef = useRef(htmlSource)
  htmlSourceRef.current = htmlSource

  /** Expansion writes persist immediately so a refresh after collapse/expand alone still restores. */
  const handleExpandedChange = useCallback((ids: ReadonlySet<string>): void => {
    expandedIdsRef.current = ids
    const storage = workspaceStorageRef.current
    if (!storage || !sessionReadyRef.current) return
    saveWorkspaceSession(storage, {
      version: 1,
      openPageIds: openTabsRef.current.map((tab) => tab.pageId),
      activePageId: activeIdRef.current,
      sourceField: htmlSourceRef.current?.field ?? 'preview',
      expandedTreeIds: [...ids]
    })
  }, [])

  // Persist workspace metadata after every meaningful navigation change.
  useEffect(() => {
    if (!sessionReadyRef.current || controller.loading) return
    const storage = workspaceStorageRef.current
    if (!storage) return
    saveWorkspaceSession(storage, {
      version: 1,
      openPageIds: openTabs.map((tab) => tab.pageId),
      activePageId: selectedId,
      sourceField: htmlSource?.field ?? 'preview',
      expandedTreeIds: [...expandedIdsRef.current]
    })
    debugLog('navigation', 'nav_session_state_stored', { pageId: selectedId ?? undefined })
  }, [openTabs, selectedId, htmlSource, controller.loading])

  /** Flushes pending edits before switching the visible source/preview. */
  const flushQuietly = async (): Promise<boolean> => {
    if (!flushRef.current) return true
    const ok = await flushRef.current()
    if (!ok) setPendingFlushError(UI_TEXT.unsavedChangesWarning)
    return ok
  }

  const handleOpenHtmlSource = async (
    pageId: string,
    field: 'html' | 'css' | 'javascript'
  ): Promise<void> => {
    debugLog('navigation', 'nav_source_view_changed', { pageId, field })
    if (controller.selectedPage?.id !== pageId) {
      const ok = await flushQuietly()
      if (!ok) return
      controller.selectPage(pageId)
    } else if (!(await flushQuietly())) {
      return
    }
    setHtmlSource({ pageId, field })
  }

  const handleExitHtmlSource = async (): Promise<void> => {
    if (!(await flushQuietly())) return
    debugLog('navigation', 'nav_source_view_changed', {
      pageId: controller.selectedPage?.id,
      field: 'preview'
    })
    setHtmlSource(null)
  }

  // Drives the Preview/HTML/CSS/JavaScript switcher in the shared toolbar row.
  // 'preview' returns to the rendered view; a field opens that source subfile.
  const handleSourceFieldChange = (field: 'preview' | 'html' | 'css' | 'javascript'): void => {
    const pageId = controller.selectedPage?.id
    if (!pageId) return
    if (field === 'preview') {
      void handleExitHtmlSource()
    } else {
      void handleOpenHtmlSource(pageId, field)
    }
  }

  const handleCreatePage = async (
    title: string,
    pageType: PageType,
    template?: RichTemplateKey
  ): Promise<void> => {
    const content =
      pageType === 'rich' && template && template !== 'blank'
        ? buildTemplateContent(template)
        : undefined
    const page = await controller.createPage(title, pageType, content)
    if (page) void handleSelectPage(page.id)
  }

  const handleDeleteRequest = (id: string): void => {
    const page = controller.pages.find((p) => p.id === id)
    if (page) {
      setDeleteTarget({ id: page.id, title: page.title })
    }
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return
    await controller.deletePage(deleteTarget.id)
    const tabResult = closeInTabs(openTabs, deleteTarget.id, controller.selectedPage?.id ?? null)
    setOpenTabs(tabResult.tabs)
    if (tabResult.activatePageId !== (controller.selectedPage?.id ?? null)) {
      controller.selectPage(tabResult.activatePageId)
    }
    setDeleteTarget(null)
  }

  const handleTabClose = async (pageId: string): Promise<void> => {
    const isActive = controller.selectedPage?.id === pageId
    if (isActive && flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    debugLog('navigation', 'nav_tab_closed', { pageId })
    const result = closeInTabs(openTabs, pageId, controller.selectedPage?.id ?? null)
    setOpenTabs(result.tabs)
    if (isActive) {
      controller.selectPage(result.activatePageId)
    }
  }

  const handleDuplicate = async (id: string): Promise<void> => {
    await controller.duplicatePage(id)
  }

  const handleWorkspaceDuplicate = async (): Promise<void> => {
    if (!controller.selectedPage) return
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    await controller.duplicatePage(controller.selectedPage.id)
  }

  const handleWorkspaceDelete = async (): Promise<void> => {
    if (!controller.selectedPage) return
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    setDeleteTarget({
      id: controller.selectedPage.id,
      title: controller.selectedPage.title
    })
  }

  /**
   * THE single rename handler, keyed by the real page id. Both the tree and
   * the page header bind into it (the header binds page.id at its call
   * site). The previous one-argument header handler was arity-compatible
   * with the tree's (id, title) contract, so a tree rename passed the row's
   * UUID in the title slot and renamed whichever page was open — the
   * reported ID-like title corruption. One shared signature makes that
   * mismatch unrepresentable.
   */
  const handleRenamePage = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const ok = await controller.renamePage(id, title)
      if (ok) {
        setOpenTabs((prev) => renameInTabs(prev, id, title, UI_TEXT.untitledPage))
      }
      return ok
    },
    [controller]
  )

  const handleWorkspaceClose = async (): Promise<void> => {
    // Back arrow navigates to the direct parent page, not the dashboard root.
    const parentId = controller.selectedPage?.parentId ?? null
    void handleSelectPage(parentId)
  }

  if (shutdownStatus === 'stopped') {
    return (
      <Stack align="center" justify="center" h="100vh">
        <IconCheck size={48} color="var(--mantine-color-green-filled)" />
        <Text size="lg" fw={600}>
          {UI_TEXT.stopSuccessMessage}
        </Text>
      </Stack>
    )
  }

  // Global application status bar, always visible at the viewport bottom. Shows
  // page type + save state on any open page, and caret/selection/format status
  // while editing code; on the dashboard it shows the app is ready.
  const globalStatusBar = controller.selectedPage ? (
    <StatusBar
      pageTypeLabel={pageTypeLabel(controller.selectedPage.pageType)}
      page={controller.selectedPage}
      breadcrumb={breadcrumbTrail}
      onHome={() => void handleSelectPage(null)}
      onOpenPage={(id) => void handleSelectPage(id)}
      saveState={pageSaveState}
      saveError={pageSaveState === 'error' ? pageSaveError : null}
      onRetry={() => void flushQuietly()}
    >
      {editorStatus ? (
        <>
          <Text size="xs" c="dimmed" data-testid="status-caret-position">
            Ln {editorStatus.line}, Col {editorStatus.column}
          </Text>
          {editorStatus.selectedChars > 0 ? (
            <Text size="xs" c="dimmed" data-testid="status-selection-count">
              {editorStatus.selectedChars} selected
            </Text>
          ) : null}
          {editorStatus.formatError !== null ? (
            <Text size="xs" c="red" role="alert" data-testid="status-format-error">
              {UI_TEXT.ideFormatErrorLabel}
            </Text>
          ) : null}
        </>
      ) : null}
    </StatusBar>
  ) : (
    <StatusBar pageTypeLabel={UI_TEXT.appName} saveState="saved">
      <Text size="xs" c="dimmed" data-testid="status-ready">
        {UI_TEXT.ready}
      </Text>
    </StatusBar>
  )

  // The tab strip has one home per runtime: inside the desktop chrome band
  // (native) or at the top of the workspace (browser). `isNative` is static for
  // the page lifetime, so the branch is resolved outside the render path.
  const tabStripNode = (
    <TabStrip
      tabs={openTabs}
      activePageId={controller.selectedPage?.id ?? null}
      onSelect={(id) => {
        debugLog('ui', 'ui_tab_select', { tabId: id ?? undefined })
        void handleSelectPage(id)
      }}
      onClose={(id) => void handleTabClose(id)}
    />
  )

  return (
    <>
      <AppShellLayout
        treeOpen={treeOpen}
        treeWidth={treeWidth}
        onTreeWidthChange={setTreeWidth}
        onTreeWidthCommit={handleTreeWidthCommit}
        statusBar={globalStatusBar}
        chrome={isNative ? <WindowChrome tabStrip={tabStripNode} /> : undefined}
        tabStrip={isNative ? undefined : tabStripNode}
        utilityRail={
          <UtilityRail
            activeHome={
              controller.selectedPage === null &&
              !settingsOpen &&
              !calendarOpen &&
              !trashOpen &&
              !favoritesOpen
            }
            onHome={handleHome}
            onSearchFocus={handleSearchFocus}
            onNewPage={handleNewPage}
            onStop={handleStop}
            onOpenSettings={() => void handleOpenSettings()}
            settingsOpen={settingsOpen}
            onOpenCalendar={() => void handleOpenCalendar()}
            calendarOpen={calendarOpen}
            onOpenFavorites={() => void handleOpenFavorites()}
            favoritesOpen={favoritesOpen}
            onOpenTrash={() => void handleOpenTrash()}
            trashOpen={trashOpen}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            treeOpen={treeOpen}
            onToggleTree={handleToggleTree}
          />
        }
        navbar={
          <Sidebar
            pages={controller.pages}
            loading={controller.loading}
            error={controller.error}
            searchQuery={controller.searchQuery}
            onSearchChange={controller.setSearchQuery}
            selectedId={controller.selectedPage?.id ?? null}
            onSelect={handleSelectPage}
            searchInputRef={searchInputRef}
            onRename={handleRenamePage}
            onDuplicate={(id) => void controller.duplicatePage(id)}
            onDelete={handleDeleteRequest}
            onCreateChild={(parentId) => void controller.createChild(parentId)}
            onCreateChildHtml={(parentId) => void controller.createChild(parentId, 'html')}
            onCreateChildOfType={(parentId, pageType) =>
              void controller.createChild(parentId, pageType)
            }
            onCreateAfterOfType={(pageId, pageType) =>
              void controller.createSiblingAfter(pageId, pageType)
            }
            onMoveTo={(id, newParentId) => controller.moveTo(id, newParentId)}
            onMoveRelative={(id, delta) => controller.moveRelative(id, delta)}
            onDropMove={controller.moveToPosition}
            onCreateRoot={(pageType) => void controller.createPage(UI_TEXT.untitledPage, pageType)}
            onOpenHtmlSource={(pageId, field) => void handleOpenHtmlSource(pageId, field)}
            seedExpandedIds={seedExpandedIds}
            onExpandedChange={handleExpandedChange}
            onImportMarkdown={handleImportMarkdown}
            onExportPage={handleExportPage}
          />
        }
      >
        {/* Layout pass-through only: fills .mainContent so the dashboard scroll
          region and page workspaces bind to a definite height. Never a
          scroll container — scrolling belongs to the dashboard region and
          the per-page-type editor surfaces. */}
        <Stack gap={0} flex={1} mih={0} miw={0}>
          {controller.mutationError ? (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
              {controller.mutationError}
            </Alert>
          ) : null}

          {pendingFlushError ? (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              title="Error"
              withCloseButton
              onClose={() => setPendingFlushError(null)}
            >
              {pendingFlushError}
            </Alert>
          ) : null}

          {shutdownStatus === 'stopping' ? (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="yellow"
              variant="light"
              title="Stopping"
            >
              {UI_TEXT.stopConfirmMessage}
            </Alert>
          ) : null}

          {shutdownStatus === 'error' ? (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
              {shutdownError ?? UI_TEXT.stopError}
            </Alert>
          ) : null}

          {settingsOpen ? (
            <SettingsWorkspace
              layoutPrefs={layoutPrefs}
              onLayoutReset={handleLayoutReset}
              onClose={handleCloseSettings}
            />
          ) : calendarOpen ? (
            <Calendar
              pages={controller.pages.map((p) => ({ id: p.id, title: p.title }))}
              onClose={handleCloseCalendar}
            />
          ) : trashOpen ? (
            <TrashView
              onRestorePage={() => {
                controller.refreshPages()
              }}
            />
          ) : controller.selectedPage ? (
            <PageWorkspace
              page={controller.selectedPage}
              breadcrumb={breadcrumb}
              linkablePages={controller.pages.map((p) => ({
                id: p.id,
                title: p.title,
                pageType: p.pageType,
                preview: pagePreviewText(p)
              }))}
              onOpenPageLink={(id) => void handleSelectPage(id)}
              htmlSourceField={
                htmlSource && htmlSource.pageId === controller.selectedPage.id
                  ? htmlSource.field
                  : null
              }
              onSourceFieldChange={handleSourceFieldChange}
              onExitHtmlSource={() => void handleExitHtmlSource()}
              onSaveContent={controller.savePageContent}
              onBack={handleWorkspaceClose}
              onRenamePage={handleRenamePage}
              onDuplicate={handleWorkspaceDuplicate}
              onDelete={handleWorkspaceDelete}
              onFlushRef={(fn) => {
                flushRef.current = fn
              }}
              onSaveStateChange={(state) => {
                setPageSaveState(state.saveState)
                setPageSaveError(state.error ?? null)
              }}
              onEditorStatusChange={setEditorStatus}
            />
          ) : (
            <Dashboard
              pages={controller.pages}
              loading={controller.loading}
              error={controller.error}
              searchQuery={controller.searchQuery}
              onOpen={handleSelectPage}
              onDuplicate={handleDuplicate}
              onDelete={handleDeleteRequest}
              onCreateRich={handleCreateRich}
              onCreateHtml={handleCreateHtml}
            />
          )}
        </Stack>
      </AppShellLayout>

      <NewPageDialog
        opened={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        onCreate={handleCreatePage}
        initialType={newDialogType}
      />

      <DeleteConfirmModal
        opened={deleteTarget !== null}
        pageTitle={deleteTarget?.title ?? UI_TEXT.untitledPage}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <StopConfirmModal
        opened={stopDialogOpen}
        onClose={() => setStopDialogOpen(false)}
        onConfirm={handleStopConfirm}
      />

      <QuickFinder
        opened={finderOpen}
        onClose={() => setFinderOpen(false)}
        pages={controller.pages}
        onOpenPage={(id) => void handleSelectPage(id)}
      />

      <ShortcutHelpModal opened={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ScheduleNotifierHost />
    </>
  )
}
