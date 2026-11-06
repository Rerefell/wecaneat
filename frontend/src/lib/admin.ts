import { create } from 'zustand'
import axios from 'axios'

const TOKEN_KEY = 'admin_token'

/**
 * 团长登录状态
 * - token 存在 localStorage，请求时通过 axios 拦截器带上
 * - 网站浏览（批次、成员、金额）完全公开，无需登录
 * - 只有导入 / 删除 / 修改等管理操作要求已登录
 */
interface AdminState {
  token: string | null
  loginOpen: boolean
  setToken: (t: string | null) => void
  openLogin: () => void
  closeLogin: () => void
  logout: () => void
}

export const useAdmin = create<AdminState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  loginOpen: false,
  setToken: (t) => {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
    set({ token: t, loginOpen: false })
  },
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null })
  },
}))

/** 供 axios 拦截器读取 */
export const getToken = () => localStorage.getItem(TOKEN_KEY)

/** 判断错误是否为“需要登录” */
export const isAuthError = (e: unknown) =>
  axios.isAxiosError(e) && e.response?.status === 401
