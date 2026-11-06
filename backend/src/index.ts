import { createApp } from './app'
import { env } from './config/env'
import { logger } from './config/logger'
import { initDb } from './db'

const startServer = async () => {
  try {
    await initDb()
    const app = createApp()

    app.listen(env.PORT, () => {
      if (env.NODE_ENV === 'development') {
        console.log(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

process.on('SIGTERM', async () => {
  process.exit(0)
})

process.on('SIGINT', async () => {
  process.exit(0)
})

startServer()
