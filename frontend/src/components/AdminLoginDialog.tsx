import { useEffect, useState } from 'react'
import { Lock, Loader2, X, ShieldCheck, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, getErrorMessage } from '@/lib/api-client'
import { useAdmin } from '@/lib/admin'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function AdminLoginDialog() {
  const { loginOpen, closeLogin, setToken } = useAdmin()
  const [pwd, setPwd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loginOpen) {
      setPwd('')
      setError('')
    }
  }, [loginOpen])

  if (!loginOpen) return null

  const submit = async () => {
    if (!pwd) return setError('请输入口令')
    setLoading(true)
    setError('')
    try {
      const { data } = await apiClient.post('/admin/login', { password: pwd })
      setToken(data.token)
      toast.success('已进入团长后台')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="relative flex flex-col items-center gap-2 px-6 pt-6 text-center">
          <button
            onClick={closeLogin}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <Lock className="h-6 w-6" strokeWidth={2} />
          </span>
          <div>
            <h2 className="text-base font-semibold">团长后台</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              输入口令后可导入运费表、删除批次、修改资料
            </p>
          </div>
        </div>

        <div className="space-y-3 px-6 py-5">
          <Input
            type="password"
            value={pwd}
            autoFocus
            onChange={(e) => { setPwd(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="请输入团长口令"
            className="h-10 text-center tracking-widest"
          />
          {error && <p className="text-center text-[11px] text-destructive">{error}</p>}
          <Button
            onClick={submit}
            disabled={loading}
            className="w-full gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? '验证中…' : '进入后台'}
          </Button>
          <div className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
            <Eye className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              不登录也可以浏览所有人的运费明细，只是无法导入和删除。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
