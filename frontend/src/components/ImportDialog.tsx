import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UploadCloud, FileSpreadsheet, X, Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { api, money, type ImportPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/api-client'

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setFile(null); setName(''); setNote(''); setPreview(null); setParsing(false)
    }
  }, [open])

  const handleFile = async (f: File) => {
    setFile(f)
    if (!name) setName(f.name.replace(/\.(xlsx|xls|csv)$/i, ''))
    setParsing(true)
    try {
      const p = await api.previewImport(f)
      setPreview(p)
    } catch (e) {
      toast.error('解析失败：' + getErrorMessage(e))
      setFile(null)
    } finally {
      setParsing(false)
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请先选择表格文件')
      return api.importFile(file, name || file.name, '日本拼团', note || undefined)
    },
    onSuccess: (res) => {
      toast.success('导入成功')
      qc.invalidateQueries({ queryKey: ['batches'] })
      onClose()
      nav(`/batches/${res.batchId}`)
    },
    onError: (e) => toast.error('导入失败：' + getErrorMessage(e)),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">导入国际运费表</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              支持 .xlsx / .xls / .csv，自动识别「cn / 柄 / 角色 / 个数 / g / 国际金额 / 调价 / 总金额」等列
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault(); setDrag(false)
                const f = e.dataTransfer.files?.[0]
                if (f) handleFile(f)
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                drag ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10' : 'border-border hover:border-indigo-300 hover:bg-muted/40'
              }`}
            >
              <UploadCloud className="h-8 w-8 text-indigo-500" strokeWidth={1.6} />
              <p className="text-sm font-medium">点击选择或拖拽 Excel 文件到此处</p>
              <p className="text-xs text-muted-foreground">单个文件不超过 20MB</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                    {parsing && ' · 正在解析…'}
                  </p>
                </div>
                {parsing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                <button
                  onClick={() => { setFile(null); setPreview(null) }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {preview && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {[
                    { k: '成员数', v: `${preview.members.length} 人` },
                    { k: '总克重', v: `${preview.weightTotal.toLocaleString()} g` },
                    { k: '每克单价', v: `¥${preview.ratePerG}` },
                    { k: '合计金额', v: money(preview.grandSum) },
                  ].map((s) => (
                    <div key={s.k} className="rounded-xl border border-border bg-background px-3 py-2.5">
                      <p className="text-[11px] text-muted-foreground">{s.k}</p>
                      <p className="num mt-0.5 text-sm font-semibold">{s.v}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bname" className="text-xs">批次名称</Label>
                  <Input id="bname" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：25年秋日祭 熊耳系列 国际运费" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bnote" className="text-xs">备注（可选）</Label>
                  <Input id="bnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：汇率 0.048，含二次调价" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3.5">
          <p className="text-[11px] text-muted-foreground">导入后可继续上传每个人的付款截图</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button
              size="sm"
              disabled={!file || parsing || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {mutation.isPending ? '导入中…' : '确认导入'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
