import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconMoon, IconSun } from '@tabler/icons-react'
import { UI_TEXT } from '../config/index.js'

export function ThemeToggle(): JSX.Element {
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true
  })

  const toggle = (): void => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ActionIcon
      onClick={toggle}
      variant="subtle"
      color={computedColorScheme === 'dark' ? 'yellow' : 'dark'}
      aria-label={UI_TEXT.themeToggleLabel}
      size="lg"
    >
      {computedColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  )
}
