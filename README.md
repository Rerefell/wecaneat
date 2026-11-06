日本拼团 · 国际运费系统
用于管理日本拼团的国际运费。普通成员可以查看批次、成员列表和自己的费用明细；
团长登录后可以导入表格、修改、删除、导出，以及核查付款截图的真实性。
技术栈
层
技术
前端
React 19 + Vite 7 + TypeScript + Tailwind CSS v4（frontend/）
后端
Express 4 + TypeScript（backend/）
数据库
PostgreSQL
截图取证
sharp + exifr + OCR 识别，流水号全库唯一校验
本地运行
1. 准备 PostgreSQL，创建一个名为 genie 的数据库。
2. 在 backend/ 下创建 .env 文件：
  NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://用户名:密码@localhost:5432/genie
ADMIN_PASSWORD=你的团长口令
3. 启动后端：cd backend && npm install && npm run dev
（表结构会在启动时自动创建）
4. 启动前端：cd frontend && npm install && npm run dev
前端默认跑在 http://localhost:5173，后端在 http://localhost:3000，
Vite 已配置 /api 代理转发到后端。
部署到常驻服务器
沙箱或本地电脑都会因为休眠 / 关机导致服务中断，正式使用建议部署到常驻平台：
- 后端 + 数据库：Railway / Render / Fly.io（Express 常驻进程）。
数据库也可以用 Neon 或 Supabase 的免费版，把 DATABASE_URL 指向它即可。
- 前端：Netlify / Vercel。构建命令 npm run build，发布目录 dist，
并添加单页应用重定向规则 /* -> /index.html。
- 环境变量：ADMIN_PASSWORD、DATABASE_URL。
- 截图文件：当前存在服务器本地磁盘。如果后端部署在 Serverless 平台，
需改用对象存储（S3 / 腾讯云 COS 等），因为本地磁盘在这些平台上不持久。
团长专属功能
需要输入口令登录后才会出现：
- 导入 Excel 运费表 / 新增批次
- 删除批次
- 点击批次名称直接改名
- 导出 CSV
- 查看截图取证结果（流水号、金额、重复图检测）
- 查看金额汇总、收款进度、风险提示
权限设计
公开可见（无需登录）
- 批次列表、各批次名称
- 成员列表、每位成员的商品与应付金额
- 付款状态标签
- 上传自己的付款截图
仅团长可见（登录后）
- 首页统计与收款进度条
- 批次概览（成员数、件数、总克重、应收合计、已收待收）
- 风险提示横幅与取证详情
- 他人上传的截图内容
- 导入、删除、改名、导出
计费规则
国际运费 = 件数 × 单件克重（E 列） × 每克单价
应付金额 = 国际运费 + 调价
金额四舍五入到分。导入时会按成员名自动合并同一个人的多笔记录。
目录结构
├── README.md
├── backend/
│   ├── src/
│   │   ├── app.ts            Express 应用与路由挂载
│   │   ├── db.ts             建表语句与数据库连接
│   │   ├── index.ts          启动入口
│   │   ├── config/           环境变量、日志
│   │   ├── middleware/       错误处理、日志、校验
│   │   ├── modules/          业务模块
│   │   │   ├── batches.ts    批次、成员、截图相关接口
│   │   │   ├── import.ts     Excel 解析与导入
│   │   │   ├── auth.ts       团长口令与令牌
│   │   │   ├── shortlink.ts  短链跳转
│   │   │   └── verify/       截图取证（OCR、哈希、元数据）
│   │   └── types/
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── App.tsx           路由配置
    │   ├── pages/            批次列表 / 批次详情 / 成员详情
    │   ├── components/       布局、导入弹窗、取证面板等
    │   ├── lib/              API 封装、登录状态、工具函数
    │   └── assets/
    ├── index.html
    ├── vite.config.ts
    └── package.json
上传到 GitHub
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
.env 文件没有打进压缩包，部署时通过平台的环境变量设置，
不要把 ADMIN_PASSWORD 提交到仓库里。
