import { Notifications } from '@mantine/notifications'
import { useEffect } from 'react'
import { scheduleNotifier } from '../../services/schedule-notifier.js'
import { FLOATING, NOTIFICATION } from '../../theme/registry.js'
import { loadSchedulerPreferences } from '../workspace/scheduler-preferences.js'

/**
 * Mounts the single Mantine <Notifications/> portal and owns the lifecycle of
 * the study Scheduler notification engine. Rendered once near the app root
 * (inside MantineProvider). Starts the engine on mount, refreshes it when the
 * tab regains focus, and stops it on unmount. Preferences are applied from the
 * persisted store so the engine respects the user's Scheduler settings.
 */
export function ScheduleNotifierHost(): JSX.Element {
  useEffect(() => {
    scheduleNotifier.applyPreferences(loadSchedulerPreferences())
    scheduleNotifier.start()

    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        scheduleNotifier.refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      scheduleNotifier.stop()
    }
  }, [])

  // The toast floats like any other layer, so it takes the same shared recipe
  // rather than a library default. It gets its own class as well because its
  // auto-close countdown needs to be repositioned, and that must not be
  // applied to every floating surface.
  return (
    <Notifications
      position="bottom-right"
      classNames={{ notification: `${FLOATING} ${NOTIFICATION}` }}
    />
  )
}
