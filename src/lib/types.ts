export type ApiResponse<T> = {
  code: number
  message: string
  data: T | null
}

export type TokenResponse = {
  access_token: string
  token_type: 'bearer' | string
  expires_in: number
  refresh_token: string
  refresh_expires_in: number
}

export type UserLoginResponse = {
  user_id: number
  user_name: string
  email: string
  phone: string | null
  group_id: number | null
  created_at: string
}

export type AuthResponse = {
  token: TokenResponse
  user: UserLoginResponse
}

export type EmailVerifyStatusResponse = {
  email: string
  is_email_verified: boolean
  email_verified_at: string | null
}

export type UserResponse = {
  user_id: number
  user_name: string
  email: string
  phone: string | null
  id_card: string | null
  group_id: number | null
  is_active: boolean
  is_email_verified: boolean
  email_verified_at: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type GroupResponse = {
  group_id: number
  group_name: string
  parent_id: number | null
  sort_order: number
  created_at: string
  updated_at: string
  full_path: string | null
}

