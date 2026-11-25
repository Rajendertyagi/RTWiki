/**
 * Permanent internal reference page for Mantine component theming (gate C4).
 *
 * This is NOT part of normal user navigation. It is reachable only at the
 * dedicated path exported as THEME_SHOWCASE_PATH (main.tsx routes to it before
 * mounting the application shell). It renders the Mantine component families,
 * variants and interaction states used by RTWiki so a real browser can read
 * their ACTUAL computed styles under the active theme.
 *
 * Why a real route rather than a standalone fixture: the page is served by the
 * same static handler as the app, so it receives the server-injected pre-paint
 * theme bootstrap, the real built CSS, and the real ThemeProvider (Mantine
 * theme + cssVariablesResolver + variantColorResolver). Computed styles read
 * here are therefore the same pixels a user sees, not a re-creation.
 *
 * The page also publishes the authoritative role table from component-roles.ts
 * on `window.__C4_ROLE_TOKENS__` so the Playwright spec derives its oracle from
 * the SAME module the app uses, rather than a parallel copy that could drift.
 */

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Kbd,
  Menu,
  Modal,
  NavLink,
  Paper,
  Popover,
  Radio,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme
} from '@mantine/core'
import { IconBell, IconSettings } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { CodeEditor } from '../../features/html-editor/code-editor.js'
// The KaTeX probe asserts the real `[data-rt-markdown-preview] .katex` rules.
// That stylesheet is otherwise imported only by the lazily-loaded Markdown
// workspace, which this standalone showcase page never mounts.
import '../../features/markdown/markdown-content.css'
import { renderMarkdown } from '../../features/markdown/markdown-render.js'
import {
  type MermaidTheme,
  renderMermaidSvg
} from '../../features/rich-editor/blocks/mermaid-render.js'
import {
  cssVarForRole,
  FIXED_STATUS_COLORS,
  INTERACTION_ROLES,
  VARIANT_ROLES
} from '../../theme/component-roles.js'

/** The hidden, dev-only path. No extension so the SPA fallback serves index.html. */
export const THEME_SHOWCASE_PATH = '/__theme_showcase'

type RoleTable = Record<string, Record<string, Record<string, { role: string }>>>
type TokenTable = Record<string, Record<string, Record<string, string | null>>>

declare global {
  interface Window {
    /** Role -> resolved SSoT custom-property name, derived from component-roles.ts. */
    __C4_ROLE_TOKENS__?: TokenTable
    /** The fixed status palette from component-roles.ts (owner decision 1). */
    __C4_FIXED_STATUS_COLORS__?: readonly string[]
    /**
     * The Mermaid theme selected for the current colour scheme (owner decision
     * 2: scheme-matched, transparent, theme-following deferred). Published so
     * the browser spec can assert the decision without re-deriving it.
     */
    __C4_MERMAID_THEME__?: MermaidTheme
  }
}

/** Publishes the SSoT role table as plain, serializable token names for the spec. */
function publishRoleTokens(): void {
  const tables: ReadonlyArray<readonly [string, RoleTable]> = [
    ['variant', VARIANT_ROLES as unknown as RoleTable],
    ['interaction', INTERACTION_ROLES as unknown as RoleTable]
  ]
  const result: TokenTable = {}
  for (const [kind, table] of tables) {
    result[kind] = {}
    for (const [name, fields] of Object.entries(table)) {
      result[kind][name] = {}
      for (const [field, assignment] of Object.entries(fields)) {
        const css = cssVarForRole(assignment.role as never)
        const match = /^var\((--[^)]+)\)$/.exec(css)
        // null means the role has no RTWiki-owned CSS variable (e.g. 'none',
        // 'accent', 'neutral-default'); those fields are asserted against the
        // owning Mantine variable instead, never a hardcoded colour.
        result[kind][name][field] = match?.[1] ?? null
      }
    }
  }
  window.__C4_ROLE_TOKENS__ = result
  window.__C4_FIXED_STATUS_COLORS__ = FIXED_STATUS_COLORS
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap="xs" mb="xl">
      <Title order={3}>{title}</Title>
      {children}
    </Stack>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Group gap="md" wrap="nowrap">
      <Text size="xs" c="dimmed" w={190}>
        {label}
      </Text>
      {children}
    </Group>
  )
}

/**
 * Third-party surfaces that own their own rendering but must still follow the
 * theme. Each probe uses the SAME production module the app uses, so the spec
 * reads real computed styles rather than a re-creation:
 *
 * - CodeMirror: `CodeEditor` mounts `htmlEditorTheme` (editor-theme.ts), whose
 *   chrome colours are Mantine CSS variables.
 * - KaTeX: `renderMarkdown` emits real KaTeX markup, styled by the
 *   `[data-rt-markdown-preview] .katex` rules in markdown-content.css.
 * - Mermaid: `renderMermaidSvg` renders a real diagram with the scheme-matched
 *   theme (owner decision 2) and the production SVG sanitizer.
 */
const MERMAID_PROBE_SOURCE = 'flowchart LR\n  A[Theme] --> B[Probe]'
const KATEX_PROBE_HTML = renderMarkdown('$$x^2 + y^2 = z^2$$')

function ThirdPartyProbe(): JSX.Element {
  const colorScheme = useComputedColorScheme('light')
  const mermaidTheme: MermaidTheme = colorScheme === 'dark' ? 'dark' : 'default'
  const [svg, setSvg] = useState<string | null>(null)
  const [renderState, setRenderState] = useState<'pending' | 'ok' | 'error'>('pending')

  // Same publish-during-render pattern as publishRoleTokens(): the spec reads
  // this value in the same tick as the computed styles below.
  window.__C4_MERMAID_THEME__ = mermaidTheme

  useEffect(() => {
    const controller = new AbortController()
    setRenderState('pending')
    void renderMermaidSvg(MERMAID_PROBE_SOURCE, {
      theme: mermaidTheme,
      blockId: 'c4-mermaid-probe',
      blockType: 'diagram',
      signal: controller.signal
    }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) {
        setSvg(result.svg)
        setRenderState('ok')
      } else {
        setSvg(null)
        setRenderState('error')
      }
    })
    return () => controller.abort()
  }, [mermaidTheme])

  return (
    <Stack gap="md">
      <div data-testid="c4-codemirror">
        <CodeEditor
          value="const answer = 42"
          onChange={() => undefined}
          language="javascript"
          label="Theme probe editor"
        />
      </div>
      <div
        data-testid="c4-katex"
        data-rt-markdown-preview
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown() DOMPurify-sanitizes this KaTeX HTML before it reaches the probe
        dangerouslySetInnerHTML={{ __html: KATEX_PROBE_HTML }}
      />
      <div data-testid="c4-mermaid" data-render-state={renderState}>
        {svg !== null ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMermaidSvg() runs the production sanitizeDiagramSvg() pass on this SVG
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : null}
      </div>
    </Stack>
  )
}

/**
 * Renders every themed Mantine family/variant/state. Kept deliberately free of
 * application chrome so selectors are stable and no other component can own a
 * `data-testid` used by the C4 spec.
 */
export function ThemeShowcase(): JSX.Element {
  publishRoleTokens()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <Stack p="xl" gap="md" maw={1200}>
      <Title order={1}>RTWiki Mantine component theme showcase</Title>
      <Text size="sm" c="dimmed">
        Internal reference for gate C4. Not part of normal navigation.
      </Text>

      <Section title="Button — variants">
        <Row label="filled / light / subtle / outline / default">
          <Button data-testid="c4-button-filled" variant="filled">
            Filled
          </Button>
          <Button data-testid="c4-button-light" variant="light">
            Light
          </Button>
          <Button data-testid="c4-button-subtle" variant="subtle">
            Subtle
          </Button>
          <Button data-testid="c4-button-outline" variant="outline">
            Outline
          </Button>
          <Button data-testid="c4-button-default" variant="default">
            Default
          </Button>
        </Row>
        <Row label="disabled (light / default)">
          <Button data-testid="c4-button-disabled" variant="light" disabled>
            Disabled light
          </Button>
          <Button data-testid="c4-button-default-disabled" variant="default" disabled>
            Disabled default
          </Button>
        </Row>
        <Row label="hover targets">
          <Button data-testid="c4-button-filled-hover" variant="filled">
            Filled hover
          </Button>
          <Button data-testid="c4-button-light-hover" variant="light">
            Light hover
          </Button>
          <Button data-testid="c4-button-subtle-hover" variant="subtle">
            Subtle hover
          </Button>
          <Button data-testid="c4-button-outline-hover" variant="outline">
            Outline hover
          </Button>
        </Row>
        <Row label="focus targets">
          <Button data-testid="c4-button-light-focus" variant="light">
            Light focus
          </Button>
          <Button data-testid="c4-button-subtle-focus" variant="subtle">
            Subtle focus
          </Button>
          <Button data-testid="c4-button-outline-focus" variant="outline">
            Outline focus
          </Button>
        </Row>
      </Section>

      <Section title="ActionIcon — variants">
        <Row label="filled / light / subtle / outline / default">
          <ActionIcon data-testid="c4-actionicon-filled" variant="filled" aria-label="Filled">
            <IconBell size={16} />
          </ActionIcon>
          <ActionIcon data-testid="c4-actionicon-light" variant="light" aria-label="Light">
            <IconBell size={16} />
          </ActionIcon>
          <ActionIcon data-testid="c4-actionicon-subtle" variant="subtle" aria-label="Subtle">
            <IconBell size={16} />
          </ActionIcon>
          <ActionIcon data-testid="c4-actionicon-outline" variant="outline" aria-label="Outline">
            <IconBell size={16} />
          </ActionIcon>
          <ActionIcon data-testid="c4-actionicon-default" variant="default" aria-label="Default">
            <IconBell size={16} />
          </ActionIcon>
          <ActionIcon
            data-testid="c4-actionicon-disabled"
            variant="light"
            disabled
            aria-label="Disabled"
          >
            <IconBell size={16} />
          </ActionIcon>
        </Row>
      </Section>

      <Section title="Badge — variants and fixed status colours">
        <Row label="accent: light / subtle / filled / outline">
          <Badge data-testid="c4-badge-light" variant="light">
            Light
          </Badge>
          <Badge data-testid="c4-badge-subtle" variant="subtle">
            Subtle
          </Badge>
          <Badge data-testid="c4-badge-filled" variant="filled">
            Filled
          </Badge>
          <Badge data-testid="c4-badge-outline" variant="outline">
            Outline
          </Badge>
        </Row>
        <Row label="status: red / teal / orange (light)">
          <Badge data-testid="c4-badge-red-light" color="red" variant="light">
            Red
          </Badge>
          <Badge data-testid="c4-badge-teal-light" color="teal" variant="light">
            Teal
          </Badge>
          <Badge data-testid="c4-badge-orange-light" color="orange" variant="light">
            Orange
          </Badge>
        </Row>
      </Section>

      <Section title="Alert — variants and fixed status colours">
        <Row label="accent: light / filled / outline">
          <Alert data-testid="c4-alert-light" variant="light" title="Light">
            Accent light alert
          </Alert>
          <Alert data-testid="c4-alert-filled" variant="filled" title="Filled">
            Accent filled alert
          </Alert>
          <Alert data-testid="c4-alert-outline" variant="outline" title="Outline">
            Accent outline alert
          </Alert>
        </Row>
        <Row label="status: red light / teal filled / orange outline">
          <Alert data-testid="c4-alert-red-light" color="red" variant="light" title="Red">
            Red light alert
          </Alert>
          <Alert data-testid="c4-alert-teal-filled" color="teal" variant="filled" title="Teal">
            Teal filled alert
          </Alert>
          <Alert
            data-testid="c4-alert-orange-outline"
            color="orange"
            variant="outline"
            title="Orange"
          >
            Orange outline alert
          </Alert>
        </Row>
      </Section>

      <Section title="Inputs — default / disabled / focus / placeholder">
        <Row label="TextInput">
          <TextInput data-testid="c4-textinput-default" placeholder="Placeholder text" />
          <TextInput data-testid="c4-textinput-disabled" placeholder="Disabled" disabled />
          <TextInput data-testid="c4-textinput-focus" placeholder="Focus target" />
        </Row>
        <Row label="Textarea">
          <Textarea data-testid="c4-textarea-default" placeholder="Placeholder text" />
          <Textarea data-testid="c4-textarea-disabled" placeholder="Disabled" disabled />
          <Textarea data-testid="c4-textarea-focus" placeholder="Focus target" />
        </Row>
        <Row label="Select">
          <Select
            data-testid="c4-select-default"
            placeholder="Placeholder text"
            data={['One', 'Two']}
            classNames={{ dropdown: 'c4-combobox-surface' }}
          />
          <Select data-testid="c4-select-disabled" placeholder="Disabled" disabled data={['One']} />
          <Select data-testid="c4-select-focus" placeholder="Focus target" data={['One']} />
        </Row>
      </Section>

      <Section title="Toggles — off / on / disabled">
        <Row label="Switch">
          <Switch
            data-testid="c4-switch-off"
            label="Off"
            classNames={{ track: 'c4-switch-track-off' }}
          />
          <Switch
            data-testid="c4-switch-on"
            label="On"
            defaultChecked
            classNames={{ track: 'c4-switch-track-on' }}
          />
          <Switch
            data-testid="c4-switch-disabled"
            label="Disabled"
            disabled
            classNames={{ track: 'c4-switch-track-disabled' }}
          />
        </Row>
        <Row label="Checkbox">
          <Checkbox
            data-testid="c4-checkbox-off"
            label="Off"
            classNames={{ input: 'c4-checkbox-input-off' }}
          />
          <Checkbox
            data-testid="c4-checkbox-on"
            label="On"
            defaultChecked
            classNames={{ input: 'c4-checkbox-input-on' }}
          />
          <Checkbox
            data-testid="c4-checkbox-disabled"
            label="Disabled"
            disabled
            classNames={{ input: 'c4-checkbox-input-disabled' }}
          />
        </Row>
        <Row label="Radio">
          <Radio
            data-testid="c4-radio-off"
            label="Off"
            classNames={{ radio: 'c4-radio-input-off' }}
          />
          <Radio
            data-testid="c4-radio-on"
            label="On"
            defaultChecked
            classNames={{ radio: 'c4-radio-input-on' }}
          />
          <Radio
            data-testid="c4-radio-disabled"
            label="Disabled"
            disabled
            classNames={{ radio: 'c4-radio-input-disabled' }}
          />
        </Row>
      </Section>

      <Section title="NavLink — default / selected / disabled / hover">
        <Stack gap={0} w={320}>
          <NavLink
            data-testid="c4-navlink-default"
            variant="light"
            label="Default"
            leftSection={<IconSettings size={16} />}
          />
          <NavLink
            data-testid="c4-navlink-active"
            variant="light"
            label="Selected"
            active
            leftSection={<IconSettings size={16} />}
          />
          <NavLink
            data-testid="c4-navlink-disabled"
            variant="light"
            label="Disabled"
            disabled
            leftSection={<IconSettings size={16} />}
          />
          <NavLink
            data-testid="c4-navlink-hover"
            variant="light"
            label="Hover target"
            leftSection={<IconSettings size={16} />}
          />
        </Stack>
      </Section>

      <Section title="Menu — default / disabled / hover">
        <Row label="open the menu to reveal items">
          <Menu shadow="md" width={220} classNames={{ dropdown: 'c4-menu-surface' }}>
            <Menu.Target>
              <Button data-testid="c4-menu-trigger" variant="default">
                Open menu
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item data-testid="c4-menu-item-default">Default item</Menu.Item>
              <Menu.Item data-testid="c4-menu-item-disabled" disabled>
                Disabled item
              </Menu.Item>
              <Menu.Item data-testid="c4-menu-item-hover">Hover item</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Row>
      </Section>

      <Section title="SegmentedControl — selected / default">
        <SegmentedControl
          data-testid="c4-segmented"
          data={['First', 'Second', 'Third']}
          defaultValue="First"
        />
      </Section>

      <Section title="Table">
        <Table data-testid="c4-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th data-testid="c4-table-th">Header</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td data-testid="c4-table-td">Cell</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Section>

      <Section title="Kbd — raised surface">
        <Row label="keycap">
          <Kbd data-testid="c4-kbd">Ctrl</Kbd>
        </Row>
      </Section>

      <Section title="Paper / Card">
        <Row label="surfaces">
          <Paper data-testid="c4-paper" p="md" withBorder>
            Paper
          </Paper>
          <Card data-testid="c4-card" p="md" withBorder>
            Card
          </Card>
        </Row>
      </Section>

      <Section title="Floating layers — Tooltip / Popover / Modal">
        <Row label="hover / click to reveal">
          <Tooltip
            data-testid="c4-tooltip"
            label="Tooltip content"
            withArrow
            classNames={{ tooltip: 'c4-tooltip-surface' }}
          >
            <Button data-testid="c4-tooltip-trigger" variant="default">
              Hover for tooltip
            </Button>
          </Tooltip>
          <Popover width={240} withArrow classNames={{ dropdown: 'c4-popover-surface' }}>
            <Popover.Target>
              <Button data-testid="c4-popover-trigger" variant="default">
                Click for popover
              </Button>
            </Popover.Target>
            <Popover.Dropdown>Popover content</Popover.Dropdown>
          </Popover>
          <Button
            data-testid="c4-modal-trigger"
            variant="default"
            onClick={() => setModalOpen(true)}
          >
            Click for modal
          </Button>
          <Modal
            data-testid="c4-modal"
            opened={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Modal"
            classNames={{ content: 'c4-modal-surface' }}
          >
            Modal content
          </Modal>
        </Row>
      </Section>

      <Section title="Third-party surfaces — CodeMirror / KaTeX / Mermaid">
        <ThirdPartyProbe />
      </Section>
    </Stack>
  )
}
