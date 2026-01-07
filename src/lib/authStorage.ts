import type { UserLoginResponse } from './types'

export type AuthStorageState = {
  accessToken: string
  refreshToken: string
  user: UserLoginResponse
  isEmailVerified?: boolean
  emailVerifiedAt?: string | null
}

const STORAGE_KEY = 'mygithub.auth'

export function readAuthStorage(): AuthStorageState | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthStorageState
  } catch {
    return null
  }
}

export function writeAuthStorage(state: AuthStorageState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearAuthStorage(): void {
  localStorage.removeItem(STORAGE_KEY)
}

