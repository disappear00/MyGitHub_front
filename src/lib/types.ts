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
  is_superuser?: boolean
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
  is_superuser?: boolean
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

export type PermissionEffect = 'ALLOW' | 'DENY'
export type PermissionScope = 'SELF' | 'SUBTREE'

export type PermissionResponse = {
  permission_id: number
  code: string
  name: string
  description: string | null
  category: string
  is_assignable: boolean
  created_at: string
  updated_at: string
}

export type GroupPermissionItem = {
  permission_code: string
  effect: PermissionEffect
  scope: PermissionScope
  scope_group_id: number | null
}

export type GroupPermissionDirectResponse = {
  principal_group_id: number
  items: GroupPermissionItem[]
}

export type GroupPermissionUpdateRequest = {
  items: GroupPermissionItem[]
}

export type MyPermissionsResponse = {
  permissions: string[]
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ChatRequest = {
  messages: ChatMessage[]
}

export type ChatResponse = {
  content: string
}

export type AIModelResponse = {
  model_id: number
  group_id: number
  created_by_user_id: number
  is_private: boolean
  created_at: string
  updated_at: string

  name: string
  provider: string
  model_kind: string
  base_url: string | null
  credential_ref: string | null
  description: string | null
  config: Record<string, unknown>
}

export type AIModelCreate = {
  name: string
  provider: string
  model_kind: string
  base_url?: string | null
  credential_ref?: string | null
  description?: string | null
  config?: Record<string, unknown>
  group_id?: number | null
  is_private?: boolean
}

export type AIModelUpdate = Partial<Omit<AIModelCreate, 'group_id'>> & {
  is_private?: boolean
}

export type KnowledgeBaseResponse = {
  kb_id: number
  group_id: number
  created_by_user_id: number
  is_private: boolean
  created_at: string
  updated_at: string

  name: string
  description: string | null
  embedding_model_id: number | null
  config: Record<string, unknown>
}

export type KnowledgeBaseCreate = {
  name: string
  description?: string | null
  embedding_model_id?: number | null
  config?: Record<string, unknown>
  group_id?: number | null
  is_private?: boolean
}

export type KnowledgeBaseUpdate = Partial<Omit<KnowledgeBaseCreate, 'group_id'>>

export type KBDocumentResponse = {
  document_id: number
  kb_id: number
  file_name: string
  source_type: string
  status: string
  meta: Record<string, unknown>
  group_id: number
  created_by_user_id: number
  is_private: boolean
  created_at: string
  updated_at: string
}

export type IngestResponse = {
  document: KBDocumentResponse
  chunk_count: number
}

export type KBQueryRequest = {
  query: string
  top_k?: number
}

export type KBChunkHit = {
  chunk_id: number
  document_id: number
  chunk_index: number
  content: string
  score: number
  meta: Record<string, unknown>
}

export type KBQueryResponse = {
  kb_id: number
  query: string
  hits: KBChunkHit[]
}

export type AgentResponse = {
  agent_id: number
  group_id: number
  created_by_user_id: number
  is_private: boolean
  created_at: string
  updated_at: string

  name: string
  description: string | null
  system_prompt: string | null
  model_id: number | null
  config: Record<string, unknown>
}

export type AgentCreate = {
  name: string
  description?: string | null
  system_prompt?: string | null
  model_id?: number | null
  config?: Record<string, unknown>
  group_id?: number | null
  is_private?: boolean
}

export type AgentUpdate = Partial<Omit<AgentCreate, 'group_id'>>

export type AgentChatRequest = {
  conversation_id?: number | null
  messages: ChatMessage[]
  kb_ids?: number[] | null
  rag_top_k?: number
  max_tool_rounds?: number
  max_history_messages?: number
}

export type AgentChatResponse = {
  conversation_id: number
  content: string
  meta: Record<string, unknown>
}
