import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { pool } from '../db'
import { requireAdmin } from './auth'

export const importRouter = Router()

// 导入属于管理操作，必须团长登录
importRouter.use(requireAdmin)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

const round2 = (n: number) => Math.ceil(Number((n * 100).toFixed(4))) / 100
const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

interface ParsedMember {
  name: string
  rows: {
    handle_no: string
    product: string
    characters: string
    qty: number
    unit_g: number
    total_g: number
    intl_fee: number
    adjust: number
    total: number
  }[]
  grand_total: number
  adjust_total: number
  weight_total: number
}

/** 在首行里定位各列（兼容中英文/别名） */
function resolveHeader(header: unknown[]): Record<string, number> {
  const map: Record<string, number> = {}
  header.forEach((h, i) => {
    const t = str(h).toLowerCase().replace(/\s/g, '')
    if (!t) return
    // 带数字后缀的“总金额1 / 总金额2”视为小计列
    const sub = t.match(/^(总金额|合计|应付|小计|总额)(\d+)$/)
    if (sub) {
      if (sub[1] === '小计' || map.subtotal === undefined) map.subtotal = i
      return
    }
    if (['cn', '名字', '姓名', '昵称', '客户', '成员', 'name'].includes(t)) map.member ??= i
    else if (['柄', '品名', '商品', '商品名', '款式'].includes(t)) map.product ??= i
    else if (['角色', '款式角色', '角色名'].includes(t)) map.characters ??= i
    else if (['个数', '数量', '件数', 'qty'].includes(t)) map.qty ??= i
    else if (['g', '克重', '单重'].includes(t)) map.unit_g ??= i
    else if (['g2', '总重', '总克重'].includes(t)) map.total_g ??= i
    else if (t.startsWith('国际金额') || t === '国际运费' || t === '运费') map.intl_fee ??= i
    else if (t.includes('调价') || t === '加价' || t === '调整') map.adjust ??= i
    else if (t === '总金额' || t === '应付' || t === '合计' || t === '总额') map.total ??= i
    else if (t === '小计') map.subtotal ??= i
    else if (['编号', '序号', 'no', 'id'].includes(t)) map.handle_no ??= i
  })
  return map
}

/**
 * 解析表格：
 *  - 自动跳过表头
 *  - 末尾的汇总行（无名字 + SUM 公式）单独提取整体单价 / 总额
 *  - 同一名字多行合并为一位成员
 */
function parseWorkbook(buf: Buffer) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null })
  if (!aoa.length) throw new Error('表格为空')

  // 找到表头行：包含“总金额”或“g”等关键字
  let headerIdx = 0
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const joined = aoa[i].map((c) => str(c).toLowerCase()).join('|')
    if (/总金额|国际金额|角色|个数/.test(joined)) {
      headerIdx = i
      break
    }
  }
  const cols = resolveHeader(aoa[headerIdx])

  const members = new Map<string, ParsedMember>()
  let weightTotal = 0
  let feeTotal = 0
  let grandSum = 0
  let ratePerG = 0

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i]
    if (!row || row.every((c) => c === null || c === '')) continue
    const rawName = str(row[cols.member ?? 0])
    const qty = num(row[cols.qty ?? -1])
    const unitG = num(row[cols.unit_g ?? -1])
    const totalG = cols.total_g !== undefined ? num(row[cols.total_g]) : qty * unitG
    const intlFee = cols.intl_fee !== undefined ? num(row[cols.intl_fee]) : 0

    // 汇总行：没有名字（列位置可能错位，按数值特征识别）
    if (!rawName) {
      const cells = row.map((c) => num(c))
      // 总克重：较大的数值
      const big = cells.filter((v) => v > 200)
      if (big.length) weightTotal = Math.max(weightTotal, ...big)
      // 单价：很小的数（元/克）
      const tiny = cells.filter((v) => v > 0 && v < 10)
      if (tiny.length && ratePerG === 0) ratePerG = tiny[tiny.length - 1]
      // 总运费
      if (totalG > 0 && intlFee > 10) feeTotal = Math.max(feeTotal, intlFee)
      continue
    }
    const adjust = cols.adjust !== undefined ? num(row[cols.adjust]) : 0
    const total = cols.total !== undefined ? num(row[cols.total]) : intlFee + adjust
    if (totalG === 0 && intlFee === 0 && qty === 0) continue

    grandSum += total
    const key = rawName
    if (!members.has(key)) {
      members.set(key, { name: key, rows: [], grand_total: 0, adjust_total: 0, weight_total: 0 })
    }
    const m = members.get(key)!
    m.rows.push({
      handle_no: cols.handle_no !== undefined ? str(row[cols.handle_no]) : '',
      product: str(row[cols.product ?? -1]),
      characters: str(row[cols.characters ?? -1]),
      qty,
      unit_g: unitG,
      total_g: totalG,
      intl_fee: Number(intlFee.toFixed(4)),
      adjust,
      total: Number(total.toFixed(2)),
    })
    m.grand_total += total
    m.adjust_total += adjust
    m.weight_total += totalG
  }

  // 单价兜底：表内没有单价行时，用 总运费/总重 反推
  if (ratePerG === 0 && weightTotal > 0 && feeTotal > 0) ratePerG = feeTotal / weightTotal
  if (ratePerG === 0) {
    const allG = [...members.values()].reduce((s, m) => s + m.weight_total, 0)
    if (allG > 0) ratePerG = grandSum / allG
  }

  const list = [...members.values()].map((m) => ({
    ...m,
    grand_total: Number(m.grand_total.toFixed(2)),
    adjust_total: Number(m.adjust_total.toFixed(2)),
    weight_total: Number(m.weight_total.toFixed(2)),
  }))

  return {
    members: list,
    weightTotal,
    feeTotal,
    ratePerG: Number(ratePerG.toFixed(6)),
    grandSum: Number(grandSum.toFixed(2)),
  }
}

/** 导入整张表为新批次 */
importRouter.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传表格文件' })
  const body = req.body as Record<string, string>
  const parsed = parseWorkbook(req.file.buffer)
  const name = str(body.name) || path.parse(req.file.originalname).name || '未命名批次'
  const channel = str(body.channel) || '日本拼团'
  const rate = body.rate_per_g ? num(body.rate_per_g) : parsed.ratePerG

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const b = await client.query(
      `INSERT INTO batches (name, channel, expected_kg, rate_per_g, note, source_file)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        name,
        channel,
        parsed.weightTotal ? Number((parsed.weightTotal / 1000).toFixed(3)) : null,
        rate,
        str(body.note) || null,
        req.file.originalname,
      ]
    )
    const batchId = b.rows[0].id as number
    let sort = 0
    for (const m of parsed.members) {
      for (const r of m.rows) {
        await client.query(
          `INSERT INTO items (batch_id, member, handle_no, product, characters, qty, unit_g, total_g, intl_fee, adjust, subtotal, total, sort_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            batchId,
            m.name,
            r.handle_no || null,
            r.product,
            r.characters,
            r.qty,
            r.unit_g,
            r.total_g,
            r.intl_fee,
            r.adjust,
            Number((r.intl_fee + r.adjust).toFixed(2)),
            r.total,
            sort++,
          ]
        )
      }
      await client.query(
        `INSERT INTO members (batch_id, name) VALUES ($1,$2)
         ON CONFLICT (batch_id, name) DO NOTHING`,
        [batchId, m.name]
      )
    }
    await client.query('COMMIT')
    res.json({ batchId, batch: b.rows[0], parsed })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

/** 预览解析结果（不入库） */
importRouter.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传表格文件' })
  const parsed = parseWorkbook(req.file.buffer)
  res.json({ fileName: req.file.originalname, ...parsed })
})

/** 追加条目到已有批次 */
importRouter.post('/batch/:id/append', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传表格文件' })
  const batchId = Number(req.params.id)
  const parsed = parseWorkbook(req.file.buffer)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT COALESCE(MAX(sort_no),0) AS s FROM items WHERE batch_id=$1', [batchId])
    let sort = Number(rows[0].s)
    for (const m of parsed.members) {
      for (const r of m.rows) {
        await client.query(
          `INSERT INTO items (batch_id, member, handle_no, product, characters, qty, unit_g, total_g, intl_fee, adjust, subtotal, total, sort_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [batchId, m.name, r.handle_no || null, r.product, r.characters, r.qty, r.unit_g, r.total_g, r.intl_fee, r.adjust,
            Number((r.intl_fee + r.adjust).toFixed(2)), r.total, sort++]
        )
      }
      await client.query(
        `INSERT INTO members (batch_id, name) VALUES ($1,$2) ON CONFLICT (batch_id, name) DO NOTHING`,
        [batchId, m.name]
      )
    }
    await client.query('UPDATE batches SET updated_at=now() WHERE id=$1', [batchId])
    await client.query('COMMIT')
    res.json({ ok: true, added: parsed.members.length })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

export { round2, fs }
