/**
 * Desktop window chrome (ADR-011 extended).
 *
 * Renders a thin custom title bar with native-style minimize / maximize /
 * close buttons when running inside the Tauri shell. The bar is a drag region
 * so the user can move the window by dragging anywhere on it.
 *
 * Close behaviour is read live from Rust via the `get_close_behavior` invoke
 * command so Settings changes apply immediately without restart.
 */

import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Box, Text } from '@mantine/core'
import { IconChevronDown, IconMaximize, IconMinimize, IconX } from '@tabler/icons-react'
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { isNativeMode } from '../services/native-bridge.js'
import { UI_TEXT } from '../config/index.js'
import classes from './window-chrome.module.css'

interface WindowChromeProps {
  /** Rendered below the title bar (the existing <TabStrip>). */
  tabStrip?: React.ReactNode
  /** Main app content rendered below the tab strip. */
  children?: React.ReactNode
}

function WindowChromeInner({ tabStrip, children }: WindowChromeProps): JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const winRef = useRef<TauriWindow | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!isNativeMode()) return

    const win = getCurrentWindow()
    winRef.current = win

    win.isMaximized().then((m) => {
      setIsMaximized(m)
    })

    win
      .onResized(() => {
        win.isMaximized().then((m) => {
          setIsMaximized(m)
        })
      })
      .then((unlisten) => {
        unlistenRef.current = unlisten
      })

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
      }
    }
  }, [])

  const handleMinimize = async () => {
    const win = winRef.current
    if (win) await win.minimize()
  }

  const handleMaximize = async () => {
    const win = winRef.current
    if (!win) return
    if (isMaximized) await win.unmaximize()
    else await win.maximize()
  }

  const handleClose = async () => {
    const win = winRef.current
    if (!win) return

    try {
      const behavior = await invoke<string>('get_close_behavior', { exe_dir: '' })

      if (behavior === 'quit') {
        await win.close()
        return
      }
      if (behavior === 'minimize') {
        await win.hide()
        return
      }

      // ask: show confirmation dialog
      const ok = window.confirm(
        UI_TEXT.desktopCloseHint || 'Minimize RTWiki to the tray instead of quitting?'
      )
      if (ok) await win.hide()
    } catch (error) {
      console.error('Failed to get close behavior or close window:', error)
      // Safe fallback: hide the window instead of crashing or forcing quit
      await win.hide()
    }
  }

  return (
    <>
      {/* Title bar — drag region for moving the window */}
      <Box
        className={classes.titleBar}
        data-tauri-drag-region
        aria-label={`${UI_TEXT.appName} window controls`}
      >
        <Text span className={classes.titleText}>
          {UI_TEXT.appName}
        </Text>
        <Box className={classes.controls}>
          <ActionIcon
            variant="transparent"
            size="sm"
            className={classes.ctrlBtn}
            aria-label="Minimize"
            onClick={handleMinimize}
          >
            <IconMinimize size={14} />
          </ActionIcon>
          <ActionIcon
            variant="transparent"
            size="sm"
            className={classes.ctrlBtn}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            onClick={handleMaximize}
          >
            {isMaximized ? <IconChevronDown size={14} /> : <IconMaximize size={14} />}
          </ActionIcon>
          <ActionIcon
            variant="transparent"
            size="sm"
            className={`${classes.ctrlBtn} ${classes.closeBtn}`}
            aria-label="Close"
            onClick={handleClose}
          >
            <IconX size={14} />
          </ActionIcon>
        </Box>
      </Box>
      {/* Tab strip slot */}
      {tabStrip && <div className={classes.tabStripSlot}>{tabStrip}</div>}
      {/* Main content */}
      {children}
    </>
  )
}

/** Returns null in browser mode so there is no visual change there. */
export function WindowChrome({ tabStrip, children }: WindowChromeProps): JSX.Element | null {
  if (!isNativeMode()) return null
  return <WindowChromeInner tabStrip={tabStrip}>{children}</WindowChromeInner>
}
