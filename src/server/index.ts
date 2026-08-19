import { bootstrap } from './bootstrap.js'

async function main(): Promise<void> {
  const { server, logger, shutdown } = await bootstrap()

  const handleSignal = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`)
    await shutdown()
    process.exit(0)
  }

  process.on('SIGINT', () => void handleSignal('SIGINT'))
  process.on('SIGTERM', () => void handleSignal('SIGTERM'))
}

main().catch((err) => {
  console.error('Failed to start RTWiki:', err)
  process.exit(1)
})
