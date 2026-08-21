import { Paper, Stack, Text, Title } from '@mantine/core'
import { UI_TEXT } from '../../config/index.js'
import classes from './html-placeholder.module.css'

export function HtmlPlaceholder(): JSX.Element {
  return (
    <Paper p="lg" radius="md" className={classes.placeholder}>
      <Stack gap="sm" align="center">
        <Title order={4}>{UI_TEXT.htmlPlaceholderTitle}</Title>
        <Text size="sm" c="dimmed" ta="center">
          {UI_TEXT.htmlPlaceholderMessage}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {UI_TEXT.htmlPlaceholderHint}
        </Text>
      </Stack>
    </Paper>
  )
}
