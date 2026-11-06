import express, { Application } from 'express'
import cors from 'cors'
import compression from 'compression'
import path from 'path'
import fs from 'fs'
import 'express-async-errors'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { httpLogger } from './middleware/logger'
import { systemRouter } from './modules/system'
import { batchRouter } from './modules/batches'
import { importRouter } from './modules/import'
import { shortRouter } from './modules/shortlink'
import { login, isAdmin } from './modules/auth'

export const createApp = (): Application => {
  const app = express()

  app.use(httpLogger)
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN,
      credentials: env.CORS_ORIGIN !== '*',
    })
  )

  app.use(express.json({ limit: '20mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(compression())

  // 静态资源：付款截图
  const uploadDir = path.resolve(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
  // 截图仅团长可访问（非团长直接 403）
  app.use(
    '/api/files',
    (req, res, next) => {
      if (!isAdmin(req)) return res.status(403).json({ message: '截图仅团长可见' })
      next()
    },
    express.static(uploadDir, { maxAge: '7d' })
  )

  app.post(`${env.API_PREFIX}/admin/login`, login)
  app.get(`${env.API_PREFIX}/admin/me`, (req, res) => res.json({ admin: isAdmin(req) }))

  // 短链：/wecaneat → /batches/1
  app.use('/', shortRouter)

  app.use(env.API_PREFIX, systemRouter)
  app.use(`${env.API_PREFIX}/batches`, batchRouter)
  app.use(`${env.API_PREFIX}/import`, importRouter)

  app.use(errorHandler)
  return app
}
