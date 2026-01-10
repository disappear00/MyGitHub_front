import { defineStore } from 'pinia'

import { authApi, permissionApi } from '@/lib/api'
import { clearAuthStorage, readAuthStorage, writeAuthStorage, type AuthStorageState } from '@/lib/authStorage'
import type { UserLoginResponse } from '@/lib/types'

type AuthState = {
  inited: boolean
  accessToken: string | null
  refreshToken: string | null
  user: UserLoginResponse | null
  isEmailVerified: boolean | null
  emailVerifiedAt: string | null
  permissionCodes: string[] | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    inited: false,
    accessToken: null,
    refreshToken: null,
    user: null,
    isEmailVerified: null,
    emailVerifiedAt: null,
    permissionCodes: null,
  }),
  getters: {
    isAuthed: (s) => Boolean(s.accessToken && s.refreshToken && s.user),
    isSuperuser: (s) => Boolean(s.user?.is_superuser),
    hasPermission: (s) => {
      return (code: string) => Boolean(s.user?.is_superuser) || Boolean(s.permissionCodes?.includes(code))
    },
  },
  actions: {
    syncFromStorage() {
      const saved = readAuthStorage()
      if (saved) {
        this.accessToken = saved.accessToken
        this.refreshToken = saved.refreshToken
        this.user = saved.user
        this.isEmailVerified = saved.isEmailVerified ?? null
        this.emailVerifiedAt = saved.emailVerifiedAt ?? null
      } else {
        this.accessToken = null
        this.refreshToken = null
        this.user = null
        this.isEmailVerified = null
        this.emailVerifiedAt = null
      }
    },
    initFromStorage() {
      if (this.inited) return
      this.syncFromStorage()
      this.inited = true
    },
    persist() {
      if (!this.accessToken || !this.refreshToken || !this.user) return
      const payload: AuthStorageState = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        user: this.user,
        isEmailVerified: this.isEmailVerified ?? undefined,
        emailVerifiedAt: this.emailVerifiedAt ?? undefined,
      }
      writeAuthStorage(payload)
    },
    clear() {
      this.accessToken = null
      this.refreshToken = null
      this.user = null
      this.isEmailVerified = null
      this.emailVerifiedAt = null
      this.permissionCodes = null
      clearAuthStorage()
    },
    async login(user_name: string, password: string) {
      const data = await authApi.login({ user_name, password })
      this.accessToken = data.token.access_token
      this.refreshToken = data.token.refresh_token
      this.user = data.user
      this.permissionCodes = null
      this.persist()
      await this.refreshEmailStatus()
      await this.refreshPermissions()
    },
    async register(user_name: string, email: string, password: string, phone?: string | null) {
      const data = await authApi.register({ user_name, email, password, phone })
      this.accessToken = data.token.access_token
      this.refreshToken = data.token.refresh_token
      this.user = data.user
      this.isEmailVerified = false
      this.emailVerifiedAt = null
      this.permissionCodes = null
      this.persist()
      await this.refreshEmailStatus()
      await this.refreshPermissions()
    },
    async logout() {
      const refresh = this.refreshToken
      this.clear()
      if (refresh) {
        try {
          await authApi.logout({ refresh_token: refresh })
        } catch {
          // ignore
        }
      }
    },
    async refreshEmailStatus() {
      if (!this.accessToken) return
      try {
        const status = await authApi.emailStatus()
        this.isEmailVerified = status.is_email_verified
        this.emailVerifiedAt = status.email_verified_at
        this.persist()
      } catch {
        // ignore
      }
    },
    async refreshPermissions() {
      if (!this.accessToken) return
      try {
        const res = await permissionApi.myPermissions()
        this.permissionCodes = res.permissions
      } catch {
        this.permissionCodes = []
      }
    },
    async verifyEmailByToken(token: string) {
      const res = await authApi.verifyEmail({ token })
      this.isEmailVerified = res.is_email_verified
      this.emailVerifiedAt = res.email_verified_at
      this.persist()
    },
  },
})
