import { Kbd, Modal, Stack, Table, Text } from '@mantine/core'
import { UI_TEXT } from '../../config/index.js'
import classes from './shortcut-help.module.css'

interface ShortcutHelpModalProps {
  opened: boolean
  onClose: () => void
}

interface ShortcutItem {
  key: string
  description: string
}

interface ShortcutCategory {
  title: string
  items: ShortcutItem[]
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Global',
    items: [
      { key: 'Ctrl + K', description: 'Open Quick Finder search' },
      { key: 'Ctrl + \\', description: 'Toggle page tree sidebar' },
      { key: 'Ctrl + N', description: 'Create new page' },
      { key: '?', description: 'Open keyboard shortcuts help' }
    ]
  },
  {
    title: 'Page Tree',
    items: [
      { key: 'F2', description: 'Rename selected page' },
      { key: 'Ctrl + D', description: 'Duplicate selected page' },
      { key: 'Del', description: 'Delete selected page' },
      { key: 'Ctrl + Enter', description: 'Create new child page' },
      { key: 'Ctrl + Shift + Enter', description: 'Create new sibling page after' }
    ]
  },
  {
    title: 'Rich Editor',
    items: [
      { key: 'Ctrl + B', description: 'Toggle bold formatting' },
      { key: 'Ctrl + I', description: 'Toggle italic formatting' },
      { key: 'Ctrl + K', description: 'Insert link' },
      { key: '/', description: 'Trigger block insertion menu' }
    ]
  }
]

export function ShortcutHelpModal({ opened, onClose }: ShortcutHelpModalProps): JSX.Element {
  return (
    <Modal opened={opened} onClose={onClose} title={UI_TEXT.shortcutsTitle} size="lg" centered>
      <Stack gap="lg">
        {SHORTCUT_CATEGORIES.map((category) => (
          <Stack gap="xs" key={category.title}>
            <Text fw={600} size="sm" c="dimmed" tt="uppercase" className={classes.categoryLabel}>
              {category.title}
            </Text>
            <Table withRowBorders={false} verticalSpacing="xs">
              <Table.Tbody>
                {category.items.map((item) => (
                  <Table.Tr key={item.key}>
                    <Table.Td className={classes.shortcutCell}>
                      <Kbd>{item.key}</Kbd>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{item.description}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ))}
      </Stack>
    </Modal>
  )
}
