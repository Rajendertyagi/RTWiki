import { Alert, Stack, Text } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle, IconCheck } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from './config/index.js'
import { Dashboard } from './features/dashboard/dashboard.js'
import { DeleteConfirmModal } from './features/pages/delete-confirm-modal.js'
import { NewPageDialog } from './features/pages/new-page-dialog.js'
import { PageWorkspace } from './features/pages/page-workspace.js'
import { fetchShutdownToken, requestShutdown } from './features/shutdown/shutdown-client.js'
import { StopConfirmModal } from './features/shutdown/stop-confirm-modal.js'
import { TabStrip } from './features/tabs/tab-strip.js'
import { closeInTabs, type OpenTab, openInTabs, renameInTabs } from './features/tabs/tabs-model.js'
import { usePagesController } from './hooks/use-pages-controller.js'
import { AppShellLayout } from './layout/app-shell.js'
import { Sidebar } from './layout/sidebar.js'
import { UtilityRail } from './layout/utility-rail.js'

type SaveState = 'clean' | 'saving' | 'saved' | 'error'

export function App(): JSX.Element {
  const controller = usePagesController()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  // Session-only desktop tree-pane visibility (no persistence by design).
  const [treeOpen, setTreeOpen] = useState(true)

  // Any selection (tree click, dashboard card, create, duplicate) opens or
  // activates that page's tab. openInTabs deduplicates by page id.
  useEffect(() => {
    const page = controller.selectedPage
    if (!page) return
    setOpenTabs((prev) => openInTabs(prev, page, UI_TEXT.untitledPage))
  }, [controller.selectedPage])

  // Display-only parent chain for the open page (Workspace Hierarchy).
  const breadcrumb = useMemo(() => {
    const byId = new Map(controller.pages.map((p) => [p.id, p]))
    const chain: string[] = []
    let cursor = controller.selectedPage?.parentId ?? null
    while (cursor !== null) {
      const parent = byId.get(cursor)
      if (!parent) break
      chain.unshift(parent.title || UI_TEXT.untitledPage)
      cursor = parent.parentId ?? null
    }
    return chain
  }, [controller.pages, controller.selectedPage])
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newDialogType, setNewDialogType] = useState<PageType>('rich')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [shutdownToken, setShutdownToken] = useState<string | null>(null)
  const [shutdownStatus, setShutdownStatus] = useState<'idle' | 'stopping' | 'stopped' | 'error'>(
    'idle'
  )
  const [shutdownError, setShutdownError] = useState<string | null>(null)
  const [pendingFlushError, setPendingFlushError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [isDirty, setIsDirty] = useState(false)
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
    controller.selectPage(null)
  }

  const handleSelectPage = async (id: string | null): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    controller.selectPage(id)
    // Any normal navigation lands on the rendered parent view.
    setHtmlSource(null)
  }

  // HTML source-subfile view: which field of which page is being edited.
  const [htmlSource, setHtmlSource] = useState<{
    pageId: string
    field: 'html' | 'css' | 'javascript'
  } | null>(null)

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
    setHtmlSource(null)
  }

  const handleCreatePage = async (title: string, pageType: PageType): Promise<void> => {
    await controller.createPage(title, pageType)
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

  const handleRename = async (title: string): Promise<boolean> => {
    const selected = controller.selectedPage
    if (!selected) return false
    const ok = await controller.renamePage(selected.id, title)
    if (ok) {
      setOpenTabs((prev) => renameInTabs(prev, selected.id, title, UI_TEXT.untitledPage))
    }
    return ok
  }

  const handleWorkspaceClose = async (): Promise<void> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      if (!ok) {
        setPendingFlushError(UI_TEXT.unsavedChangesWarning)
        return
      }
      setPendingFlushError(null)
    }
    controller.selectPage(null)
  }

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (flushRef.current) {
      const ok = await flushRef.current()
      return ok
    }
    return true
  }, [])

  const handleRetry = useCallback(async (): Promise<boolean> => {
    if (flushRef.current) {
      // Retry is handled by the editor's own retry
      return true
    }
    return false
  }, [])

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

  return (
    <>
      <AppShellLayout
        treeOpen={treeOpen}
        tabStrip={
          <TabStrip
            tabs={openTabs}
            activePageId={controller.selectedPage?.id ?? null}
            onSelect={(id) => void handleSelectPage(id)}
            onClose={(id) => void handleTabClose(id)}
            onNew={handleNewPage}
          />
        }
        utilityRail={
          <UtilityRail
            activeHome={controller.selectedPage === null}
            onHome={handleHome}
            onSearchFocus={handleSearchFocus}
            onNewPage={handleNewPage}
            onStop={handleStop}
            treeOpen={treeOpen}
            onToggleTree={() => setTreeOpen((o) => !o)}
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
            onRename={handleRename}
            onDuplicate={(id) => void controller.duplicatePage(id)}
            onDelete={handleDeleteRequest}
            onCreateChild={(parentId) => void controller.createChild(parentId)}
            onCreateChildHtml={(parentId) => void controller.createChild(parentId, 'html')}
            onMoveTo={(id, newParentId) => controller.moveTo(id, newParentId)}
            onMoveRelative={(id, delta) => controller.moveRelative(id, delta)}
            onDropMove={controller.moveToPosition}
            onCreateRoot={(pageType) => void controller.createPage(UI_TEXT.untitledPage, pageType)}
            onOpenHtmlSource={(pageId, field) => void handleOpenHtmlSource(pageId, field)}
          />
        }
      >
        <Stack gap="sm">
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

          {controller.selectedPage ? (
            <PageWorkspace
              page={controller.selectedPage}
              breadcrumb={breadcrumb}
              htmlSourceField={
                htmlSource && htmlSource.pageId === controller.selectedPage.id
                  ? htmlSource.field
                  : null
              }
              onExitHtmlSource={() => void handleExitHtmlSource()}
              onSaveContent={controller.savePageContent}
              isDirty={isDirty}
              saveState={saveState}
              onSave={handleSave}
              onRetry={handleRetry}
              onBack={handleWorkspaceClose}
              onRename={handleRename}
              onDuplicate={handleWorkspaceDuplicate}
              onDelete={handleWorkspaceDelete}
              onFlushRef={(fn) => {
                flushRef.current = fn
              }}
              onSaveStateChange={({ isDirty: dirty, saveState: state }) => {
                setIsDirty(dirty)
                setSaveState(state)
              }}
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
    </>
  )
}
