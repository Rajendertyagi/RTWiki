import { useEffect, useRef, useState } from 'react'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { ActionIcon, Box, Button, Checkbox, Group, TextInput, Tooltip } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconX } from '@tabler/icons-react'
import type { JSX } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './source-find-dialog.module.css'

export interface SourceFindDialogProps {
  getView: () => EditorView | null
  mode: 'find' | 'replace'
  onClose: () => void
}

export function SourceFindDialog({ getView, mode, onClose }: SourceFindDialogProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const isReplace = mode === 'replace'

  const applyQuery = (withReplace: boolean): SearchQuery =>
    new SearchQuery({
      search: query,
      caseSensitive,
      regexp: regex,
      wholeWord,
      replace: withReplace ? replaceText : undefined
    })

  // Push the query into the editor (highlight + select first match) without
  // opening CodeMirror's bottom panel. setSearchQuery is a StateEffect here.
  const pushQuery = (q: SearchQuery): void => {
    const view = getView()
    if (view) view.dispatch({ effects: setSearchQuery.of(q) })
  }

  useEffect(() => {
    const view = getView()
    if (!view) return
    if (query === '') {
      pushQuery(new SearchQuery({ search: '' }))
      setNoMatch(false)
      return
    }
    pushQuery(applyQuery(isReplace))
    setNoMatch(!findNext(view))
  }, [query, caseSensitive, regex, wholeWord, isReplace, replaceText, getView])

  useEffect(() => {
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [])

  const handleNext = (): void => {
    const view = getView()
    if (!view) return
    pushQuery(applyQuery(isReplace))
    setNoMatch(!findNext(view))
  }
  const handlePrev = (): void => {
    const view = getView()
    if (!view) return
    pushQuery(applyQuery(isReplace))
    setNoMatch(!findPrevious(view))
  }
  const handleReplace = (): void => {
    const view = getView()
    if (!view) return
    pushQuery(applyQuery(true))
    replaceNext(view)
  }
  const handleReplaceAll = (): void => {
    const view = getView()
    if (!view) return
    pushQuery(applyQuery(true))
    replaceAll(view)
  }
  const handleClose = (): void => {
    const view = getView()
    if (view) {
      pushQuery(new SearchQuery({ search: '' }))
      closeSearchPanel(view)
    }
    onClose()
  }

  return (
    <Box
      className={classes.dialog}
      role="dialog"
      aria-label={isReplace ? UI_TEXT.findDialogReplaceTitle : UI_TEXT.findDialogFindTitle}
      data-testid="find-dialog"
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <TextInput
          ref={searchRef}
          size="xs"
          placeholder={UI_TEXT.findDialogSearchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) handlePrev()
              else handleNext()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              handleClose()
            }
          }}
          aria-label={UI_TEXT.findDialogFindTitle}
          data-testid="find-query"
          rightSection={
            noMatch && query !== '' ? (
              <span className={classes.statusBad}>{UI_TEXT.findDialogNoMatchLabel}</span>
            ) : null
          }
        />
        <Tooltip label={UI_TEXT.findDialogFindTitle}>
          <ActionIcon variant="subtle" aria-label="Close" onClick={handleClose} data-testid="find-close">
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {isReplace ? (
        <TextInput
          size="xs"
          mt={6}
          placeholder={UI_TEXT.findDialogReplacePlaceholder}
          value={replaceText}
          onChange={(e) => setReplaceText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleReplace()
            }
          }}
          aria-label={UI_TEXT.findDialogReplaceTitle}
          data-testid="find-replace"
        />
      ) : null}

      <Group gap="xs" mt={6} wrap="nowrap">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconArrowUp size={14} />}
          onClick={handlePrev}
          data-testid="find-prev"
        >
          {UI_TEXT.findDialogPreviousLabel}
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconArrowDown size={14} />}
          onClick={handleNext}
          data-testid="find-next"
        >
          {UI_TEXT.findDialogNextLabel}
        </Button>
        {isReplace ? (
          <>
            <Button size="xs" variant="light" onClick={handleReplace} data-testid="find-replace-one">
              {UI_TEXT.findDialogReplaceLabel}
            </Button>
            <Button size="xs" variant="light" onClick={handleReplaceAll} data-testid="find-replace-all">
              {UI_TEXT.findDialogReplaceAllLabel}
            </Button>
          </>
        ) : null}
      </Group>

      <Group gap="md" mt={6} wrap="nowrap">
        <Checkbox
          size="xs"
          label={UI_TEXT.findDialogMatchCaseLabel}
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
        />
        <Checkbox
          size="xs"
          label={UI_TEXT.findDialogRegexLabel}
          checked={regex}
          onChange={(e) => setRegex(e.currentTarget.checked)}
        />
        <Checkbox
          size="xs"
          label={UI_TEXT.findDialogWholeWordLabel}
          checked={wholeWord}
          onChange={(e) => setWholeWord(e.currentTarget.checked)}
        />
      </Group>
    </Box>
  )
}
