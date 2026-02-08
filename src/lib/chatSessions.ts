import type { ChatRole } from './types'

export type ChatSessionMessage = {
  role: Extract<ChatRole, 'system' | 'user' | 'assistant' | 'tool'>
  content: string
  meta?: Record<string, unknown>
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
      const msgsRaw = Array.isArray(s.messages) ? (s.messages as unknown[]) : []
      const msgs = msgsRaw
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
        .map((m) => {
          const role = m.role
          const content = m.content
          const at = m.at
          const meta = m.meta
          return {
            role:
              role === 'system' || role === 'user' || role === 'assistant' || role === 'tool'
                ? role
                : 'assistant',
            content: typeof content === 'string' ? content : '',
            meta: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined,
            at: typeof at === 'number' ? at : Date.now(),
          } as ChatSessionMessage
        })

      return {
        ...s,
        mode: 'agent' as const,
        modelId: undefined,
        kbIds: Array.isArray(s.kbIds) ? s.kbIds.filter((n) => typeof n === 'number') : [],
        messages: msgs,
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
