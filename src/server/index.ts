import { bootstrap } from './bootstrap.js'

async function main(): Promise<void> {
  const { logger } = await bootstrap()
  logger.info('RTWiki server initialized')

  const handleSignal = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`)
    process.exit(0)
  }

  process.on('SIGINT', () => void handleSignal('SIGINT'))
  process.on('SIGTERM', () => void handleSignal('SIGTERM'))

  // Keep the process alive until signaled
  await new Promise<void>(() => {})
}

main().catch((err) => {
  console.error('Failed to start RTWiki:', err)
  process.exit(1)
})
