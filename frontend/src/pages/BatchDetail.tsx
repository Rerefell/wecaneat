import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Search, Users, Weight, Wallet, CheckCircle2, CircleDashed, ImageIcon,
  ChevronRight, Download, Trash2, SlidersHorizontal, Package, Loader2, ShieldAlert, AlertTriangle, Pencil,

} from 'lucide-react'
import { toast } from 'sonner'
import { api, money, type MemberRow, type BatchDetailData } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api-client'
import { useAdmin } from '@/lib/admin'

const STATUS = [
  { value: 'all', label: '全部成员' },
  { value: 'unpaid', label: '未付款' },
  { value: 'pending-review', label: '待核实（有风险图）' },
  { value: 'paid', label: '已付款' },
  { value: 'with-receipt', label: '已上传截图' },
  { value: 'no-receipt', label: '缺截图' },
  { value: 'risk', label: '截图有风险' },
]

export default function BatchDetail() {
  const { id } = useParams()
  const bid = Number(id)
  const qc = useQueryClient()
  const nav = useNavigate()
  const { token, openLogin } = useAdmin()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [product, setProduct] = useState('all')
  const [sort, setSort] = useState('default')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const rename = useMutation({
    mutationFn: (name: string) => api.updateBatch(bid, { name }),
    onSuccess: () => {
      toast.success('批次名称已更新')
      setEditingName(false)
      qc.invalidateQueries({ queryKey: ['batch', bid] })
      qc.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const startEditName = () => {
    if (!batch) return
    setNameDraft(batch.name)
    setEditingName(true)
  }

  const { data: batch, isLoading: loadingBatch } = useQuery<BatchDetailData>({
    queryKey: ['batch', bid],
    queryFn: () => api.getBatch(bid),
    enabled: !!bid,
  })

  const { data: members, isLoading } = useQuery<MemberRow[]>({
    queryKey: ['members', bid],
    queryFn: () => api.listMembers(bid, {}),
    enabled: !!bid,
  })

  const filtered = useMemo(() => {
    let list = members ?? []
    if (q) {
      const kw = q.toLowerCase()
      list = list.filter((m) => m.name.toLowerCase().includes(kw) || m.products.some((p) => p.toLowerCase().includes(kw)))
    }
    if (product !== 'all') list = list.filter((m) => m.products.includes(product))
    if (status === 'paid') list = list.filter((m) => m.paid)
    else if (status === 'unpaid') list = list.filter((m) => !m.paid)
  else if (status === 'pending-review') list = list.filter((m) => !m.paid && (m.riskCount ?? 0) > 0)
    else if (status === 'with-receipt') list = list.filter((m) => m.receiptCount > 0)
    else if (status === 'no-receipt') list = list.filter((m) => m.receiptCount === 0)
    else if (status === 'risk') list = list.filter((m) => (m.riskCount ?? 0) > 0)
    if (sort === 'amount-desc') list = [...list].sort((a, b) => b.amount - a.amount)
    else if (sort === 'amount-asc') list = [...list].sort((a, b) => a.amount - b.amount)
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return list
  }, [members, q, status, product, sort])

  const filteredTotal = filtered.reduce((s, m) => s + m.amount, 0)

  const del = useMutation({
    mutationFn: () => api.deleteBatch(bid),
    onSuccess: () => {
      toast.success('批次已删除')
      qc.invalidateQueries({ queryKey: ['batches'] })
      nav('/')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const exportCsv = () => {
    const rows = filtered.length ? filtered : members ?? []
    const header = ['名字', '商品', '条数', '件数', '总克重', '国际运费', '调价', '应付', '付款状态', '截图数']
    const body = rows.map((m) => [
      m.name, m.products.join(' / '), m.lineCount, m.qty, m.totalWeight,
      m.intlFee.toFixed(2), m.adjust.toFixed(2), m.amount.toFixed(2),
      m.paid ? '已付款' : '未付款', m.receiptCount,
    ])
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${batch?.name ?? '运费表'}.csv`
    a.click()
  }

  if (loadingBatch) {
    return <div className="space-y-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
  }
  if (!batch) return <div className="py-20 text-center text-sm text-muted-foreground">批次不存在</div>

  const s = batch.stats
  const progress = s.memberCount ? Math.round((s.paidCount / s.memberCount) * 100) : 0

  return (
    <div className="space-y-5">
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-2">
        <Link to="/" className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> 批次列表
        </Link>
      </div>

      {/* 批次概览：仅团长后台（已登录）显示 */}
      {token && (
      <section className="card-surface overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                {batch.channel}
              </span>
              {batch.expectedKg ? <span className="text-[10px] text-muted-foreground">申报 {batch.expectedKg} kg</span> : null}
              <span className="text-[10px] text-muted-foreground">每克 ¥{batch.ratePerG}</span>
            </div>
            {token && !editingName ? (
              <h1
                className="group/name mt-1.5 flex cursor-pointer items-center gap-1.5 truncate text-lg font-semibold tracking-tight hover:text-indigo-600"
                onClick={startEditName}
                title="点击修改批次名称"
              >
                <span className="truncate">{batch.name}</span>
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover/name:opacity-100" />
              </h1>
            ) : token && editingName ? (
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameDraft.trim()) rename.mutate(nameDraft.trim())
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  className="h-8 max-w-md text-sm font-semibold"
                  autoFocus
                />
                <Button size="sm" className="h-8 gap-1" disabled={!nameDraft.trim() || rename.isPending} onClick={() => rename.mutate(nameDraft.trim())}>
                  {rename.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} 保存
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingName(false)}>取消</Button>
              </div>
            ) : (
              <h1 className="mt-1.5 truncate text-lg font-semibold tracking-tight">{batch.name}</h1>
            )}
            {batch.note && <p className="mt-0.5 text-xs text-muted-foreground">{batch.note}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {token && (
              <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> 导出 CSV
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={() => {
                if (!token) { openLogin(); return }
                if (confirm('删除该批次及其所有截图？此操作不可恢复。')) del.mutate()
              }}
            >
              {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              删除
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border/70 border-b border-border sm:grid-cols-5">
          <Metric icon={<Users className="h-3.5 w-3.5" />} label="成员" value={`${s.memberCount}`} unit="人" />
          <Metric icon={<Package className="h-3.5 w-3.5" />} label="件数" value={`${s.totalQty}`} unit="件" />
          <Metric icon={<Weight className="h-3.5 w-3.5" />} label="总克重" value={s.totalWeight.toLocaleString()} unit="g" />
          <Metric icon={<Wallet className="h-3.5 w-3.5" />} label="应收合计" value={money(s.totalAmount)} accent />
          <Metric
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="已收 / 待收"
            value={money(s.paidAmount)}
            unit={`待收 ${money(s.pendingAmount)}`}
            success
          />
        </div>

        <div className="flex items-center gap-3 px-5 py-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="num shrink-0 text-[11px] text-muted-foreground">
            {s.paidCount}/{s.memberCount} 已付款（{progress}%）
          </span>
        </div>
      </section>
      )}

      {/* 风险提示：仅团长后台（已登录）显示 */}
      {token && batch.verify && batch.verify.risk > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          <div className="text-[11px] leading-relaxed">
            <p className="font-semibold text-rose-700 dark:text-rose-300">
              本批次有 {batch.verify.risk} 张截图未通过真实性校验
            </p>
            <p className="text-rose-600/80 dark:text-rose-300/70">
              共 {batch.verify.total} 张凭证：通过 {batch.verify.safe} · 存疑 {batch.verify.warn} · 高风险 {batch.verify.risk}。
              建议点击对应成员核对流水号与金额。
            </p>
          </div>
          <button
            onClick={() => setStatus('risk')}
            className="ml-auto shrink-0 rounded-md bg-rose-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-rose-700"
          >
            只看风险
          </button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索成员名字或商品名…"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[124px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="商品" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部商品</SelectItem>
              {batch.products.map((p) => (
                <SelectItem key={p.product} value={p.product} className="text-xs">{p.product}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[118px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-xs">默认顺序</SelectItem>
              <SelectItem value="amount-desc" className="text-xs">金额从高到低</SelectItem>
              <SelectItem value="amount-asc" className="text-xs">金额从低到高</SelectItem>
              <SelectItem value="name" className="text-xs">按名字排序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 成员列表 */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-surface py-16 text-center text-sm text-muted-foreground">没有符合条件的成员</div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <SlidersHorizontal className="h-3 w-3" />
            共 {filtered.length} 位成员 · 合计 <span className="num font-semibold text-foreground">{money(filteredTotal)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {filtered.map((m, i) => (
              <MemberCard key={m.name} m={m} bid={bid} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Metric({
  icon, label, value, unit, accent, success,
}: { icon: React.ReactNode; label: string; value: string; unit?: string; accent?: boolean; success?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</p>
      <p className={cn('num mt-1 text-[15px] font-semibold', accent && 'text-indigo-600 dark:text-indigo-400', success && 'text-emerald-600')}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

function MemberCard({ m, bid, index }: { m: MemberRow; bid: number; index: number }) {
  const paid = m.paid
  const risk = (m.riskCount ?? 0) > 0
  return (
    <Link
      to={`/batches/${bid}/members/${encodeURIComponent(m.name)}`}
      style={{ animationDelay: `${Math.min(index, 20) * 22}ms` }}
      className={cn(
        'group card-surface stagger flex flex-col gap-1.5 p-2.5 transition',
        paid
          ? // 已付款：整卡置灰，弱化视觉，表示已处理完成
            'border-border/60 bg-muted/40 opacity-75 hover:opacity-100 hover:border-border hover:shadow-sm'
          : 'hover:-translate-y-0.5 hover:border-indigo-300/70 hover:shadow-md hover:shadow-indigo-500/8'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <p className={cn('min-w-0 truncate text-[13px] font-semibold tracking-tight', paid && 'text-muted-foreground')}>
              {m.name}
            </p>
            {paid ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground line-through decoration-muted-foreground/40">
                <CheckCircle2 className="h-2.5 w-2.5" /> 已付款
              </span>
            ) : risk ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-px text-[9px] font-medium text-rose-700 dark:bg-rose-500/25 dark:text-rose-300">
                <ShieldAlert className="h-2.5 w-2.5" /> 待核实
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-medium text-amber-700 dark:bg-amber-500/25 dark:text-amber-300">
                <CircleDashed className="h-2.5 w-2.5" /> 待付款
              </span>
            )}
          </div>
          <p className={cn('truncate text-[10px]', paid ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
            {m.products.length > 1 ? `${m.products[0]} 等${m.products.length}种` : m.products[0] || '—'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('num text-[13px] font-semibold', paid ? 'text-muted-foreground' : 'text-foreground')}>
            {money(m.amount)}
          </p>
          <p className="text-[9px] text-muted-foreground">{m.qty} 件 · {m.totalWeight}g</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
        {m.adjust > 0 && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5',
              paid
                ? 'bg-muted text-muted-foreground'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
            )}
          >
            调价 +{m.adjust.toFixed(2)}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <ImageIcon className="h-2.5 w-2.5" /> {m.receiptCount} 张
        </span>
        {risk && (
          <span className="flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
            <ShieldAlert className="h-2.5 w-2.5" /> {m.riskCount} 风险
          </span>
        )}
        {!risk && (m.warnCount ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <AlertTriangle className="h-2.5 w-2.5" /> {m.warnCount} 存疑
          </span>
        )}
        <span className="flex-1" />
        <ChevronRight className={cn('h-3 w-3 transition', paid ? 'text-muted-foreground/50' : 'text-muted-foreground group-hover:translate-x-0.5 group-hover:text-indigo-500')} />
      </div>
    </Link>
  )
}
