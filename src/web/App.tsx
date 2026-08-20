import { useState, useCallback, useEffect } from 'react'
import { Alert, Stack, Text } from '@mantine/core'
import { IconAlertCircle, IconCheck } from '@tabler/icons-react'
import { usePagesController } from './hooks/use-pages-controller.js'
import { AppShellLayout } from './layout/app-shell.js'
import { Sidebar } from './layout/sidebar.js'
import { Dashboard } from './features/dashboard/dashboard.js'
import { PageWorkspace } from './features/pages/page-workspace.js'
import { NewPageDialog } from './features/pages/new-page-dialog.js'
import { DeleteConfirmModal } from './features/pages/delete-confirm-modal.js'
import { StopConfirmModal } from './features/shutdown/stop-confirm-modal.js'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from './config/index.js'

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

  useEffect(() => {
    fetch('/api/shutdown/token')
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { token: string }
          setShutdownToken(data.token)
        }
      })
      .catch(() => {
        // Token fetch failed — shutdown button will be non-functional.
      })
  }, [])

  const handleStop = useCallback((): void => {
    setStopDialogOpen(true)
  }, [])

  const handleStopConfirm = useCallback(async (): Promise<void> => {
    if (!shutdownToken) return
    setShutdownStatus('stopping')
    setStopDialogOpen(false)
    try {
      const res = await fetch('/api/shutdown', {
        method: 'POST',
        headers: { 'X-RTWiki-Shutdown-Token': shutdownToken }
      })
      if (res.ok) {
        setShutdownStatus('stopped')
      } else {
        setShutdownStatus('error')
      }
    } catch {
      setShutdownStatus('error')
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
    await controller.duplicatePage(controller.selectedPage.id)
  }

  const handleWorkspaceDelete = (): void => {
    if (!controller.selectedPage) return
    setDeleteTarget({ id: controller.selectedPage.id, title: controller.selectedPage.title })
  }

  const handleRename = async (title: string): Promise<boolean> => {
    if (!controller.selectedPage) return false
    return controller.renamePage(controller.selectedPage.id, title)
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

  return (
    <>
      <AppShellLayout
        navbar={
          <Sidebar
            pages={controller.pages}
            loading={controller.loading}
            error={controller.error}
            searchQuery={controller.searchQuery}
            onSearchChange={controller.setSearchQuery}
            selectedId={controller.selectedPage?.id ?? null}
            onSelect={controller.selectPage}
            onNewPage={handleNewPage}
            onStop={handleStop}
          />
        }
      >
        <Stack gap="md">
          {controller.mutationError ? (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
              {controller.mutationError}
            </Alert>
          ) : null}

          {shutdownStatus === 'error' ? (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
              {UI_TEXT.stopError}
            </Alert>
          ) : null}

          {controller.selectedPage ? (
            <PageWorkspace
              page={controller.selectedPage}
              mutationStatus={controller.mutationStatus}
              onBack={() => controller.selectPage(null)}
              onRename={handleRename}
              onDuplicate={handleWorkspaceDuplicate}
              onDelete={handleWorkspaceDelete}
            />
          ) : (
            <Dashboard
              pages={controller.pages}
              loading={controller.loading}
              error={controller.error}
              searchQuery={controller.searchQuery}
              onOpen={controller.selectPage}
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
