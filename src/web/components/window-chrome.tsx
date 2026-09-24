/**
 * Desktop window chrome (ADR-011 extended).
 *
 * Renders the Chrome-like band at the top of the Tauri shell: a thin title
 * bar with native-style minimize / maximize / close buttons above the existing
 * tab strip. The component is rendered into `AppShell.Header` so the band is
 * fixed, out of the document flow, and every region below it (navbar, main,
 * footer) is offset by Mantine automatically.
 *
 * Drag regions are always *siblings behind* the interactive content, never
 * ancestors of it: Tauri's drag region claims mousedown from the region and
 * everything inside it, which would swallow button clicks.
 *
 * Close behaviour is read live from the shell via the `get_close_behavior`
 * command so Settings changes apply immediately without a restart.
 */

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../config/index.js'
import { isNativeMode } from '../services/native-bridge.js'
import classes from './window-chrome.module.css'

interface WindowChromeProps {
  /** The existing tab strip, rendered under the title bar inside the band. */
  tabStrip?: React.ReactNode
}

type CloseBehavior = 'minimize' | 'quit' | 'ask'

/** Reads the current close behaviour from data/desktop.json, never stale. */
async function readCloseBehavior(): Promise<CloseBehavior> {
  const behavior = await invoke<string>('get_close_behavior')
  return behavior === 'quit' || behavior === 'ask' ? behavior : 'minimize'
}

export function WindowChrome({ tabStrip }: WindowChromeProps): React.ReactElement | null {
  const [isMaximized, setIsMaximized] = useState(false)
  const windowRef = useRef<TauriWindow | null>(null)

  useEffect(() => {
    if (!isNativeMode()) return

    let disposed = false
    let unlistenResize: (() => void) | null = null
    let resizeFrame: number | null = null

    const appWindow = getCurrentWindow()
    windowRef.current = appWindow

    const syncMaximized = async (): Promise<void> => {
      try {
        const maximized = await appWindow.isMaximized()
        if (!disposed) setIsMaximized(maximized)
      } catch {
        // The shell may be unavailable; the restore glyph is the safe default.
        if (!disposed) setIsMaximized(false)
      }
    }

    // Coalesce resize bursts: Windows emits these continuously while dragging.
    const scheduleSync = (): void => {
      if (resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        void syncMaximized()
      })
    }

    void syncMaximized()
    appWindow
      .onResized(scheduleSync)
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlistenResize = unlisten
      })
      .catch(() => {
        unlistenResize = null
      })

    return () => {
      disposed = true
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      unlistenResize?.()
    }
  }, [])

  if (!isNativeMode()) return null

  const handleMinimize = (): void => {
    void windowRef.current?.minimize().catch(reportFailure('minimize'))
  }

  const handleMaximize = (): void => {
    void windowRef.current?.toggleMaximize().catch(reportFailure('toggle maximize'))
  }

  /**
   * The shell's CloseRequested handler owns the decision (it re-reads the
   * setting itself, shows the native prompt for "ask", and quits cleanly), so
   * the button only has to choose between hiding to the tray and asking the
   * shell to close the window.
   */
  const handleClose = (): void => {
    const appWindow = windowRef.current
    if (!appWindow) return
    void readCloseBehavior()
      .then((behavior) => (behavior === 'minimize' ? appWindow.hide() : appWindow.close()))
      .catch(reportFailure('close'))
  }

  return (
    <div className={classes.root} data-testid="window-chrome">
      <div className={classes.titleBar}>
        <div className={classes.dragLayer} data-tauri-drag-region />
        <span className={classes.titleText}>{UI_TEXT.appName}</span>
        <div className={classes.controls}>
          <button
            type="button"
            className={classes.ctrlBtn}
            aria-label={UI_TEXT.minimizeWindow}
            title={UI_TEXT.minimizeWindow}
            onClick={handleMinimize}
          >
            <span className={classes.glyphMinimize} />
          </button>
          <button
            type="button"
            className={classes.ctrlBtn}
            aria-label={isMaximized ? UI_TEXT.restoreWindow : UI_TEXT.maximizeWindow}
            title={isMaximized ? UI_TEXT.restoreWindow : UI_TEXT.maximizeWindow}
            onClick={handleMaximize}
          >
            {isMaximized ? (
              <span className={classes.glyphRestore} />
            ) : (
              <span className={classes.glyphMaximize} />
            )}
          </button>
          <button
            type="button"
            className={`${classes.ctrlBtn} ${classes.closeBtn}`}
            aria-label={UI_TEXT.closeWindow}
            title={UI_TEXT.closeWindow}
            onClick={handleClose}
          >
            <span className={classes.glyphClose} />
          </button>
        </div>
      </div>

      <div className={classes.tabSlot}>
        <div className={classes.dragLayer} data-tauri-drag-region />
        <div className={classes.slotInner}>{tabStrip}</div>
      </div>
    </div>
  )
}

function reportFailure(action: string): (error: unknown) => void {
  return (error) => {
    console.error(`[window-chrome] failed to ${action}:`, error)
  }
}
