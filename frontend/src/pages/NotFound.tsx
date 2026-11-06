import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div>
        <h1 className="text-lg font-semibold">页面不存在</h1>
        <p className="mt-1 text-xs text-muted-foreground">你访问的页面可能已被删除或地址有误</p>
      </div>
      <Button asChild size="sm" className="gap-1.5">
        <Link to="/">返回批次列表</Link>
      </Button>
    </div>
  )
}
