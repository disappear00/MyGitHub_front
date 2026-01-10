import type { ChatRole } from './types'

export type ChatSessionMessage = {
  role: Extract<ChatRole, 'user' | 'assistant'>
  content: string
  at: number
}

export type ChatSessionMode = 'agent' | 'model'

export type ChatSession = {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  mode: ChatSessionMode

  agentId?: number
  modelId?: number
  kbIds: number[]

  conversationId?: number
  messages: ChatSessionMessage[]
  lastMeta?: Record<string, unknown>
}

const STORAGE_KEY = 'mg_front_chat_sessions_v1'

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadChatSessions(): ChatSession[] {
  const data = safeParseJson<unknown>(localStorage.getItem(STORAGE_KEY))
  if (!Array.isArray(data)) return []
  return data
    .filter((x): x is ChatSession => Boolean(x) && typeof x === 'object')
    .map((x) => x as ChatSession)
    .map((s) => {
      return {
        ...s,
        mode: 'agent' as const,
        modelId: undefined,
        kbIds: Array.isArray(s.kbIds) ? s.kbIds.filter((n) => typeof n === 'number') : [],
      }
    })
    .filter((s) => typeof s.id === 'string' && typeof s.createdAt === 'number' && typeof s.updatedAt === 'number')
    .slice(0, 100)
}

export function saveChatSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 100)))
}

export function createChatSession(
  init?: Partial<Pick<ChatSession, 'mode' | 'agentId' | 'modelId' | 'kbIds'>>,
): ChatSession {
  const now = Date.now()
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: '新对话',
    mode: init?.mode ?? 'agent',
    agentId: init?.agentId,
    modelId: init?.modelId,
    kbIds: init?.kbIds ?? [],
    conversationId: undefined,
    messages: [],
    lastMeta: undefined,
  }
}

export function upsertChatSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const next = [session, ...sessions.filter((s) => s.id !== session.id)]
  return next.slice(0, 100)
}

export function deleteChatSession(sessions: ChatSession[], id: string): ChatSession[] {
  return sessions.filter((s) => s.id !== id)
}
