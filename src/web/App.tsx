import { Alert, Stack, Text } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle, IconCheck } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_TEXT } from './config/index.js'
import { Dashboard } from './features/dashboard/dashboard.js'
import { DeleteConfirmModal } from './features/pages/delete-confirm-modal.js'
import { NewPageDialog } from './features/pages/new-page-dialog.js'
import { PageWorkspace } from './features/pages/page-workspace.js'
import { fetchShutdownToken, requestShutdown } from './features/shutdown/shutdown-client.js'
import { StopConfirmModal } from './features/shutdown/stop-confirm-modal.js'
import { usePagesController } from './hooks/use-pages-controller.js'
import { AppShellLayout } from './layout/app-shell.js'
import { Sidebar } from './layout/sidebar.js'
import { UtilityRail } from './layout/utility-rail.js'

type SaveState = 'clean' | 'saving' | 'saved' | 'error'

export function App(): JSX.Element {
  const controller = usePagesController()
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
    setDeleteTarget(null)
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
    if (!controller.selectedPage) return false
    return controller.renamePage(controller.selectedPage.id, title)
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
        utilityRail={
          <UtilityRail
            activeHome={controller.selectedPage === null}
            onHome={handleHome}
            onSearchFocus={handleSearchFocus}
            onNewPage={handleNewPage}
            onStop={handleStop}
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
