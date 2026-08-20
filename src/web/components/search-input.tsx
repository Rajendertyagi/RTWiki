import { TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { UI_TEXT } from '../config/index.js'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = UI_TEXT.searchPlaceholder
}: SearchInputProps): JSX.Element {
  return (
    <TextInput
      placeholder={placeholder}
      leftSection={<IconSearch size={16} />}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      size="sm"
      radius="md"
      aria-label={UI_TEXT.searchLabel}
    />
  )
}
