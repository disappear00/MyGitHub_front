import axios, { AxiosError } from 'axios'

import { clearAuthStorage, readAuthStorage, writeAuthStorage } from './authStorage'
import type { ApiResponse, TokenResponse } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:9000'

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
})

function getAccessToken(): string | null {
  return readAuthStorage()?.accessToken ?? null
}

function getRefreshToken(): string | null {
  return readAuthStorage()?.refreshToken ?? null
}

async function refreshToken(): Promise<TokenResponse | null> {
  const refresh = getRefreshToken()
  if (!refresh) return null

  const res = await axios.post<ApiResponse<TokenResponse>>(
    `${API_BASE_URL}/api/v1/auth/refresh`,
    { refresh_token: refresh },
    { timeout: 15000 },
  )

  if (res.data.code !== 200 || !res.data.data) return null
  return res.data.data
}

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as (typeof error.config & { _retried?: boolean }) | undefined
    if (!originalRequest) throw error

    const status = error.response?.status
    if (status !== 401 || originalRequest._retried) throw error
    originalRequest._retried = true

    try {
      const token = await refreshToken()
      if (!token) {
        clearAuthStorage()
        throw error
      }

      const current = readAuthStorage()
      if (current) {
        writeAuthStorage({
          ...current,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
        })
      }

      originalRequest.headers = originalRequest.headers ?? {}
      originalRequest.headers.Authorization = `Bearer ${token.access_token}`
      return http(originalRequest)
    } catch {
      clearAuthStorage()
      throw error
    }
  },
)

