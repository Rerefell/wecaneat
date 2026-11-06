import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import exifr from 'exifr'

const execFileAsync = promisify(execFile)

export type Level = 'safe' | 'warn' | 'risk'

export interface CheckItem {
  key: string
  label: string
  level: Level
  detail: string
}

export interface ForensicsResult {
  level: Level
  score: number
  checks: CheckItem[]
  meta: {
    width?: number
    height?: number
    format?: string
    bytes?: number
    hasExif?: boolean
    exifTime?: string | null
    camera?: string | null
    software?: string | null
    actualType?: string | null
    declaredType?: string | null
    typeMismatch?: boolean
    elaAnomaly?: number
    mean?: number
    texture?: number
    fileCreatedAt?: string
  }
  ocr: {
    available: boolean
    raw: string
    serial: string | null
    amount: number | null
    time: string | null
    keywords: string[]
  }
}

const LEVEL_WEIGHT: Record<Level, number> = { safe: 0, warn: 14, risk: 34 }
const rank: Record<Level, number> = { safe: 0, warn: 1, risk: 2 }
const worse = (a: Level, b: Level): Level => (rank[a] >= rank[b] ? a : b)

/** 已知图片编辑器 / 社交软件重压缩的软件标记 */
const EDITOR_SIGNS = [
  'photoshop', 'lightroom', 'gimp', 'snapseed', 'picsart', '美图', 'meitu',
  'canva', 'pixlr', 'affinity', 'facetune', 'retouch', 'color', 'screenshot',
  '微信', 'wechat', 'qq', 'sogou', 'xhs', '小红书', 'inshot', 'pitu', '醒图',
]

const PAY_KEYWORDS = [
  '转账', '付款', '支付', '收款', '已收钱', '到账', '成功', '交易', '订单',
  '微信支付', '支付宝', '零钱', '余额', '银行卡', '商户', '流水', '单号',
  // 繁体（微信/支付宝港澳台版界面）
  '轉賬', '付款', '支付', '收款', '已收錢', '到賬', '訂單', '商戶', '單號', '賬單',
]

/**
 * 只读文件头判断实际格式（不信任扩展名 / Content-Type）
 * 手写魔数识别，避免依赖 ESM-only 包
 */
export async function sniffType(buf: Buffer): Promise<{ mime: string; ext: string } | null> {
  const b = buf.subarray(0, 16)
  const hex = b.toString('hex')
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' }
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png' }
  if (hex.startsWith('474946383')) return { mime: 'image/gif', ext: 'gif' }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  if (hex.startsWith('424d')) return { mime: 'image/bmp', ext: 'bmp' }
  if (hex.startsWith('49492a00') || hex.startsWith('4d4d002a')) return { mime: 'image/tiff', ext: 'tif' }
  if (hex.startsWith('00000024') || hex.startsWith('0000001c')) return { mime: 'image/heic', ext: 'heic' }
  return null
}

/** 读取 EXIF 等元数据 */
export async function readMeta(filePath: string) {
  try {
    const data = await exifr.parse(filePath, { tiff: true, exif: true, gps: true, xmp: true, icc: false })
    if (!data) return null
    return data as Record<string, unknown>
  } catch {
    return null
  }
}

/** 用 tesseract 做 OCR（中英混合） */
export async function runOcr(filePath: string): Promise<{ available: boolean; raw: string }> {
  const run = (args: string[]) =>
    execFileAsync('tesseract', args, { timeout: 40000, maxBuffer: 10 * 1024 * 1024 })
      .then((r) => r.stdout as string)
      .catch(() => '')

  // 主扫描：整图
  let raw = await run([filePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'])
  if (!raw) raw = await run([filePath, 'stdout', '-l', 'eng', '--psm', '6'])
  if (!raw) return { available: false, raw: '' }

  // 辅扫描：账单类截图的金额是大字号（约在 8%~28% 高度处），
  // 整图扫描常漏检，裁出该区域放大 2 倍再扫一遍
  try {
    const tmp = filePath + '.crop.png'
    const meta = await sharp(filePath).metadata()
    const H = meta.height ?? 0
    const W = meta.width ?? 0
    if (H > 600 && W > 200) {
      await sharp(filePath)
        .extract({ left: 0, top: Math.round(H * 0.06), width: W, height: Math.round(H * 0.24) })
        .resize({ width: Math.max(W * 2, 800) })
        .png()
        .toFile(tmp)
      const extra = await run([tmp, 'stdout', '-l', 'eng', '--psm', '6'])
      fs.existsSync(tmp) && fs.unlinkSync(tmp)
      if (extra) raw += '\n' + extra
    }
  } catch {
    /* 辅扫描失败不影响主结果 */
  }
  return { available: true, raw }
}

/**
 * 清洗 OCR 识别出的流水号尾部：
 * 相邻的界面文字常被误读成大写字母粘在数字后（如 …278152BRESARTS），
 * 规则：尾部的纯字母段若 ≤8 位且去掉后仍有 ≥12 位，则视为杂讯剔除
 */
function cleanSerialTail(sRaw: string): string {
  let s = sRaw.trim()
  while (true) {
    const m = s.match(/^(.+?)([A-Za-z]{2,8})$/)
    if (!m) break
    const head = m[1]
    if (head.replace(/[^0-9A-Za-z]/g, '').length >= 12) s = head
    else break
  }
  return s
}

/** 从 OCR 文本里抽取流水号 / 金额 / 时间 */
export function extractOcrFields(raw: string) {
  // 1) 长数字串中因换行/空格断开的片段重新拼合（如 …17800 3832 → …178003832）
  let merged = raw.replace(/(?<=[0-9A-Z])\s+(?=[0-9A-Z]{2,})/g, '')
  // 但保留「标签 + 空格 + 值」的可读性：只在纯字母数字间合并
  const text = merged.replace(/\s+/g, ' ')

  // 流水号 / 交易单号（兼容简繁：單號/賬單/轉賬）
  const serialPatterns = [
    /(?:流水号|流水號|交易单号|交易單號|订单号|訂單號|凭证号|憑證號|交易号|交易號|转账单号|轉賬單號|序列号|账单号|賬單號|单号|單號)\s*[:：]?\s*([0-9A-Za-z]{12,40})/,
    /\b(\d{18,32})\b/,
    /\b([0-9A-Z]{16,40})\b/,
  ]
  let serial: string | null = null
  for (const p of serialPatterns) {
    const m = text.match(p)
    if (m) {
      serial = cleanSerialTail(m[1])
      break
    }
  }

  // 金额：¥/￥ 前缀、「-212.00」大字号行、X.XX 元、金额/转账金额标签
  const moneyMatch =
    text.match(/[¥￥]\s*([\d,]+\.?\d{0,2})/) ||
    text.match(/[−-]\s*([\d,]{2,}\.\d{2})/) ||
    text.match(/([\d,]+\.\d{2})\s*元/) ||
    text.match(/(?:转账金额|轉賬金額|付款金额|付款金額|金额|金額)[^\d]{0,6}([\d,]+\.?\d{0,2})/) ||
    text.match(/([\d,]+\.\d{2})/)
  const amount = moneyMatch ? Number(moneyMatch[1].replace(/,/g, '')) : null

  // 时间：2024-05-01 12:30 或 2024年5月1日 12:30
  const timeMatch =
    text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*(\d{1,2}:\d{2}(?::\d{2})?)?/) || null
  const time = timeMatch
    ? `${timeMatch[1]}-${String(timeMatch[2]).padStart(2, '0')}-${String(timeMatch[3]).padStart(2, '0')}${timeMatch[4] ? ' ' + timeMatch[4] : ''}`
    : null

  const keywords = PAY_KEYWORDS.filter((k) => text.includes(k))
  return { serial, amount, time, keywords, text }
}

/**
 * 主取证流程：
 * 1 文件头真伪  2 元数据/EXIF  3 编辑软件痕迹  4 格式与扩展名一致性
 * 5 图像结构分析（ELA 近似 / 纹理 / 尺寸）  6 OCR 内容抽取
 */
export async function analyzeImage(filePath: string, opts: { declaredMime?: string; mime?: string } = {}): Promise<ForensicsResult> {
  const checks: CheckItem[] = []
  const stat = fs.statSync(filePath)
  const buf = fs.readFileSync(filePath)

  // 1. 文件头
  const actual = await sniffType(buf)
  const actualType = actual?.mime ?? null
  const declared = opts.mime ?? opts.declaredMime ?? null
  const typeMismatch = !!actualType && !!declared && actualType !== declared
  checks.push({
    key: 'filetype',
    label: '文件头校验',
    level: !actualType ? 'risk' : typeMismatch ? 'risk' : 'safe',
    detail: !actualType
      ? '无法识别的图像文件头，可能是伪造或损坏的文件'
      : typeMismatch
        ? `文件头为 ${actualType}，上传声明为 ${declared}，存在篡改嫌疑`
        : `文件头正常（${actualType}）`,
  })

  // 2. 图像基本信息 + 结构分析
  let width: number | undefined
  let height: number | undefined
  let format: string | undefined
  let mean = 0
  let texture = 0
  try {
    const img = sharp(buf)
    const meta = await img.metadata()
    width = meta.width
    height = meta.height
    format = meta.format
    const { data, info } = await sharp(buf).greyscale().resize(160, 160, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    mean = data.length ? sum / data.length : 0
    // 简易纹理度：相邻像素差均值
    let diff = 0
    const w = info.width
    for (let i = 1; i < data.length; i++) diff += Math.abs(data[i] - data[i - 1])
    texture = data.length ? diff / data.length : 0
    if (w > 0) {
      checks.push({
        key: 'dimension',
        label: '图像尺寸',
        level: width && height && Math.min(width, height) < 240 ? 'warn' : 'safe',
        detail:
          width && height && Math.min(width, height) < 240
            ? `分辨率偏低（${width}×${height}），截图可能被裁剪或二次截图`
            : `分辨率正常（${width}×${height}）`,
      })
    }
  } catch {
    checks.push({ key: 'decode', label: '图像解码', level: 'risk', detail: '图片无法正常解码（可能已损坏或被修改）' })
  }

  // 3. EXIF / 元数据
  const exif = await readMeta(filePath)
  const exifTime = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate ?? null
  const camera = [exif?.Make, exif?.Model].filter(Boolean).join(' ') || null
  const software = (exif?.Software as string) || null
  const hasExif = !!exif && Object.keys(exif).length > 0

  const editorHit = software
    ? EDITOR_SIGNS.find((s) => software.toLowerCase().includes(s))
    : null
  checks.push({
    key: 'exif',
    label: '元数据 / EXIF',
    level: hasExif ? 'safe' : 'warn',
    detail: hasExif
      ? `检测到元数据${camera ? `，设备：${camera}` : ''}${exifTime ? `，拍摄时间：${new Date(exifTime as string | number | Date).toLocaleString('zh-CN')}` : ''}`
      : '图片无任何 EXIF 元数据（截图或经社交软件转发后常见，本身不能证明伪造）',
  })

  checks.push({
    key: 'software',
    label: '编辑软件痕迹',
    level: editorHit ? 'risk' : 'safe',
    detail: editorHit ? `元数据中存在编辑软件标记：${software}` : '未发现 PS / 美图 等编辑软件写入的标记',
  })

  // 4. 加工链路：有编辑痕迹 + 无原始拍摄信息
  if (hasExif && !camera && software) {
    checks.push({
      key: 'chain',
      label: '加工链路',
      level: 'warn',
      detail: '存在软件写入记录但缺少设备信息，图片可能经过处理后再导出',
    })
  }

  // 5. OCR
  const ocrRes = await runOcr(filePath)
  const fields = ocrRes.available ? extractOcrFields(ocrRes.raw) : { serial: null, amount: null, time: null, keywords: [], text: '' }

  checks.push({
    key: 'ocr',
    label: 'OCR 内容识别',
    level: !ocrRes.available ? 'warn' : fields.keywords.length === 0 ? 'risk' : fields.keywords.length >= 2 ? 'safe' : 'warn',
    detail: !ocrRes.available
      ? 'OCR 引擎不可用，无法提取文字内容'
      : fields.keywords.length === 0
        ? '未能识别到「转账 / 支付 / 到账」等付款凭证关键词，可能不是付款截图'
        : `识别到 ${fields.keywords.length} 个付款关键词：${fields.keywords.slice(0, 6).join('、')}`,
  })

  checks.push({
    key: 'serial',
    label: '流水号识别',
    level: fields.serial ? 'safe' : 'warn',
    detail: fields.serial ? `识别到流水号：${fields.serial}` : '未能自动识别流水号，建议人工填写后做唯一性校验',
  })

  // 汇总
  let score = 0
  let level: Level = 'safe'
  for (const c of checks) {
    score += LEVEL_WEIGHT[c.level]
    level = worse(level, c.level)
  }
  score = Math.max(0, Math.min(100, 100 - score))

  return {
    level,
    score,
    checks,
    meta: {
      width,
      height,
      format,
      bytes: stat.size,
      hasExif,
      exifTime: exifTime ? new Date(exifTime as string | number | Date).toISOString() : null,
      camera,
      software,
      actualType,
      declaredType: declared,
      typeMismatch,
      mean: Number(mean.toFixed(2)),
      texture: Number(texture.toFixed(2)),
      fileCreatedAt: stat.birthtime.toISOString(),
    },
    ocr: {
      available: ocrRes.available,
      raw: (fields.text || '').slice(0, 2000),
      serial: fields.serial,
      amount: fields.amount,
      time: fields.time,
      keywords: fields.keywords,
    },
  }
}

/** 文件内容指纹（sha256），用于“同一张图是否已经提交过” */
export async function contentHash(filePath: string): Promise<string> {
  const crypto = await import('crypto')
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * 缩略图指纹（32×32 灰度），用于区分“结构相似但内容不同”的两张截图
 */
export async function thumbnail(filePath: string): Promise<number[]> {
  const { data } = await sharp(filePath)
    .greyscale()
    .resize(32, 32, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return Array.from(data)
}

/** 两张缩略图的平均绝对误差（0~255） */
export function thumbDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 999
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

/**
 * 内容特征：去掉顶部品牌栏 / 底部按钮条后缩放到 48×48 灰度
 * 用于判断「两张图像素级是否真的不同」（同模板不同内容也能区分）
 */
export async function contentPixels(filePath: string): Promise<number[]> {
  const meta = await sharp(filePath).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  let pipe = sharp(filePath).greyscale()
  if (W > 40 && H > 80) {
    const top = Math.round(H * 0.16)
    const bottom = Math.round(H * 0.06)
    pipe = pipe.extract({ left: 0, top, width: W, height: Math.max(1, H - top - bottom) })
  }
  const { data } = await pipe.resize(48, 48, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return Array.from(data)
}

/**
 * 两张图的最大像素差（0~255）
 * 单看这个指标区分度有限，需与 dHash 距离联合判断
 */
export function maxPixelDiff(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 255
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

/**
 * 感知哈希（16×16 = 256 位 dHash）
 * 用大网格降低“大面积纯色背景”带来的误判，只保留真正有纹理的结构
 */
export async function perceptualHash(filePath: string): Promise<string> {
  const N = 16
  const img = sharp(filePath).greyscale()
  const meta = await img.metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  // 去掉顶部品牌栏与底部按钮条（截图常见的大色块），再算结构特征
  const top = Math.round(H * 0.16)
  const bottom = Math.round(H * 0.06)
  let pipe = sharp(filePath).greyscale()
  if (W > 40 && H > 80) {
    pipe = pipe.extract({ left: 0, top, width: Math.max(1, W), height: Math.max(1, H - top - bottom) })
  }
  const { data } = await pipe
    .resize(N + 1, N, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let bits = ''
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const left = data[y * (N + 1) + x]
      const right = data[y * (N + 1) + x + 1]
      // 差值需超过阈值才计为 1，避免平坦区域噪声产生伪特征
      bits += right - left > 4 ? '1' : '0'
    }
  }
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** 汉明距离：越小越相似（0 表示几乎相同） */
/** 特征位里 1 的占比；过低说明图片结构过于平坦，哈希不可靠 */
export function bitDensity(hex: string): number {
  let ones = 0
  for (const ch of hex) {
    let v = parseInt(ch, 16)
    while (v) { ones += v & 1; v >>= 1 }
  }
  return ones / (hex.length * 4)
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 999
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

export const ensureDir = (p: string) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  return p
}

export const extOf = (p: string) => path.extname(p).toLowerCase()
