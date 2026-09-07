import {
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput
} from '@mantine/core'
import type {
  PresetApplyMode,
  PresetSource,
  SchedulePreset
} from '@rtwiki/shared/contracts/schedule'
import { useState } from 'react'
import { UI_TEXT } from '../../config/index.js'

interface PresetsPanelProps {
  opened: boolean
  presets: SchedulePreset[]
  onClose: () => void
  onApply: (source: PresetSource, mode: PresetApplyMode) => void
  onSaveAs: (name: string) => void
  onDelete: (id: string) => void
}

export function PresetsPanel({
  opened,
  presets,
  onClose,
  onApply,
  onSaveAs,
  onDelete
}: PresetsPanelProps): JSX.Element {
  const [newName, setNewName] = useState('')

  const builtin = presets.filter((p) => p.builtin)
  const custom = presets.filter((p) => !p.builtin)

  const handleSaveAs = (): void => {
    const name = newName.trim()
    if (!name) return
    onSaveAs(name)
    setNewName('')
  }

  return (
    <Modal opened={opened} onClose={onClose} title={UI_TEXT.schedulePresets} size="lg">
      <Stack gap="sm">
        <Group gap="xs">
          <TextInput
            placeholder={UI_TEXT.schedulePresetName}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            style={{ flex: 1 }}
            data-testid="preset-name-input"
          />
          <Button onClick={handleSaveAs} disabled={!newName.trim()} data-testid="preset-save-as">
            {UI_TEXT.scheduleSaveAsPreset}
          </Button>
        </Group>

        <Divider label={UI_TEXT.scheduleBuiltIn} labelPosition="center" />
        <ScrollArea h={140} type="never">
          <Stack gap="xs">
            {builtin.map((preset) => (
              <Group key={preset.id} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {preset.name}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {UI_TEXT.scheduleBuiltIn}
                  </Badge>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => onApply({ type: 'builtin', key: preset.id }, 'replace')}
                  >
                    {UI_TEXT.scheduleApplyReplace}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onApply({ type: 'builtin', key: preset.id }, 'add')}
                  >
                    {UI_TEXT.scheduleApplyAdd}
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        </ScrollArea>

        <Divider label={UI_TEXT.scheduleCustom} labelPosition="center" />
        {custom.length === 0 ? (
          <Text size="sm" c="dimmed">
            {UI_TEXT.scheduleNoPresets}
          </Text>
        ) : (
          <ScrollArea h={160} type="never">
            <Stack gap="xs">
              {custom.map((preset) => (
                <Group key={preset.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {preset.name}
                  </Text>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => onApply({ type: 'custom', id: preset.id }, 'replace')}
                    >
                      {UI_TEXT.scheduleApplyReplace}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onApply({ type: 'custom', id: preset.id }, 'add')}
                    >
                      {UI_TEXT.scheduleApplyAdd}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => onDelete(preset.id)}
                      aria-label={UI_TEXT.scheduleDeletePreset}
                    >
                      {UI_TEXT.deleteButton}
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  )
}
