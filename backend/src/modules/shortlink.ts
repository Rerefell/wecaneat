import { Router, Request, Response } from 'express'
import { pool } from '../db'

export const shortRouter = Router()

/** 极短路径：/wecaneat → 批次 1 */
const ALIASES: Record<string, string> = {
  wecaneat: '/batches/1',
  r: '/batches/1',
}

shortRouter.get('/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code).toLowerCase()
  let target = ALIASES[code]

  // 也支持 /<code>/members/xxx 这种子路径
  if (!target) return res.status(404).send('Not found')

  // 数据库里的短码（可动态生成）
  const { rows } = await pool.query('SELECT target FROM short_links WHERE code=$1', [code])
  if (rows.length) target = rows[0].target

  res.redirect(302, target)
})
