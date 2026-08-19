import { useState, useEffect, useRef } from 'react'
import {
  Container,
  Title,
  Text,
  Card,
  Badge,
  Button,
  Stack,
  Center,
  Loader,
  Alert,
  Group
} from '@mantine/core'
import { IconCheck, IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { checkHealth, type HealthStatus } from './services/api.js'
import { STATUS_TEXT } from './config/index.js'

interface HealthState {
  status: HealthStatus | null
  error: string | null
}

export function App(): JSX.Element {
  const [state, setState] = useState<HealthState>({
    status: null,
    error: null
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current = new AbortController()
    const controller = abortRef.current

    checkHealth(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setState({ status: result.status, error: null })
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setState({ status: 'error', error: err.message })
        }
      })

    return () => {
      controller.abort()
    }
  }, [])

  const handleRetry = (): void => {
    setState({ status: null, error: null })
    const controller = new AbortController()
    abortRef.current = controller

    checkHealth(controller.signal)
      .then((result) => setState({ status: result.status, error: null }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setState({ status: 'error', error: err.message })
        }
      })
  }

  return (
    <Container size="sm" py="xl">
      <Stack align="center" gap="lg">
        <Title order={1} ta="center">
          RTWiki
        </Title>
        <Text c="dimmed" ta="center">
          {STATUS_TEXT.description}
        </Text>

        <Card withBorder padding="lg" radius="md" w="100%">
          {state.status === null && (
            <Center py="lg">
              <Loader size="md" />
            </Center>
          )}

          {state.status === 'ok' && (
            <Stack gap="sm" align="center">
              <IconCheck color="var(--mantine-color-green-6)" size={48} />
              <Title order={3} ta="center">
                {STATUS_TEXT.ready}
              </Title>
              <Badge color="green" variant="light">
                Backend connected
              </Badge>
              <Text size="sm" c="dimmed" ta="center">
                {STATUS_TEXT.readyHint}
              </Text>
            </Stack>
          )}

          {state.status === 'error' && (
            <Stack gap="sm" align="center">
              <Alert
                icon={<IconAlertCircle />}
                title="Connection failed"
                color="red"
                variant="light"
                w="100%"
              >
                {state.error
                  ? `Could not reach the backend: ${state.error}`
                  : STATUS_TEXT.connectionFailed}
              </Alert>
              <Button
                leftSection={<IconRefresh size={14} />}
                onClick={handleRetry}
                variant="outline"
              >
                {STATUS_TEXT.retry}
              </Button>
            </Stack>
          )}
        </Card>

        <Group justify="center" w="100%">
          <Button variant="light" size="sm">
            Home
          </Button>
          <Button variant="light" size="sm">
            Pages
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
