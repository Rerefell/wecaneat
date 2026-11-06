import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Moon, Sun, LifeBuoy, Lock, ShieldCheck, LogOut } from 'lucide-react';
import { useAdmin } from '@/lib/admin';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const loc = useLocation()
  const { token, openLogin, logout, loginOpen } = useAdmin();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="group flex items-center">
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold tracking-tight">什么都吃一口</span>
              <span className="text-[11px] text-muted-foreground">国际运费</span>
            </span>
          </Link>
          <div className="flex-1" />
          <a
            href="#help"
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground sm:flex"
          >
            <LifeBuoy className="h-3.5 w-3.5" />
            计费说明
          </a>
          {token ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 sm:flex">
                <ShieldCheck className="h-3.5 w-3.5" />
                团长模式
              </span>
              <button
                onClick={() => {
                  if (confirm('确认退出团长模式？退出后需要重新输入口令。')) logout()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="退出团长模式"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出
              </button>
            </div>
          ) : (
            <button
              onClick={openLogin}
              disabled={loginOpen}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Lock className="h-3.5 w-3.5" />
              团长登录
            </button>
          )}
          <button
            onClick={() => setDark((d) => !d)}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-lg border border-border/70 text-muted-foreground',
              'transition hover:bg-muted hover:text-foreground'
            )}
            aria-label="切换主题"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>
      <main ref={scroller} className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer id="help" className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-[11px] leading-relaxed text-muted-foreground sm:px-6">
        计费规则：国际运费 = 总克重 × 每克单价（默认 0.12 元/g），再叠加调价（补件、加包装等）。
        表格导入后按成员名自动合并同一人多笔记录，金额四舍五入向上取整到分。
      </footer>
    </div>
  );
}
