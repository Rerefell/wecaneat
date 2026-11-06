import { apiClient } from './api-client'

export interface BatchSummary {
  id: number
  name: string
  channel: string
  expectedKg: number | null
  ratePerG: number
  note: string | null
  createdAt: string
  memberCount: number
  paidCount: number
  itemCount: number
  totalWeight: number
  totalAmount: number
  paidAmount: number
  pendingAmount: number
  riskCount: number
}

export interface BatchProduct {
  product: string
  memberCount: number
  qty: number
  totalWeight: number
  amount: number
}

export interface BatchDetailData {
  id: number
  name: string
  channel: string
  expectedKg: number | null
  ratePerG: number
  note: string | null
  sourceFile: string | null
  createdAt: string
  stats: {
    memberCount: number
    itemCount: number
    totalQty: number
    totalWeight: number
    totalAmount: number
    paidCount: number
    paidAmount: number
    pendingAmount: number
  }
  verify?: { total: number; safe: number; warn: number; risk: number }
  products: BatchProduct[]
}

export interface MemberRow {
  name: string
  lineCount: number
  qty: number
  totalWeight: number
  intlFee: number
  adjust: number
  amount: number
  products: string[]
  productCount: number
  paid: boolean
  paidAmount: number | null
  contact: string | null
  remark: string | null
  receiptCount: number
  riskCount: number
  warnCount: number
  okReceiptCount: number
}

export interface MemberItem {
  id: number
  handleNo: string | null
  product: string
  characters: string
  qty: number
  unitG: number
  totalG: number
  intlFee: number
  intlFeeStored?: number
  adjust: number
  total: number
  formula?: string | null
}

export type Level = 'safe' | 'warn' | 'risk'

export interface CheckItem {
  key: string
  label: string
  level: Level
  detail: string
}

export interface ReceiptMeta {
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
}

export interface Receipt {
  id: number
  url: string
  fileName: string
  size: number
  amount: number | null
  note: string | null
  createdAt: string
  serialNo: string | null
  serialSource: 'manual' | 'ocr' | null
  level: Level
  score: number
  checks: CheckItem[] | null
  meta: ReceiptMeta | null
  ocr: {
    available: boolean
    raw: string
    serial: string | null
    amount: number | null
    time: string | null
    keywords: string[]
  } | null
  reviewed: boolean
  reviewNote: string | null
  /** 非团长访问时为 true：仅知是否存在，不返回任何图片内容 */
  hidden?: boolean
}

export interface MemberDetailData {
  batch: { id: number; name: string; channel: string; ratePerG: number }
  member: { name: string; paid: boolean; paidAmount: number | null; contact: string; remark: string }
  items: MemberItem[]
  summary: {
    lineCount: number
    qty: number
    totalWeight: number
    intlFee: number
    adjust: number
    amount: number
  }
  receipts: Receipt[]
}

export interface ImportPreview {
  fileName: string
  ratePerG: number
  weightTotal: number
  feeTotal: number
  grandSum: number
  members: {
    name: string
    weight_total: number
    adjust_total: number
    grand_total: number
    rows: unknown[]
  }[]
}

export const api = {
  listBatches: async (): Promise<BatchSummary[]> => (await apiClient.get('/batches')).data,
  getBatch: async (id: number): Promise<BatchDetailData> => (await apiClient.get(`/batches/${id}`)).data,
  listMembers: async (
    id: number,
    params: { q?: string; status?: string; product?: string; sort?: string }
  ): Promise<MemberRow[]> => (await apiClient.get(`/batches/${id}/members`, { params })).data,
  getMember: async (id: number, name: string): Promise<MemberDetailData> =>
    (await apiClient.get(`/batches/${id}/members/${encodeURIComponent(name)}`)).data,
  updateMember: async (id: number, name: string, body: Record<string, unknown>) =>
    (await apiClient.patch(`/batches/${id}/members/${encodeURIComponent(name)}`, body)).data,
  uploadReceipt: async (
    id: number,
    name: string,
    file: File,
    opts: { amount?: string; note?: string; serialNo?: string } = {}
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    if (opts.amount) fd.append('amount', opts.amount)
    if (opts.note) fd.append('note', opts.note)
    if (opts.serialNo) fd.append('serialNo', opts.serialNo)
    return (
      await apiClient.post(`/batches/${id}/members/${encodeURIComponent(name)}/receipts`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      })
    ).data as Receipt
  },
  updateReceipt: async (id: number, name: string, rid: number, body: Record<string, unknown>) =>
    (await apiClient.patch(`/batches/${id}/members/${encodeURIComponent(name)}/receipts/${rid}`, body)).data as Receipt,
  deleteReceipt: async (id: number, name: string, rid: number) =>
    (await apiClient.delete(`/batches/${id}/members/${encodeURIComponent(name)}/receipts/${rid}`)).data,
  deleteBatch: async (id: number) => (await apiClient.delete(`/batches/${id}`)).data,
  updateBatch: async (id: number, body: Record<string, unknown>) =>
    (await apiClient.patch(`/batches/${id}`, body)).data,
  previewImport: async (file: File): Promise<ImportPreview> => {
    const fd = new FormData()
    fd.append('file', file)
    return (await apiClient.post('/import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    })).data
  },
  importFile: async (file: File, name: string, channel = '日本拼团', note?: string, ratePerG?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name)
    fd.append('channel', channel)
    if (note) fd.append('note', note)
    if (ratePerG) fd.append('rate_per_g', ratePerG)
    return (await apiClient.post('/import/parse', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })).data as { batchId: number }
  },
  appendFile: async (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return (await apiClient.post(`/import/batch/${id}/append`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })).data
  },
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const grams = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} g`
