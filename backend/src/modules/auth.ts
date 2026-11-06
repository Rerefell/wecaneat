import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { pool } from '../db'

/** 团长口令（可用环境变量 ADMIN_PASSWORD 覆盖） */
export const adminPassword = () => process.env.ADMIN_PASSWORD || 'tuanzhang2024'

/** 会话有效期 30 天 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 由口令派生的签名密钥，改口令即让旧令牌全部失效 */
const sign = (payload: string) =>
  crypto.createHmac('sha256', `genie-intl-fee::${adminPassword()}`).update(payload).digest('hex')

export const createToken = () => {
  const exp = Date.now() + TTL_MS
  const payload = `admin.${exp}`
  return `${payload}.${sign(payload)}`
}

export const verifyToken = (token?: string | null): boolean => {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [role, exp, sig] = parts
  if (role !== 'admin') return false
  if (!exp || Number(exp) < Date.now()) return false
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(`${role}.${exp}`)))
}

/** 从请求头 / Cookie 取令牌 */
export const readToken = (req: Request): string | null => {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const cookie = req.headers.cookie
  if (!cookie) return null
  const m = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export const isAdmin = (req: Request) => verifyToken(readToken(req))

/** 登录：校验口令并下发令牌 */
export const login = async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string }
  if (!password) return res.status(400).json({ message: '请输入口令' })

  // 简单防爆破：同一 IP 连续失败 5 次锁定 5 分钟
  const ip = req.ip || 'unknown'
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM admin_attempts
     WHERE ip=$1 AND ok=false AND created_at > now() - interval '5 minutes'`,
    [ip]
  )
  if (Number(rows[0].c) >= 5) {
    return res.status(429).json({ message: '尝试次数过多，请 5 分钟后再试' })
  }

  const ok = password === adminPassword()
  await pool.query('INSERT INTO admin_attempts (ip, ok) VALUES ($1,$2)', [ip, ok])
  if (!ok) return res.status(401).json({ message: '口令不正确' })

  const token = createToken()
  res.setHeader(
    'Set-Cookie',
    `admin_token=${encodeURIComponent(token)}; Path=/; Max-Age=${TTL_MS / 1000}; HttpOnly; SameSite=Lax`
  )
  res.json({ token })
}

/** 中间件：仅管理员可访问 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!isAdmin(req)) return res.status(401).json({ message: '需要团长权限，请先登录' })
  next()
}
