import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { pool } from '../db'
import { requireAdmin, isAdmin } from './auth'
import {
  analyzeImage, contentHash, perceptualHash, hammingDistance, contentPixels, maxPixelDiff,
} from '../modules/verify/forensics'

export const batchRouter = Router()

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png'
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    cb(null, `${base}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('只支持上传图片文件（截图）'))
  },
})

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const cleanSerial = (s?: string | null) => (s ?? '').replace(/\s+/g, '').toUpperCase()

/** 查重：全库相同流水号 / 相同图片内容 / 视觉近似图片 */
async function findDuplicates(params: {
  serialNo?: string | null
  contentHash?: string | null
  phash?: string | null
  pixels?: number[]
  excludeId?: number
}) {
  const result: {
    serial?: { id: number; batchId: number; batchName: string; member: string; createdAt: string }[]
    identical?: { id: number; batchId: number; batchName: string; member: string; createdAt: string }[]
    similar?: { id: number; batchId: number; batchName: string; member: string; createdAt: string; distance: number; pixelDiff?: number }[]
  } = {}

  const baseSelect = `
    SELECT r.id, r.batch_id AS "batchId", b.name AS "batchName", r.member,
           r.created_at AS "createdAt", r.phash, r.file_path
    FROM receipts r JOIN batches b ON b.id = r.batch_id
  `

  if (params.serialNo) {
    const { rows } = await pool.query(
      `${baseSelect} WHERE UPPER(r.serial_no) = $1 AND ($2::int IS NULL OR r.id <> $2)`,
      [cleanSerial(params.serialNo), params.excludeId ?? null]
    )
    result.serial = rows
  }
  if (params.contentHash) {
    const { rows } = await pool.query(
      `${baseSelect} WHERE r.content_hash = $1 AND ($2::int IS NULL OR r.id <> $2)`,
      [params.contentHash, params.excludeId ?? null]
    )
    result.identical = rows
  }
  if (params.phash) {
    const { rows } = await pool.query(
      `${baseSelect} WHERE r.phash IS NOT NULL AND ($1::int IS NULL OR r.id <> $1)`,
      [params.excludeId ?? null]
    )
    // 256 位 dHash 下：<=6 视为“同一张图变化而来”，7~14 提示存疑
    // 再用 32×32 缩略图做像素级复核，避免“同模板不同内容”的误判
    const candidates = rows
      .filter((r) => !!r.phash)
      .map((r) => ({ ...r, distance: hammingDistance(params.phash!, r.phash) }))
      .filter((r) => r.distance <= 14 && r.distance < 999)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)

    type Cand = (typeof candidates)[number] & { pixelDiff?: number }
    const similar: Cand[] = []
    if (params.pixels) {
      for (const c of candidates) {
        const fp = path.join(UPLOAD_DIR, c.file_path as string)
        if (!fs.existsSync(fp)) continue
        try {
          const px = maxPixelDiff(params.pixels, await contentPixels(fp))
          // 双条件：dHash 距离小 且 像素差小，才认定为同一张图
          if (px <= 40 && c.distance <= 6) similar.push({ ...c, pixelDiff: px })
        } catch {
          /* 忽略单张失败 */
        }
      }
    }
    if (similar.length) {
      result.similar = similar.slice(0, 5).map(({ phash: _p, file_path: _f, ...r }) => r)
    }
  }
  return result
}

const mapReceipt = (r: Record<string, unknown>) => ({
  id: r.id,
  url: `/api/files/${r.file_path}`,
  fileName: r.file_name,
  size: r.size,
  amount: r.amount === null ? null : n(r.amount),
  note: r.note,
  createdAt: r.created_at,
  serialNo: r.serial_no ?? null,
  serialSource: r.serial_source ?? null,
  level: r.level ?? 'safe',
  score: r.score ?? 100,
  checks: r.checks ?? null,
  meta: r.meta ?? null,
  ocr: r.ocr ?? null,
  reviewed: r.reviewed ?? false,
  reviewNote: r.review_note ?? null,
})

/** 批次列表 */
batchRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*,
      COALESCE(s.member_count, 0)::int  AS member_count,
      COALESCE(s.paid_count, 0)::int    AS paid_count,
      COALESCE(s.total_amount, 0)       AS total_amount,
      COALESCE(s.paid_amount, 0)        AS paid_amount,
      COALESCE(s.total_weight, 0)       AS total_weight,
      COALESCE(s.pending_amount, 0)     AS pending_amount,
      COALESCE(s.item_count, 0)::int    AS item_count,
      COALESCE(s.risk_count, 0)::int    AS risk_count
    FROM batches b
    LEFT JOIN (
      SELECT i.batch_id,
        COUNT(DISTINCT i.member) AS member_count,
        COUNT(*) AS item_count,
        SUM(i.total_g) AS total_weight,
        SUM(i.total) AS total_amount,
        COUNT(DISTINCT CASE WHEN m.paid THEN i.member END) AS paid_count,
        SUM(CASE WHEN m.paid THEN i.total ELSE 0 END) AS paid_amount,
        SUM(CASE WHEN m.paid THEN 0 ELSE i.total END) AS pending_amount,
        COUNT(DISTINCT CASE WHEN r.level = 'risk' THEN r.member END) AS risk_count
      FROM items i
      LEFT JOIN members m ON m.batch_id = i.batch_id AND m.name = i.member
      LEFT JOIN receipts r ON r.batch_id = i.batch_id AND r.member = i.member
      GROUP BY i.batch_id
    ) s ON s.batch_id = b.id
    ORDER BY b.created_at DESC
  `)
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    channel: r.channel,
    expectedKg: r.expected_kg === null ? null : n(r.expected_kg),
    ratePerG: n(r.rate_per_g),
    note: r.note,
    createdAt: r.created_at,
    memberCount: r.member_count,
    paidCount: r.paid_count,
    itemCount: r.item_count,
    totalWeight: n(r.total_weight),
    totalAmount: Number(n(r.total_amount).toFixed(2)),
    paidAmount: Number(n(r.paid_amount).toFixed(2)),
    pendingAmount: Number(n(r.pending_amount).toFixed(2)),
    riskCount: r.risk_count,
  })))
})

/** 批次概览 */
batchRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const b = await pool.query('SELECT * FROM batches WHERE id=$1', [id])
  if (!b.rowCount) return res.status(404).json({ message: '批次不存在' })

  const products = await pool.query(`
    SELECT product,
      COUNT(DISTINCT member)::int AS member_count,
      SUM(qty) AS qty,
      SUM(total_g) AS total_g,
      SUM(total) AS amount
    FROM items WHERE batch_id=$1
    GROUP BY product ORDER BY MIN(sort_no)
  `, [id])

  const stats = await pool.query(`
    SELECT
      COUNT(DISTINCT i.member)::int AS member_count,
      COUNT(*)::int AS item_count,
      SUM(i.qty) AS total_qty,
      SUM(i.total_g) AS total_g,
      SUM(CASE WHEN i.qty>0 AND i.unit_g>0
            THEN CEIL(i.qty*i.unit_g*b.rate_per_g*100)/100 + i.adjust
            ELSE i.total END) AS total_amount,
      COUNT(DISTINCT CASE WHEN m.paid THEN i.member END)::int AS paid_count,
      SUM(CASE WHEN m.paid THEN CASE WHEN i.qty>0 AND i.unit_g>0
            THEN CEIL(i.qty*i.unit_g*b.rate_per_g*100)/100 + i.adjust
            ELSE i.total END ELSE 0 END) AS paid_amount
    FROM items i JOIN batches b ON b.id=i.batch_id
    LEFT JOIN members m ON m.batch_id=i.batch_id AND m.name=i.member
    WHERE i.batch_id=$1
  `, [id])

  const verify = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE level='safe')::int AS safe,
      COUNT(*) FILTER (WHERE level='warn')::int AS warn,
      COUNT(*) FILTER (WHERE level='risk')::int AS risk
    FROM receipts WHERE batch_id=$1
  `, [id])

  const s = stats.rows[0]
  const v = verify.rows[0]
  res.json({
    id: b.rows[0].id,
    name: b.rows[0].name,
    channel: b.rows[0].channel,
    expectedKg: b.rows[0].expected_kg === null ? null : n(b.rows[0].expected_kg),
    ratePerG: n(b.rows[0].rate_per_g),
    note: b.rows[0].note,
    sourceFile: b.rows[0].source_file,
    createdAt: b.rows[0].created_at,
    stats: {
      memberCount: s.member_count,
      itemCount: s.item_count,
      totalQty: n(s.total_qty),
      totalWeight: n(s.total_g),
      totalAmount: Number(n(s.total_amount).toFixed(2)),
      paidCount: s.paid_count,
      paidAmount: Number(n(s.paid_amount).toFixed(2)),
      pendingAmount: Number((n(s.total_amount) - n(s.paid_amount)).toFixed(2)),
    },
    verify: { total: v.total, safe: v.safe, warn: v.warn, risk: v.risk },
    products: products.rows.map((p) => ({
      product: p.product,
      memberCount: p.member_count,
      qty: n(p.qty),
      totalWeight: n(p.total_g),
      amount: Number(n(p.amount).toFixed(2)),
    })),
  })
})

/** 成员列表 */
batchRouter.get('/:id/members', async (req, res) => {
  const id = Number(req.params.id)
  const { q = '', status = 'all', product = '', sort = 'default' } = req.query as Record<string, string>

  const { rows } = await pool.query(`
    SELECT i.member,
      COUNT(*)::int AS line_count,
      SUM(i.qty) AS qty,
      SUM(i.total_g) AS total_g,
      SUM(i.intl_fee) AS intl_fee,
      SUM(i.adjust) AS adjust,
      SUM(CASE WHEN i.qty>0 AND i.unit_g>0
            THEN CEIL(i.qty*i.unit_g*b.rate_per_g*100)/100 + i.adjust
            ELSE i.total END) AS amount,
      STRING_AGG(DISTINCT i.product, ' / ') AS products,
      COUNT(DISTINCT i.product)::int AS product_count,
      COALESCE(m.paid, false) AS paid,
      m.paid_amount,
      m.contact,
      m.remark,
      (SELECT COUNT(*)::int FROM receipts r WHERE r.batch_id=i.batch_id AND r.member=i.member) AS receipt_count,
      (SELECT COUNT(*)::int FROM receipts r WHERE r.batch_id=i.batch_id AND r.member=i.member AND r.level='risk') AS risk_count,
      (SELECT COUNT(*)::int FROM receipts r WHERE r.batch_id=i.batch_id AND r.member=i.member AND r.level='warn') AS warn_count,
      (SELECT COUNT(*)::int FROM receipts r WHERE r.batch_id=i.batch_id AND r.member=i.member AND r.level IN ('safe','warn')) AS ok_receipt_count,
      MIN(i.sort_no) AS first_sort
    FROM items i
    JOIN batches b ON b.id=i.batch_id
    LEFT JOIN members m ON m.batch_id=i.batch_id AND m.name=i.member
    WHERE i.batch_id=$1
    GROUP BY i.member, m.paid, m.paid_amount, m.contact, m.remark, i.batch_id
    ORDER BY MIN(i.sort_no)
  `, [id])

  let list = rows.map((r) => ({
    name: r.member,
    lineCount: r.line_count,
    qty: n(r.qty),
    totalWeight: n(r.total_g),
    intlFee: Number(n(r.intl_fee).toFixed(2)),
    adjust: Number(n(r.adjust).toFixed(2)),
    amount: Number(n(r.amount).toFixed(2)),
    products: r.products ? String(r.products).split(' / ') : [],
    productCount: r.product_count,
    paid: r.paid,
    paidAmount: r.paid_amount === null ? null : n(r.paid_amount),
    contact: r.contact,
    remark: r.remark,
    receiptCount: r.receipt_count,
    riskCount: r.risk_count,
    warnCount: r.warn_count,
    okReceiptCount: r.ok_receipt_count,
    firstSort: r.first_sort,
  }))

  if (q) {
    const kw = q.toLowerCase()
    list = list.filter(
      (m) => m.name.toLowerCase().includes(kw) || m.products.some((p) => p.toLowerCase().includes(kw))
    )
  }
  if (product) list = list.filter((m) => m.products.includes(product))
  if (status === 'paid') list = list.filter((m) => m.paid)
  else if (status === 'unpaid') list = list.filter((m) => !m.paid)
  else if (status === 'with-receipt') list = list.filter((m) => m.receiptCount > 0)
  else if (status === 'no-receipt') list = list.filter((m) => m.receiptCount === 0)
  else if (status === 'risk') list = list.filter((m) => m.riskCount > 0)

  if (sort === 'amount-desc') list.sort((a, b) => b.amount - a.amount)
  else if (sort === 'amount-asc') list.sort((a, b) => a.amount - b.amount)
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  res.json(list)
})

/** 成员详情 */
batchRouter.get('/:id/members/:name', async (req, res) => {
  const id = Number(req.params.id)
  const name = req.params.name

  const { rows } = await pool.query(
    `SELECT * FROM items WHERE batch_id=$1 AND member=$2 ORDER BY sort_no`,
    [id, name]
  )
  if (!rows.length) return res.status(404).json({ message: '该成员在本批次中无记录' })

  const m = await pool.query('SELECT * FROM members WHERE batch_id=$1 AND name=$2', [id, name])
  const receipts = await pool.query(
    'SELECT * FROM receipts WHERE batch_id=$1 AND member=$2 ORDER BY created_at DESC',
    [id, name]
  )
  const batch = await pool.query('SELECT name, channel, rate_per_g FROM batches WHERE id=$1', [id])

  const rate = n(batch.rows[0]?.rate_per_g)
  // 小计 = 个数 × 单件克重 × 每克单价（向上取整到分） + 调价
  // 若缺少个数/克重则退回导入的运费值
  const items = rows.map((r) => {
    const qty = n(r.qty)
    const unitG = n(r.unit_g)
    const totalG = n(r.total_g)
    const intlFeeStored = n(r.intl_fee)
    const intlFee =
      qty > 0 && unitG > 0 ? Math.ceil(qty * unitG * rate * 100) / 100 : intlFeeStored
    const adjust = n(r.adjust)
    return {
      id: r.id,
      handleNo: r.handle_no,
      product: r.product,
      characters: r.characters,
      qty,
      unitG,
      totalG,
      intlFee,
      intlFeeStored,
      adjust,
      total: Number((intlFee + adjust).toFixed(2)),
      formula: qty > 0 && unitG > 0 ? `${qty}件 × ${unitG}g × ¥${rate}` : null,
    }
  })

  const admin = isAdmin(req)
  res.json({
    batch: { id, name: batch.rows[0]?.name, channel: batch.rows[0]?.channel, ratePerG: rate },
    member: {
      name,
      paid: m.rows[0]?.paid ?? false,
      paidAmount: m.rows[0]?.paid_amount === null || m.rows[0]?.paid_amount === undefined ? null : n(m.rows[0].paid_amount),
      contact: m.rows[0]?.contact ?? '',
      remark: m.rows[0]?.remark ?? '',
    },
    items,
    summary: {
      lineCount: items.length,
      qty: items.reduce((s, i) => s + i.qty, 0),
      totalWeight: Number(items.reduce((s, i) => s + i.totalG, 0).toFixed(2)),
      intlFee: Number(items.reduce((s, i) => s + i.intlFee, 0).toFixed(2)),
      adjust: Number(items.reduce((s, i) => s + i.adjust, 0).toFixed(2)),
      amount: Number(items.reduce((s, i) => s + i.total, 0).toFixed(2)),
    },
    // 非团长只能看到“有几张、是否通过校验”，看不到任何截图内容
    receipts: admin
      ? receipts.rows.map(mapReceipt)
      : receipts.rows.map((r) => ({
          id: r.id,
          url: '',
          fileName: '',
          size: 0,
          amount: r.amount === null ? null : n(r.amount),
          note: null,
          createdAt: r.created_at,
          serialNo: null,
          serialSource: null,
          level: r.level ?? 'safe',
          score: r.score ?? 100,
          checks: null,
          meta: null,
          ocr: null,
          reviewed: r.reviewed ?? false,
          reviewNote: null,
          hidden: true,
        })),
  })
})

/** 更新成员状态 */
batchRouter.patch('/:id/members/:name', async (req, res) => {
  const id = Number(req.params.id)
  const name = req.params.name
  const { paid, paidAmount, contact, remark } = req.body as {
    paid?: boolean; paidAmount?: number | null; contact?: string; remark?: string
  }

  await pool.query(
    `INSERT INTO members (batch_id, name) VALUES ($1,$2) ON CONFLICT (batch_id, name) DO NOTHING`,
    [id, name]
  )
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (paid !== undefined) { sets.push(`paid=$${i++}`); vals.push(paid) }
  if (paidAmount !== undefined) { sets.push(`paid_amount=$${i++}`); vals.push(paidAmount) }
  if (contact !== undefined) { sets.push(`contact=$${i++}`); vals.push(contact) }
  if (remark !== undefined) { sets.push(`remark=$${i++}`); vals.push(remark) }
  if (!sets.length) return res.json({ ok: true })
  sets.push('updated_at=now()')
  vals.push(id, name)
  await pool.query(`UPDATE members SET ${sets.join(', ')} WHERE batch_id=$${i++} AND name=$${i++}`, vals)
  res.json({ ok: true })
})

/**
 * 上传付款截图（含真实性取证 + 流水号全库唯一校验）
 * body: amount / note / serialNo
 */
batchRouter.post('/:id/members/:name/receipts', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '未收到图片' })
  const id = Number(req.params.id)
  const name = req.params.name
  const manualSerial = cleanSerial((req.body as { serialNo?: string }).serialNo)
  const amountIn = (req.body as { amount?: string }).amount
  const note = (req.body as { note?: string }).note
  const filePath = req.file.path

  try {
    // 1) 取证分析
    const forensics = await analyzeImage(filePath, { mime: req.file.mimetype })
    const cHash = await contentHash(filePath)
    let pHash: string | null = null
    try { pHash = await perceptualHash(filePath) } catch { pHash = null }

    // 2) 流水号：手动填写优先，其次 OCR
    const ocrSerial = cleanSerial(forensics.ocr.serial)
    const serialNo = manualSerial || ocrSerial
    const serialSource = manualSerial ? 'manual' : serialNo ? 'ocr' : null

    // 3) 查重
    let pixels: number[] | null = null
    try { pixels = await contentPixels(filePath) } catch { pixels = null }
    const dup = await findDuplicates({ serialNo, contentHash: cHash, phash: pHash, pixels: pixels ?? undefined })

    const extraChecks = [...forensics.checks]
    if (dup.serial?.length) {
      extraChecks.push({
        key: 'serial_dup',
        label: '流水号重复',
        level: 'risk' as const,
        detail: `该流水号已在 ${dup.serial[0].batchName} / ${dup.serial[0].member} 的截图中使用过（${new Date(dup.serial[0].createdAt).toLocaleString('zh-CN')}）`,
      })
    } else if (serialNo) {
      extraChecks.push({ key: 'serial_dup', label: '流水号唯一性', level: 'safe' as const, detail: '全库未发现相同流水号' })
    }
    // 手填流水号是否与截图上识别的一致（防止张冠李戴）
    if (manualSerial && ocrSerial) {
      // OCR 容易把长数字截断或与相邻字符粘连，因此比较「公共前缀」
      const a = manualSerial.replace(/[^0-9A-Z]/g, '')
      const b = ocrSerial.replace(/[^0-9A-Z]/g, '')
      let prefix = 0
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
      const nearLen = Math.min(a.length, b.length)
      if (a === b) {
        extraChecks.push({
          key: 'serial_match', label: '流水号与截图一致', level: 'safe',
          detail: '手填流水号与截图上识别到的完全一致',
        })
      } else if (prefix >= Math.min(12, Math.floor(nearLen * 0.6))) {
        extraChecks.push({
          key: 'serial_match', label: '流水号与截图一致', level: 'safe',
          detail: `手填流水号与截图识别结果前 ${prefix} 位一致（OCR 可能截断尾段）`,
        })
      } else {
        extraChecks.push({
          key: 'serial_match', label: '流水号与截图不一致', level: 'risk',
          detail: `手填流水号 ${manualSerial} 与截图中识别到的 ${ocrSerial} 对不上，可能填错或截图被替换`,
        })
      }
    } else if (manualSerial && !ocrSerial) {
      extraChecks.push({
        key: 'serial_match', label: '流水号与截图一致', level: 'warn',
        detail: '截图中未能识别出流水号，无法与手填值比对，建议人工核对',
      })
    }

    if (dup.identical?.length) {
      extraChecks.push({
        key: 'img_dup',
        label: '图片重复',
        level: 'risk' as const,
        detail: `与 ${dup.identical[0].member} 上传的截图为同一文件，疑似重复使用`,
      })
    }
    if (dup.similar?.length) {
      const d0 = dup.similar[0]
      const veryClose = d0.distance <= 4 && (d0.pixelDiff ?? 999) <= 20
      extraChecks.push({
        key: 'img_similar',
        label: veryClose ? '疑似重复图' : '图片高度相似',
        level: veryClose ? ('risk' as const) : ('warn' as const),
        detail: veryClose
          ? `与 ${d0.member} 的截图几乎完全相同（dHash ${d0.distance}、像素差 ${d0.pixelDiff ?? '—'}），大概率是同一张图裁剪/压缩后重复上传`
          : `与 ${d0.member} 的截图结构相似（dHash ${d0.distance}、像素差 ${d0.pixelDiff ?? '—'}），建议人工比对`,
      })
    }

    // 4) 金额核对
    const expected = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN i.qty>0 AND i.unit_g>0
            THEN CEIL(i.qty*i.unit_g*b.rate_per_g*100)/100 + i.adjust
            ELSE i.total END),0) AS amt
       FROM items i JOIN batches b ON b.id=i.batch_id
       WHERE i.batch_id=$1 AND TRIM(i.member)=TRIM($2)`,
      [id, name]
    )
    const expectedAmount = Number(expected.rows[0].amt)
    const paidAmount = amountIn ? Number(amountIn) : forensics.ocr.amount
    if (paidAmount !== null && paidAmount !== undefined) {
      const diff = Number((paidAmount - expectedAmount).toFixed(2))
      extraChecks.push({
        key: 'amount',
        label: '金额核对',
        level: Math.abs(diff) < 0.01 ? 'safe' : Math.abs(diff) <= 1 ? 'warn' : 'risk',
        detail:
          Math.abs(diff) < 0.01
            ? `截图金额 ${paidAmount.toFixed(2)} 与应付一致`
            : `截图金额 ${paidAmount.toFixed(2)}，应付 ${expectedAmount.toFixed(2)}，${diff > 0 ? '多' : '少'} ${Math.abs(diff).toFixed(2)} 元`,
      })
    }

    // 5) 汇总等级
    const rank: Record<string, number> = { safe: 0, warn: 1, risk: 2 }
    let level: 'safe' | 'warn' | 'risk' = 'safe'
    let score = 100
    for (const c of extraChecks) {
      if (rank[c.level] > rank[level]) level = c.level
      score -= c.level === 'risk' ? 34 : c.level === 'warn' ? 14 : 0
    }
    score = Math.max(0, Math.min(100, score))

    // 6) 入库（流水号唯一索引兜底）
    const finalAmount = paidAmount ?? null
    const { rows } = await pool.query(
      `INSERT INTO receipts (batch_id, member, file_path, file_name, mime_type, size, amount, note,
         serial_no, serial_source, content_hash, phash, level, score, checks, meta, ocr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [id, name, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size,
        finalAmount, note || null, serialNo || null, serialSource, cHash, pHash, level, score,
        JSON.stringify(extraChecks), JSON.stringify(forensics.meta), JSON.stringify(forensics.ocr)]
    )

    // 只有校验通过（safe）的截图才自动标记已付款；
    // 风险截图（risk）不标记，交由人工核实，避免伪造凭证被当成已付
    if (level === 'safe' || level === 'warn') {
      await pool.query(
        `INSERT INTO members (batch_id, name, paid) VALUES ($1,$2,true)
         ON CONFLICT (batch_id, name) DO UPDATE SET paid=true, updated_at=now()`,
        [id, name]
      )
    } else {
      // 存在风险截图时，如果之前是自动标记的已付款，这里不强制回退（可能有其他正常截图）
      // 但若该成员尚无任何可用截图，则保持未付款
      const safeCnt = await pool.query(
        `SELECT COUNT(*)::int AS c FROM receipts WHERE batch_id=$1 AND member=$2 AND level IN ('safe','warn')`,
        [id, name]
      )
      if (Number(safeCnt.rows[0].c) === 0) {
        await pool.query(
          `INSERT INTO members (batch_id, name, paid) VALUES ($1,$2,false)
           ON CONFLICT (batch_id, name) DO UPDATE SET paid=false, paid_amount=NULL, updated_at=now()`,
          [id, name]
        )
      }
    }

    res.json({ ...mapReceipt(rows[0]), duplicates: dup })
  } catch (e: unknown) {
    // 唯一索引冲突 = 流水号重复（并发情况）
    const err = e as { code?: string; constraint?: string }
    if (err.code === '23505' && err.constraint?.includes('serial')) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return res.status(409).json({ message: '该流水号已存在，不能重复提交（全库唯一）' })
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    throw e
  }
})

/** 重新校验 / 补录流水号 */
batchRouter.patch('/:id/members/:name/receipts/:rid', async (req, res) => {
  const rid = Number(req.params.rid)
  const { serialNo, reviewed, reviewNote, amount } = req.body as {
    serialNo?: string; reviewed?: boolean; reviewNote?: string; amount?: number | null
  }
  const cur = await pool.query('SELECT * FROM receipts WHERE id=$1', [rid])
  if (!cur.rowCount) return res.status(404).json({ message: '截图不存在' })

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (serialNo !== undefined) {
    const s = cleanSerial(serialNo)
    if (s) {
      const dup = await pool.query('SELECT id FROM receipts WHERE UPPER(serial_no)=$1 AND id<>$2', [s, rid])
      if (dup.rowCount) return res.status(409).json({ message: '该流水号已被其他截图使用' })
    }
    sets.push(`serial_no=$${i++}`); vals.push(s || null)
    sets.push(`serial_source=$${i++}`); vals.push(s ? 'manual' : null)
  }
  if (reviewed !== undefined) { sets.push(`reviewed=$${i++}`); vals.push(reviewed) }
  if (reviewNote !== undefined) { sets.push(`review_note=$${i++}`); vals.push(reviewNote) }
  if (amount !== undefined) { sets.push(`amount=$${i++}`); vals.push(amount) }

  if (sets.length) {
    vals.push(rid)
    await pool.query(`UPDATE receipts SET ${sets.join(', ')} WHERE id=$${i}`, vals)
  }

  // 若补录了流水号，重算等级
  if (serialNo !== undefined) {
    const fresh = await pool.query('SELECT * FROM receipts WHERE id=$1', [rid])
    const r = fresh.rows[0]
    const checks = (r.checks ?? []) as { key: string; label: string; level: 'safe'|'warn'|'risk'; detail: string }[]
    const filtered = checks.filter((c) => c.key !== 'serial' && c.key !== 'serial_dup')
    const dup = await pool.query('SELECT id FROM receipts WHERE UPPER(serial_no)=$1 AND id<>$2', [cleanSerial(r.serial_no), rid])
    filtered.push({
      key: 'serial',
      label: '流水号识别',
      level: r.serial_no ? 'safe' : 'warn',
      detail: r.serial_no ? `流水号：${r.serial_no}` : '未填写流水号',
    })
    filtered.push({
      key: 'serial_dup',
      label: '流水号唯一性',
      level: dup.rowCount ? 'risk' : 'safe',
      detail: dup.rowCount ? '该流水号已被其他截图使用' : '全库未发现相同流水号',
    })
    let level: 'safe' | 'warn' | 'risk' = 'safe'
    for (const c of filtered) if (['warn','risk'].includes(c.level) && c.level === 'risk') level = 'risk'
      else if (c.level === 'warn' && level === 'safe') level = 'warn'
    await pool.query('UPDATE receipts SET checks=$1, level=$2 WHERE id=$3', [JSON.stringify(filtered), level, rid])
  }

  const out = await pool.query('SELECT * FROM receipts WHERE id=$1', [rid])
  res.json(mapReceipt(out.rows[0]))
})

/** 删除截图 */
batchRouter.delete('/:id/members/:name/receipts/:rid', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM receipts WHERE id=$1', [Number(req.params.rid)])
  if (rows.length) {
    const p = path.join(UPLOAD_DIR, rows[0].file_path)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    await pool.query('DELETE FROM receipts WHERE id=$1', [Number(req.params.rid)])
  }
  res.json({ ok: true })
})

/** 删除批次 */
batchRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const r = await pool.query('SELECT file_path FROM receipts WHERE batch_id=$1', [id])
  r.rows.forEach((row) => {
    const p = path.join(UPLOAD_DIR, row.file_path)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  })
  await pool.query('DELETE FROM batches WHERE id=$1', [id])
  res.json({ ok: true })
})

/** 修改批次基础信息 */
batchRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { name, note, ratePerG } = req.body as { name?: string; note?: string; ratePerG?: number }
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (name) { sets.push(`name=$${i++}`); vals.push(name) }
  if (note !== undefined) { sets.push(`note=$${i++}`); vals.push(note) }
  if (ratePerG !== undefined) { sets.push(`rate_per_g=$${i++}`); vals.push(ratePerG) }
  if (sets.length) {
    sets.push('updated_at=now()')
    vals.push(id)
    await pool.query(`UPDATE batches SET ${sets.join(', ')} WHERE id=$${i}`, vals)
  }
  res.json({ ok: true })
})
