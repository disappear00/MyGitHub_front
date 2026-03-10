import { http } from './http'
import type {
  ApiResponse,
  AgentChatRequest,
  AgentChatResponse,
  AgentCreate,
  AgentResponse,
  AgentUpdate,
  AIModelCreate,
  AIModelResponse,
  AIModelUpdate,
  AuthResponse,
  ChatRequest,
  ChatResponse,
  EmailVerifyStatusResponse,
  GroupPermissionDirectResponse,
  GroupPermissionUpdateRequest,
  GroupResponse,
  IngestResponse,
  KBDocumentResponse,
  KBQueryRequest,
  KBQueryResponse,
  KBScrapeRequest,      // ← 添加这一行
  KBScrapeResponse, 
  KnowledgeBaseCreate,
  KnowledgeBaseResponse,
  KnowledgeBaseUpdate,
  McpToolInfo,
  MyPermissionsResponse,
  PermissionResponse,
  TokenResponse,
  UserResponse,
} from './types'

export class ApiBusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

function unwrap<T>(res: ApiResponse<T>): T {
  if (res.code === 200 && res.data !== null) return res.data
  throw new ApiBusinessError(res.code, res.message || '请求失败')
}

function unwrapVoid(res: ApiResponse<unknown>): void {
  if (res.code === 200) return
  throw new ApiBusinessError(res.code, res.message || '请求失败')
}

export const authApi = {
  async login(payload: { user_name: string; password: string }) {
    const res = await http.post<ApiResponse<AuthResponse>>('/api/v1/auth/login', payload)
    return unwrap(res.data)
  },
  async register(payload: { user_name: string; email: string; phone?: string | null; password: string }) {
    const res = await http.post<ApiResponse<AuthResponse>>('/api/v1/auth/register', payload)
    return unwrap(res.data)
  },
  async logout(payload: { refresh_token: string }) {
    const res = await http.post<ApiResponse<null>>('/api/v1/auth/logout', payload)
    return unwrapVoid(res.data)
  },
  async refresh(payload: { refresh_token: string }) {
    const res = await http.post<ApiResponse<TokenResponse>>('/api/v1/auth/refresh', payload)
    return unwrap(res.data)
  },
  async emailStatus() {
    const res = await http.get<ApiResponse<EmailVerifyStatusResponse>>('/api/v1/auth/email/status')
    return unwrap(res.data)
  },
  async resendVerifyEmail(payload: { email: string }) {
    const res = await http.post<ApiResponse<null>>('/api/v1/auth/email/resend', payload)
    return unwrapVoid(res.data)
  },
  async verifyEmail(payload: { token: string }) {
    const res = await http.post<
      ApiResponse<{ is_email_verified: boolean; email_verified_at: string | null }>
    >('/api/v1/auth/email/verify', payload)
    return unwrap(res.data)
  },
}

export const userApi = {
  async list(params?: { order_by_time?: boolean }) {
    const res = await http.get<ApiResponse<UserResponse[]>>('/api/v1/users', { params })
    return unwrap(res.data)
  },
  async create(payload: {
    user_name: string
    email: string
    phone?: string | null
    id_card?: string | null
    group_id?: number | null
    password: string
  }) {
    const res = await http.post<ApiResponse<UserResponse>>('/api/v1/users', payload)
    return unwrap(res.data)
  },
  async update(
    userId: number,
    payload: Partial<Omit<UserResponse, 'user_id' | 'created_at' | 'updated_at'>>,
  ) {
    const res = await http.put<ApiResponse<UserResponse>>(`/api/v1/users/${userId}`, payload)
    return unwrap(res.data)
  },
  async remove(userId: number) {
    const res = await http.delete<ApiResponse<null>>(`/api/v1/users/${userId}`)
    return unwrapVoid(res.data)
  },
}

export const groupApi = {
  async list(params?: { order_by_path?: boolean }) {
    const res = await http.get<ApiResponse<GroupResponse[]>>('/api/v1/groups/', { params })
    return unwrap(res.data)
  },
  async create(payload: { group_name: string; parent_id?: number | null; sort_order?: number }) {
    const res = await http.post<ApiResponse<GroupResponse>>('/api/v1/groups/', payload)
    return unwrap(res.data)
  },
  async update(
    groupId: number,
    payload: { group_name?: string; parent_id?: number | null; sort_order?: number },
  ) {
    const res = await http.put<ApiResponse<GroupResponse>>(`/api/v1/groups/${groupId}`, payload)
    return unwrap(res.data)
  },
  async remove(groupId: number) {
    const res = await http.delete<ApiResponse<null>>(`/api/v1/groups/${groupId}`)
    return unwrapVoid(res.data)
  },
}

export const permissionApi = {
  async listPermissions(params?: { assignable_only?: boolean }) {
    const res = await http.get<ApiResponse<PermissionResponse[]>>('/api/v1/permissions', { params })
    return unwrap(res.data)
  },
  async getGroupPermissions(groupId: number) {
    const res = await http.get<ApiResponse<GroupPermissionDirectResponse>>(
      `/api/v1/groups/${groupId}/permissions`,
    )
    return unwrap(res.data)
  },
  async replaceGroupPermissions(groupId: number, payload: GroupPermissionUpdateRequest) {
    const res = await http.put<ApiResponse<GroupPermissionDirectResponse>>(
      `/api/v1/groups/${groupId}/permissions`,
      payload,
    )
    return unwrap(res.data)
  },
  async myPermissions() {
    const res = await http.get<ApiResponse<MyPermissionsResponse>>('/api/v1/me/permissions')
    return unwrap(res.data)
  },
}

export const aiModelApi = {
  async list() {
    const res = await http.get<ApiResponse<AIModelResponse[]>>('/api/v1/models')
    return unwrap(res.data)
  },
  async get(modelId: number) {
    const res = await http.get<ApiResponse<AIModelResponse>>(`/api/v1/models/${modelId}`)
    return unwrap(res.data)
  },
  async create(payload: AIModelCreate) {
    const res = await http.post<ApiResponse<AIModelResponse>>('/api/v1/models', payload)
    return unwrap(res.data)
  },
  async update(modelId: number, payload: AIModelUpdate) {
    const res = await http.put<ApiResponse<AIModelResponse>>(`/api/v1/models/${modelId}`, payload)
    return unwrap(res.data)
  },
  async remove(modelId: number) {
    const res = await http.delete<ApiResponse<null>>(`/api/v1/models/${modelId}`)
    return unwrapVoid(res.data)
  },
  async chat(modelId: number, payload: ChatRequest, opts?: { stream?: boolean }) {
    const res = await http.post<ApiResponse<ChatResponse>>(`/api/v1/models/${modelId}/chat`, payload, {
      params: { stream: Boolean(opts?.stream) },
    })
    return unwrap(res.data)
  },
}

export const knowledgeBaseApi = {
  async list() {
    const res = await http.get<ApiResponse<KnowledgeBaseResponse[]>>('/api/v1/knowledge-bases')
    return unwrap(res.data)
  },
  async get(kbId: number) {
    const res = await http.get<ApiResponse<KnowledgeBaseResponse>>(`/api/v1/knowledge-bases/${kbId}`)
    return unwrap(res.data)
  },
  async create(payload: KnowledgeBaseCreate) {
    const res = await http.post<ApiResponse<KnowledgeBaseResponse>>('/api/v1/knowledge-bases', payload)
    return unwrap(res.data)
  },
  async update(kbId: number, payload: KnowledgeBaseUpdate) {
    const res = await http.put<ApiResponse<KnowledgeBaseResponse>>(`/api/v1/knowledge-bases/${kbId}`, payload)
    return unwrap(res.data)
  },
  async remove(kbId: number) {
    const res = await http.delete<ApiResponse<null>>(`/api/v1/knowledge-bases/${kbId}`)
    return unwrapVoid(res.data)
  },
  async listDocuments(kbId: number) {
    const res = await http.get<ApiResponse<KBDocumentResponse[]>>(`/api/v1/knowledge-bases/${kbId}/documents`)
    return unwrap(res.data)
  },
  async uploadDocument(kbId: number, file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await http.post<ApiResponse<IngestResponse>>(
      `/api/v1/knowledge-bases/${kbId}/documents`,
      form,
    )
    return unwrap(res.data)
  },
  async query(kbId: number, payload: KBQueryRequest) {
    const res = await http.post<ApiResponse<KBQueryResponse>>(
      `/api/v1/knowledge-bases/${kbId}/query`,
      payload,
    )
    return unwrap(res.data)
  },
  async scrapeWebContent(kbId: number, payload: KBScrapeRequest) {
    const res = await http.post<ApiResponse<KBScrapeResponse>>(
      `/api/v1/knowledge-bases/${kbId}/scrape`,
      payload,
    )
    return unwrap(res.data)
  },
}

export const mcpApi = {
  async listTools() {
    const res = await http.get<ApiResponse<McpToolInfo[]>>('/api/v1/mcp/tools')
    return unwrap(res.data)
  },
}

export const agentApi = {
  async list() {
    const res = await http.get<ApiResponse<AgentResponse[]>>('/api/v1/agents')
    return unwrap(res.data)
  },
  async get(agentId: number) {
    const res = await http.get<ApiResponse<AgentResponse>>(`/api/v1/agents/${agentId}`)
    return unwrap(res.data)
  },
  async create(payload: AgentCreate) {
    const res = await http.post<ApiResponse<AgentResponse>>('/api/v1/agents', payload)
    return unwrap(res.data)
  },
  async update(agentId: number, payload: AgentUpdate) {
    const res = await http.put<ApiResponse<AgentResponse>>(`/api/v1/agents/${agentId}`, payload)
    return unwrap(res.data)
  },
  async remove(agentId: number) {
    const res = await http.delete<ApiResponse<null>>(`/api/v1/agents/${agentId}`)
    return unwrapVoid(res.data)
  },
  async chat(agentId: number, payload: AgentChatRequest) {
    const res = await http.post<ApiResponse<AgentChatResponse>>(`/api/v1/agents/${agentId}/chat`, payload)
    return unwrap(res.data)
  },
}