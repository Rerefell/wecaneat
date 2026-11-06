import {
  ShieldCheck, AlertTriangle, ShieldAlert, Hash, Copy, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { money, type Receipt } from '@/lib/api'

export const levelMeta = {
  safe: { label: '通过', icon: ShieldCheck, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-500/30' },
  warn: { label: '存疑', icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-500/15 dark:text-amber-300', ring: 'ring-amber-200 dark:ring-amber-500/30' },
  risk: { label: '高风险', icon: ShieldAlert, cls: 'text-rose-600 bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300', ring: 'ring-rose-200 dark:ring-rose-500/30' },
} as const

/** 截图卡片上的等级徽标 */
export function LevelBadge({ level, score, compact }: { level?: string; score?: number; compact?: boolean }) {
  const m = levelMeta[(level as keyof typeof levelMeta) ?? 'safe'] ?? levelMeta.safe
  const Icon = m.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
        m.cls
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {m.label}
      {!compact && score !== undefined && <span className="num opacity-70">{score}</span>}
    </span>
  )
}

/** 取证明细面板 */
export function ForensicsPanel({ r }: { r: Receipt }) {
  const checks = r.checks ?? []
  const m = levelMeta[(r.level as keyof typeof levelMeta) ?? 'safe'] ?? levelMeta.safe
  const Icon = m.icon
  const meta = r.meta
  const unsafed = checks.filter((c) => c.level !== 'safe')

  return (
    <div className="space-y-2.5">
      <div className={cn('flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1', m.cls, m.ring)}>
        <Icon className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold">校验结论：{m.label}（可信度 {r.score ?? 100}/100）</p>
          <p className="text-[10px] opacity-80">
            {unsafed.length === 0 ? '未发现异常特征' : `${unsafed.length} 项需关注`}
          </p>
        </div>
      </div>

      {r.serialNo && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="num truncate text-[11px] font-medium">{r.serialNo}</span>
          <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
            {r.serialSource === 'manual' ? '手填' : 'OCR'}
          </span>
          <CopySerial text={r.serialNo} />
        </div>
      )}

      <ul className="space-y-1">
        {checks.map((c) => {
          const cm = levelMeta[c.level] ?? levelMeta.safe
          const CI = cm.icon
          return (
            <li key={c.key} className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] hover:bg-muted/50">
              <CI className={cn('mt-0.5 h-3 w-3 shrink-0', c.level === 'risk' ? 'text-rose-500' : c.level === 'warn' ? 'text-amber-500' : 'text-emerald-500')} />
              <span className="shrink-0 font-medium">{c.label}</span>
              <span className="flex-1 text-muted-foreground">{c.detail}</span>
            </li>
          )
        })}
      </ul>

      {meta && (
        <details className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">技术参数</summary>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>格式：{meta.format ?? '—'}</span>
            <span>尺寸：{meta.width}×{meta.height}</span>
            <span>大小：{((meta.bytes ?? 0) / 1024).toFixed(1)} KB</span>
            <span>EXIF：{meta.hasExif ? '有' : '无'}</span>
            {meta.software && <span className="col-span-2">软件：{meta.software}</span>}
            {meta.camera && <span className="col-span-2">设备：{meta.camera}</span>}
          </div>
        </details>
      )}
    </div>
  )
}

function CopySerial({ text }: { text: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      title="复制流水号"
    >
      <Copy className="h-3 w-3" />
    </button>
  )
}

export function ReadonlyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-2">
      <Lock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        该截图已通过校验。若需修改流水号或复核，请在截图上传处重新提交。
      </p>
    </div>
  )
}

export const moneyText = money
