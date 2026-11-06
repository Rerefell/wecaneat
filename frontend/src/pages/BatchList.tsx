import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Plus, Package, Users, Weight, Wallet, ChevronRight, Search, Layers, BadgeCheck, Clock,
} from 'lucide-react'
import { api, money, type BatchSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ImportDialog } from '@/components/ImportDialog'
import { useAdmin } from '@/lib/admin'
import { cn } from '@/lib/utils'

export default function BatchList() {
  const [open, setOpen] = useState(false)
  const { token, openLogin } = useAdmin()
  const requireLogin = () => {
    if (!token) { openLogin(); return false }
    return true
  }
  const startImport = () => { if (requireLogin()) setOpen(true) }
  const [kw, setKw] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['batches'], queryFn: api.listBatches })

  const list = (data ?? []).filter((b) => !kw || b.name.toLowerCase().includes(kw.toLowerCase()))
  const totals = (data ?? []).reduce(
    (acc, b) => ({
      amount: acc.amount + b.totalAmount,
      paid: acc.paid + b.paidAmount,
      weight: acc.weight + b.totalWeight,
      members: acc.members + b.memberCount,
    }),
    { amount: 0, paid: 0, weight: 0, members: 0 }
  )

  return (
    <div className="space-y-6">
      {/* Hero：仅团长后台（已登录）显示 */}
      {token && (
        <section className="relative overflow-hidden rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 px-6 py-7 text-white shadow-lg shadow-indigo-600/20">
        <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-20 left-1/3 h-52 w-52 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-medium tracking-wide text-indigo-100">日本拼团 · 运费结算台</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">国际运费台账</h1>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-indigo-100/90">
            导入做好的运费表格，按成员名查看每人的明细与应付金额，上传付款截图即可完成对账。
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              onClick={startImport}
              className="gap-1.5 bg-white text-indigo-700 shadow-sm hover:bg-white/90"
              size="sm"
            >
              <Plus className="h-4 w-4" /> 导入运费表
            </Button>
            <div className="flex items-center gap-5 text-[12px] text-indigo-100">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> {data?.length ?? 0} 个批次
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> {totals.members} 人次
              </span>
              <span className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> 累计 {money(totals.amount)}
              </span>
            </div>
          </div>
        </div>
      </section>
      )}

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">全部批次</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{list.length}</span>
        <div className="flex-1" />
        <div className="relative w-full max-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索批次名称"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="card-surface flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10">
            <Package className="h-6 w-6" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-sm font-medium">还没有运费批次</p>
            <p className="mt-1 text-xs text-muted-foreground">导入一张 Excel 运费表，即可开始管理</p>
          </div>
          <Button size="sm" onClick={startImport} className="gap-1.5">
            <Plus className="h-4 w-4" /> 导入运费表
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((b, i) => (
            <BatchCard key={b.id} batch={b} index={i} />
          ))}
        </div>
      )}

      <ImportDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function BatchCard({ batch: b, index }: { batch: BatchSummary; index: number }) {
  const { token } = useAdmin()
  const pct = b.memberCount ? Math.round((b.paidCount / b.memberCount) * 100) : 0
  const done = b.memberCount > 0 && b.paidCount === b.memberCount
  return (
    <Link
      to={`/batches/${b.id}`}
      style={{ animationDelay: `${index * 45}ms` }}
      className="group card-surface relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-indigo-300/70 hover:shadow-lg hover:shadow-indigo-500/8 stagger"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              {b.channel}
            </span>
            {done ? (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600">
                <BadgeCheck className="h-3 w-3" /> 已收齐
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" /> 待收 {b.memberCount - b.paidCount} 人
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate text-[15px] font-semibold tracking-tight group-hover:text-indigo-600">
            {b.name}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {new Date(b.createdAt).toLocaleDateString('zh-CN')} 导入 · {b.itemCount} 条明细
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
      </div>

      {/* 统计与收款进度：仅团长后台（已登录）显示 */}
      {token && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
            <Stat icon={<Users className="h-3 w-3" />} label="成员" value={`${b.memberCount} 人`} />
            <Stat icon={<Weight className="h-3 w-3" />} label="总重" value={`${b.totalWeight.toLocaleString()} g`} />
            <Stat icon={<Wallet className="h-3 w-3" />} label="总额" value={money(b.totalAmount)} accent />
          </div>

          <div className="mt-3.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">已收 {money(b.paidAmount)}</span>
              <span className={cn('font-medium', done ? 'text-emerald-600' : 'text-amber-600')}>
                待收 {money(b.pendingAmount)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', done ? 'bg-emerald-500' : 'bg-indigo-500')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </>
      )}
    </Link>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">{icon}{label}</p>
      <p className={cn('num mt-0.5 truncate text-[13px] font-semibold', accent && 'text-indigo-600 dark:text-indigo-400')}>
        {value}
      </p>
    </div>
  )
}
