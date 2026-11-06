import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Upload, ImageIcon, Trash2, Loader2, CheckCircle2, CircleDashed, X,
  ZoomIn, Wallet, Weight, Package, Receipt as ReceiptIcon, StickyNote, Phone,
  ShieldCheck, ShieldAlert, Hash, ChevronDown, ChevronUp, Lock,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, money, grams, type MemberDetailData, type Receipt } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api-client'
import { ForensicsPanel, LevelBadge } from '@/components/ForensicsPanel'
import { useAdmin } from '@/lib/admin'

export default function MemberDetail() {
  const { id, name = '' } = useParams()
  const bid = Number(id)
  const qc = useQueryClient()
  const { token } = useAdmin()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<Receipt | null>(null)
  const [remark, setRemark] = useState('')
  const [contact, setContact] = useState('')
  const [serialInput, setSerialInput] = useState('')
  const [showSerialForm, setShowSerialForm] = useState(false)
  const [lastResult, setLastResult] = useState<Receipt | null>(null)

  const { data, isLoading } = useQuery<MemberDetailData>({
    queryKey: ['member', bid, name],
    queryFn: () => api.getMember(bid, name),
    enabled: !!bid && !!name,
  })

  useEffect(() => {
    if (data) {
      setRemark(data.member.remark ?? '')
      setContact(data.member.contact ?? '')
    }
  }, [data])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['member', bid, name] })
    qc.invalidateQueries({ queryKey: ['members', bid] })
    qc.invalidateQueries({ queryKey: ['batch', bid] })
    qc.invalidateQueries({ queryKey: ['batches'] })
  }

  const upload = useMutation({
    mutationFn: async ({ files, serialNo }: { files: File[]; serialNo?: string }) => {
      let last: Receipt | null = null
      for (const f of files) {
        last = await api.uploadReceipt(bid, name, f, { serialNo })
      }
      return last
    },
    onSuccess: (r) => {
      if (!r) return
      setLastResult(r)
      const firstIssue = r.checks?.filter((c) => c.level !== 'safe').map((c) => c.detail)[0]
      if (r.level === 'risk') {
        toast.error(`上传成功，但校验发现风险（可信度 ${r.score}/100）`, { description: firstIssue, duration: 8000 })
      } else if (r.level === 'warn') {
        toast.warning(`上传成功，存在存疑项（可信度 ${r.score}/100）`, { description: firstIssue, duration: 6000 })
      } else {
        toast.success('截图已上传，校验通过', {
          description: r.serialNo ? `流水号 ${r.serialNo} 全库唯一` : undefined,
        })
      }
      refresh()
    },
    onError: (e) => {
      const msg = getErrorMessage(e)
      toast.error(msg.includes('流水号已存在') ? '流水号重复，已拒绝提交' : '上传失败', {
        description: msg,
        duration: 8000,
      })
    },
  })

  const delReceipt = useMutation({
    mutationFn: (rid: number) => api.deleteReceipt(bid, name, rid),
    onSuccess: () => { toast.success('截图已删除'); setLightbox(null); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateMember(bid, name, body),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  if (isLoading || !data) {
    return <div className="space-y-4"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
  }

  const { member, items, summary, receipts } = data
  const paidAmount = member.paidAmount ?? summary.amount
  const diff = Number((paidAmount - summary.amount).toFixed(2))
  const riskCount = receipts.filter((r) => r.level === 'risk').length
  const warnCount = receipts.filter((r) => r.level === 'warn').length

  return (
    <div className="space-y-5">
      <Link
        to={`/batches/${bid}`}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {data.batch.name}
      </Link>

      {/* 头部 */}
      <section className="card-surface overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className={cn(
                'grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-semibold',
                member.paid
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25'
              )}
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
                {member.paid ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> 已付款
                  </span>
                ) : riskCount > 0 ? (
                  <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                    <ShieldAlert className="h-3 w-3" /> 待核实
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    <CircleDashed className="h-3 w-3" /> 待付款
                  </span>
                )}
                {riskCount > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                    {riskCount} 张截图有风险
                  </span>
                )}
                {riskCount === 0 && warnCount > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                    {warnCount} 张存疑
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.lineCount} 条记录 · {summary.qty} 件 · {summary.totalWeight} g · 单价 ¥{data.batch.ratePerG}/g
              </p>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-[11px] text-muted-foreground">应付金额</p>
            <p className="num text-2xl font-semibold tracking-tight text-indigo-600 dark:text-indigo-400">
              {money(summary.amount)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border/70 border-t border-border sm:grid-cols-4">
          <Mini icon={<Package className="h-3.5 w-3.5" />} label="件数" value={`${summary.qty} 件`} />
          <Mini icon={<Weight className="h-3.5 w-3.5" />} label="总克重" value={grams(summary.totalWeight)} />
          <Mini icon={<ReceiptIcon className="h-3.5 w-3.5" />} label="国际运费" value={money(summary.intlFee)} />
          <Mini icon={<Wallet className="h-3.5 w-3.5" />} label="调价" value={summary.adjust ? `+${money(summary.adjust)}` : '—'} warn={summary.adjust > 0} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {/* 明细 */}
        <section className="card-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">购买明细</h2>
            <span className="text-[11px] text-muted-foreground">{items.length} 行</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">商品 / 柄</th>
                  <th className="px-2 py-2 text-left font-medium">角色</th>
                  <th className="px-2 py-2 text-right font-medium">个数</th>
                  <th className="px-2 py-2 text-right font-medium">单件克重</th>
                  <th className="px-2 py-2 text-right font-medium">运费</th>
                  <th className="px-2 py-2 text-right font-medium">调价</th>
                  <th className="px-3 py-2 text-right font-medium">小计</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                    <td className="max-w-[180px] px-3 py-2.5">
                      <p className="truncate font-medium">{it.product}</p>
                      {it.handleNo && <p className="text-[10px] text-muted-foreground">#{it.handleNo}</p>}
                    </td>
                    <td className="max-w-[150px] px-2 py-2.5 text-[11px] text-muted-foreground">
                      <span className="line-clamp-2">{it.characters || '—'}</span>
                    </td>
                    <td className="num px-2 py-2.5 text-right">{it.qty}</td>
                    <td className="num px-2 py-2.5 text-right" title={`总重 ${it.qty} × ${it.unitG}g = ${it.totalG}g`}>
                      {it.unitG}
                    </td>
                    <td className="num px-2 py-2.5 text-right">{it.intlFee.toFixed(2)}</td>
                    <td className={cn('num px-2 py-2.5 text-right', it.adjust > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                      {it.adjust ? `+${it.adjust.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className="num px-3 py-2.5 text-right font-semibold"
                      title={it.formula ? `公式：${it.formula} = ${it.intlFee.toFixed(2)}${it.adjust ? ` + 调价 ${it.adjust.toFixed(2)}` : ''}` : undefined}
                    >
                      {it.total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 text-[11px]">
                  <td className="px-3 py-2.5 font-medium" colSpan={2}>合计</td>
                  <td className="num px-2 py-2.5 text-right">{summary.qty}</td>
                  <td className="num px-2 py-2.5 text-right" title="总克重">
                    {summary.totalWeight}
                  </td>
                  <td className="num px-2 py-2.5 text-right">{summary.intlFee.toFixed(2)}</td>
                  <td className="num px-2 py-2.5 text-right">{summary.adjust ? `+${summary.adjust.toFixed(2)}` : '—'}</td>
                  <td className="num px-3 py-2.5 text-right text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {summary.amount.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
            小计 = 个数 × <b>单件克重</b>（E列，未乘数量）× 每克单价（¥{data.batch.ratePerG}/g，向上取整到分）+ 调价。悬停“单件克重”看总重，悬停“小计”看该行算式
          </p>
        </section>

        {/* 截图 + 校验 */}
        <div className="space-y-5">
          <section className="card-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-indigo-500" /> 付款凭证与校验
              </h2>
              <div className="flex items-center gap-2">
                <Label htmlFor="paid" className="text-[11px] text-muted-foreground">
                  {member.paid ? '已付款' : riskCount > 0 ? '待核实' : '待付款'}
                </Label>
                <Switch
                  id="paid"
                  checked={member.paid}
                  onCheckedChange={(v) => patch.mutate({ paid: v, paidAmount: v ? summary.amount : null })}
                />
              </div>
            </div>

            {/* 上传区 */}
            <div className="px-4 pt-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragging(false)
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
                  if (files.length) upload.mutate({ files, serialNo: serialInput || undefined })
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition',
                  dragging
                    ? 'border-indigo-400 bg-indigo-50/70 dark:bg-indigo-500/10'
                    : 'border-border hover:border-indigo-300 hover:bg-muted/40'
                )}
              >
                {upload.isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                ) : (
                  <Upload className="h-6 w-6 text-indigo-500" strokeWidth={1.7} />
                )}
                <p className="text-[12px] font-medium">
                  {upload.isPending ? '校验中…' : '上传付款截图'}
                </p>
                <p className="text-[10px] text-muted-foreground">点击或拖拽 · 自动真实性校验 + 流水号查重</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) upload.mutate({ files, serialNo: serialInput || undefined })
                    e.target.value = ''
                  }}
                />
              </div>

              {/* 流水号输入 */}
              <div className="mt-2.5">
                <button
                  onClick={() => setShowSerialForm((v) => !v)}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition hover:bg-muted/50"
                >
                  <Hash className="h-3 w-3 shrink-0" />
                  <span className="flex-1 truncate">
                    {serialInput || '填写流水号（可选，不填自动 OCR 识别）'}
                  </span>
                  {showSerialForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showSerialForm && (
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      value={serialInput}
                      onChange={(e) => setSerialInput(e.target.value)}
                      placeholder="例如 4200002981202601058877665544"
                      className="h-8 text-[11px]"
                      autoFocus
                    />
                    <button
                      onClick={() => setShowSerialForm(false)}
                      className="shrink-0 rounded-md bg-indigo-600 px-2.5 text-[11px] text-white hover:bg-indigo-700"
                    >
                      确定
                    </button>
                  </div>
                )}
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  同一流水号全库只能提交一次，重复会被拒绝并标记为高风险。
                </p>
              </div>
            </div>

            {/* 最近一次校验：仅团长可见明细 */}
            {lastResult && !token && (
              <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/25 p-2.5">
                <LevelBadge level={lastResult.level} score={lastResult.score} />
                <p className="text-[11px] text-muted-foreground">
                  截图已上传，团长会在后台核对内容
                </p>
                <button onClick={() => setLastResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {lastResult && token && (
              <div className="mx-4 mt-3 rounded-xl border border-border bg-muted/25 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-semibold">最近一次校验结果</p>
                  <button onClick={() => setLastResult(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <ForensicsPanel r={lastResult} />
              </div>
            )}

            {/* 截图列表 */}
            <div className="p-4">
              {!token && receipts.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="text-[10.5px] leading-relaxed text-muted-foreground">
                      <p className="font-medium text-foreground">截图仅团长可见</p>
                      <p>已上传 {receipts.length} 张凭证，{receipts.filter((r) => r.level === 'safe').length} 张通过校验。
                        如需查看或核对截图内容，请联系团长。</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {receipts.map((r) => (
                      <div
                        key={r.id}
                        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted/40 text-muted-foreground/60"
                      >
                        <Lock className="h-4 w-4" />
                        <span className="text-[9px]">已上传</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : receipts.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-5 text-center">
                  <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
                  <p className="text-[11px] text-muted-foreground">还没有上传凭证</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {receipts.map((r) => {
                    const issue = r.checks?.find((c) => c.level === 'risk')
                    return (
                      <div
                        key={r.id}
                        className={cn(
                          'rounded-xl border bg-background p-2',
                          r.level === 'risk'
                            ? 'border-rose-200 dark:border-rose-500/30'
                            : r.level === 'warn'
                              ? 'border-amber-200 dark:border-amber-500/30'
                              : 'border-border'
                        )}
                      >
                        <div className="flex gap-2">
                          <button
                            onClick={() => setLightbox(r)}
                            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                          >
                            <img src={r.url} alt={r.fileName} className="h-full w-full object-cover" />
                            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                              <ZoomIn className="h-4 w-4 text-white" />
                            </span>
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <LevelBadge level={r.level} score={r.score} />
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(r.createdAt).toLocaleString('zh-CN', {
                                  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                                })}
                              </span>
                              <button
                                onClick={() => { if (confirm('删除这张截图？')) delReceipt.mutate(r.id) }}
                                className="ml-auto rounded p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                            <p className="num mt-0.5 truncate text-[11px]">
                              {r.serialNo ? (
                                `流水号 ${r.serialNo}`
                              ) : (
                                <span className="text-amber-600">未识别到流水号</span>
                              )}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {r.amount !== null ? `¥${r.amount.toFixed(2)}` : '金额未识别'}
                              {issue ? ` · ${issue.detail}` : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {receipts.length > 0 && (
              <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-[11px]">
                <span className="text-muted-foreground">实收</span>
                <span className="num font-semibold text-emerald-600">{money(paidAmount)}</span>
                <span className="flex-1" />
                {diff !== 0 && (
                  <span className={cn('text-[10px]', diff > 0 ? 'text-amber-600' : 'text-rose-600')}>
                    {diff > 0 ? '多收' : '少收'} {money(Math.abs(diff))}
                  </span>
                )}
              </div>
            )}
          </section>

          <section className="card-surface space-y-3 p-4">
            <h2 className="text-sm font-semibold">备注信息</h2>
            <div className="space-y-1.5">
              <Label htmlFor="contact" className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Phone className="h-3 w-3" /> 联系方式
              </Label>
              <Input
                id="contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                onBlur={() => contact !== (member.contact ?? '') && patch.mutate({ contact })}
                placeholder="微信号 / 手机号"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remark" className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <StickyNote className="h-3 w-3" /> 备注
              </Label>
              <Textarea
                id="remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                onBlur={() => remark !== (member.remark ?? '') && patch.mutate({ remark })}
                placeholder="例如：已转 20 元，余款下次补"
                rows={3}
                className="text-xs"
              />
            </div>
          </section>
        </div>
      </div>

      {/* 放大 + 取证明细 */}
      {lightbox && token && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute right-5 top-5 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-2xl bg-card p-3 shadow-2xl sm:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-1 items-center justify-center overflow-auto rounded-xl bg-black/40 p-2">
              <img src={lightbox.url} alt={lightbox.fileName} className="max-h-[76vh] rounded-lg object-contain" />
            </div>
            <div className="w-full shrink-0 overflow-y-auto sm:w-[320px]">
              <p className="mb-2 text-xs font-semibold">真实性校验明细</p>
              <ForensicsPanel r={lightbox} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Mini({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-4 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{icon}{label}</p>
      <p className={cn('num mt-0.5 text-[13px] font-semibold', warn && 'text-amber-600')}>{value}</p>
    </div>
  )
}
