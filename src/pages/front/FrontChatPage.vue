<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'

import { agentApi, aiModelApi, knowledgeBaseApi } from '@/lib/api'
import { formatJson } from '@/lib/json'
import {
  createChatSession,
  deleteChatSession,
  loadChatSessions,
  saveChatSessions,
  upsertChatSession,
  type ChatSession,
} from '@/lib/chatSessions'
import { sseJsonPost } from '@/lib/sse'
import type { AgentResponse, AIModelResponse, KnowledgeBaseResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

function renderMarkdown(content: string): string {
  try {
    if (!content) return ''

    const codeBlocks: string[] = []
    const withCodePlaceholders = content.replace(/```[\s\S]*?```/g, (m) => {
      const i = codeBlocks.length
      codeBlocks.push(m)
      return `__CODE_BLOCK_PLACEHOLDER_${i}__`
    })

    // Protect URLs so punctuation inside them won't be modified
    const urls: string[] = []
    const tmp = withCodePlaceholders.replace(/https?:\/\/\S+/g, (m) => {
      const i = urls.length
      urls.push(m)
      return `__URL_PLACEHOLDER_${i}__`
    })

    // Insert Markdown line-breaks after sentence-ending punctuation, excluding '.' to avoid splitting URLs
    // Two trailing spaces + newline create a Markdown <br>
    const withBreaks = tmp.replace(/([。！？;；!?])\s*/g, '$1  \n')

    // Restore URLs
    const restoredUrls = withBreaks.replace(/__URL_PLACEHOLDER_(\d+)__/g, (_m, idx) => urls[Number(idx)] || '')
    const restored = restoredUrls.replace(
      /__CODE_BLOCK_PLACEHOLDER_(\d+)__/g,
      (_m, idx) => codeBlocks[Number(idx)] || '',
    )

    return marked.parse(restored, { async: false }) as string || content
  } catch {
    return content
  }
}

const canReadAgents = computed(() => auth.hasPermission('agents.read'))
const canReadModels = computed(() => auth.hasPermission('models.read'))
const canReadKBs = computed(() => auth.hasPermission('knowledge_bases.read'))

const loading = ref(false)
const errorMessage = ref<string | null>(null)

const agents = ref<AgentResponse[]>([])
const models = ref<AIModelResponse[]>([])
const knowledgeBases = ref<KnowledgeBaseResponse[]>([])

const sessions = ref<ChatSession[]>(loadChatSessions())
const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null)

const input = ref('')
const sending = ref(false)
const messageListEl = ref<HTMLElement | null>(null)
const agentStreaming = ref(true)
const compareMode = ref(false)
const rawLlmContent = ref<string | null>(null)
let agentAbort: AbortController | null = null
let rawLlmAbort: AbortController | null = null  // 原始LLM流式请求控制器
let rawLlmStreamContent = ''  // 原始LLM流式累积内容
let currentToolCallsLog: Array<{type: 'call' | 'result'; round: number; data: Record<string, unknown>; at: number}> = []  // 当前轮工具调用日志
const expandedToolLogs = ref(new Set<string>())  // 展开状态的工具日志（key = message.at）
const reactSteps = ref<Array<{phase: 'thought' | 'action' | 'observation' | 'final'; round?: number; data: Record<string, unknown>; content?: string; at: number}>>([])  // ReAct 流程步骤

function toggleToolLog(m: { at: number }) {
  const key = String(m.at)
  const next = new Set(expandedToolLogs.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedToolLogs.value = next
}

const activeSession = computed<ChatSession | null>(() => {
  const id = activeSessionId.value
  if (!id) return null
  return sessions.value.find((s) => s.id === id) ?? null
})

const selectedAgentId = computed<number | null>({
  get() {
    return activeSession.value?.agentId ?? null
  },
  set(agentId) {
    const s = activeSession.value
    if (!s) return
    setSession({ ...s, agentId: agentId ?? undefined, updatedAt: Date.now() }, { resetIfStarted: true })
  },
})

const selectedKbIds = computed<number[]>({
  get() {
    return activeSession.value?.kbIds ?? []
  },
  set(kbIds) {
    const s = activeSession.value
    if (!s) return
    setSession({ ...s, kbIds, updatedAt: Date.now() }, { resetIfStarted: false })
  },
})

const selectedAgent = computed(() => agents.value.find((a) => a.agent_id === selectedAgentId.value) ?? null)
const modelNameById = computed(() => {
  const map = new Map<number, string>()
  for (const m of models.value) map.set(m.model_id, m.name)
  return map
})
const selectedKbNames = computed(() => {
  const idSet = new Set(selectedKbIds.value)
  return knowledgeBases.value.filter((kb) => idSet.has(kb.kb_id)).map((kb) => kb.name)
})

function persistSessions(next: ChatSession[]) {
  sessions.value = next
  saveChatSessions(next)
}

function setSession(session: ChatSession, opts: { resetIfStarted: boolean }) {
  const started = session.messages.length > 0 || typeof session.conversationId === 'number'
  if (opts.resetIfStarted && started) {
    const fresh = createChatSession({
      mode: 'agent',
      agentId: session.agentId,
      kbIds: session.kbIds,
    })
    persistSessions(upsertChatSession(sessions.value, fresh))
    activeSessionId.value = fresh.id
    return
  }

  persistSessions(upsertChatSession(sessions.value, session))
  activeSessionId.value = session.id
}

function ensureActiveSession() {
  if (activeSession.value) return
  const fresh = createChatSession()
  persistSessions(upsertChatSession(sessions.value, fresh))
  activeSessionId.value = fresh.id
}

function newChat() {
  const fresh = createChatSession({
    mode: 'agent',
    agentId: selectedAgentId.value ?? undefined,
    kbIds: selectedKbIds.value,
  })
  persistSessions(upsertChatSession(sessions.value, fresh))
  activeSessionId.value = fresh.id
}

function removeSession(id: string) {
  const next = deleteChatSession(sessions.value, id)
  persistSessions(next)
  if (activeSessionId.value === id) {
    activeSessionId.value = next[0]?.id ?? null
  }
  ensureActiveSession()
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

async function scrollToBottom() {
  await nextTick()
  const el = messageListEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

async function loadLists() {
  if (!canReadAgents.value) return
  loading.value = true
  errorMessage.value = null
  try {
    const [agentList, modelList, kbList] = await Promise.all([
      agentApi.list(),
      canReadModels.value ? aiModelApi.list() : Promise.resolve([]),
      canReadKBs.value ? knowledgeBaseApi.list() : Promise.resolve([]),
    ])
    agents.value = agentList
    models.value = modelList
    knowledgeBases.value = kbList

    ensureActiveSession()
    const s = activeSession.value
    if (!s) return

    const first = agents.value[0]
    if (!s.agentId && first) {
      setSession({ ...s, mode: 'agent', agentId: first.agent_id, updatedAt: Date.now() }, { resetIfStarted: true })
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function send() {
  const s = activeSession.value
  if (!s) return
  const content = input.value.trim()
  if (!content) return
  if (sending.value) return

  errorMessage.value = null
  sending.value = true
  input.value = ''
  agentAbort?.abort()
  agentAbort = null
  rawLlmAbort?.abort()
  rawLlmAbort = null

  const now = Date.now()
  const userMsg = { role: 'user' as const, content, at: now }
  const optimistic: ChatSession = {
    ...s,
    title: s.title === '新对话' ? content.slice(0, 20) || '新对话' : s.title,
    updatedAt: now,
    messages: [...s.messages, userMsg],
  }
  setSession(optimistic, { resetIfStarted: false })
  await scrollToBottom()

  try {
    if (optimistic.mode === 'agent') {
      const agentId = optimistic.agentId
      if (!agentId) throw new Error('请先选择智能体')
      const kbIds = canReadKBs.value && optimistic.kbIds.length > 0 ? optimistic.kbIds : null

      if (!agentStreaming.value) {
        const res = await agentApi.chat(agentId, {
          conversation_id: optimistic.conversationId ?? null,
          messages: [{ role: 'user', content }],
          kb_ids: kbIds,
          rag_top_k: 5,
          max_tool_rounds: 8,
          max_history_messages: 30,
        })

        const assistantMsg = {
          role: 'assistant' as const,
          content: res.content,
          at: Date.now(),
          meta: {
            raw_content: res.raw_content ?? undefined,
            sources: res.sources ?? undefined,
          },
        }
        setSession(
          {
            ...optimistic,
            mode: 'agent',
            conversationId: res.conversation_id,
            lastMeta: res.meta ?? {},
            updatedAt: Date.now(),
            messages: [...optimistic.messages, assistantMsg],
          },
          { resetIfStarted: false },
        )
        await scrollToBottom()
        return
      }

      // 对比模式：预置占位消息（确保对比视图始终渲染）
      const assistantMsg: ChatSessionMessage = compareMode.value
        ? { role: 'assistant' as const, content: '', at: Date.now(), meta: { raw_content: '', _rawLoading: true } }
        : { role: 'assistant' as const, content: '', at: Date.now() }
      setSession(
        { ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistantMsg] },
        { resetIfStarted: false },
      )
      await scrollToBottom()

      agentAbort = new AbortController()
      let out = ''

      // ── 对比模式：并行发起独立的原始 LLM 流式请求（SSE）──
      const modelId = selectedAgent.value?.model_id ?? null
      rawLlmContent.value = null
      rawLlmStreamContent = ''
      currentToolCallsLog = []  // 重置工具调用日志
      reactSteps.value = []  // 重置 ReAct 流程步骤
      if (compareMode.value && modelId) {
        rawLlmAbort = new AbortController()
        
        // 使用 SSE 流式请求原始 LLM
        sseJsonPost(
          `/api/v1/models/${modelId}/chat?stream=true`,
          { messages: [{ role: 'user', content }] },
          {
            signal: rawLlmAbort.signal,
            onData: (delta) => {
              // 累积流式内容并实时更新UI
              rawLlmStreamContent += delta
              rawLlmContent.value = rawLlmStreamContent
              
              const cur = activeSession.value
              if (cur) {
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx >= 0 && msgs[idx]) {
                  const last = msgs[idx]
                  msgs[idx] = { 
                    ...last, 
                    meta: { 
                      ...(last.meta as Record<string, unknown>), 
                      raw_content: rawLlmStreamContent, 
                      _rawLoading: false 
                    } 
                  }
                  setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                }
              }
            },
            onError: (err) => {
              console.error('Raw LLM stream error:', err)
              // 标记加载结束，即使出错也显示已有内容
              const cur = activeSession.value
              if (cur) {
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx >= 0 && msgs[idx]) {
                  const last = msgs[idx]
                  msgs[idx] = { ...last, meta: { ...(last.meta as Record<string, unknown>), _rawLoading: false } }
                  setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                }
              }
            },
          }
        ).catch(() => {})
      }

      // ── Agent SSE 主请求（不再携带 compare 参数）──
      await sseJsonPost(
        `/api/v1/agents/${agentId}/chat?stream=true`,
        {
          conversation_id: optimistic.conversationId ?? null,
          messages: [{ role: 'user', content }],
          kb_ids: kbIds,
          rag_top_k: 5,
          max_tool_rounds: 8,
          max_history_messages: 30,
        },
        {
          signal: agentAbort.signal,
          onEvent: (event, data) => {
            try {
              if (event === 'meta') {
                const payload = JSON.parse(data) as { conversation_id?: number; meta?: Record<string, unknown> }
                const cur = activeSession.value
                if (!cur) return
                setSession(
                  {
                    ...cur,
                    mode: 'agent',
                    conversationId: payload.conversation_id ?? cur.conversationId,
                    lastMeta: payload.meta ?? cur.lastMeta,
                    updatedAt: Date.now(),
                  },
                  { resetIfStarted: false },
                )
                return
              }

              // ━━━ ReAct Thought 阶段 ━━━
              if (event === 'thought') {
                const payload = JSON.parse(data) as {
                  round?: number
                  status?: string
                  message?: string
                }
                
                // 记录 ReAct 步骤
                reactSteps.value.push({
                  phase: 'thought',
                  round: payload.round,
                  data: payload,
                  at: Date.now(),
                })

                const cur = activeSession.value
                if (!cur) return
                
                // 更新当前 assistant 消息的 meta，嵌入 ReAct 流程信息
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx >= 0 && msgs[idx]) {
                  const last = msgs[idx]
                  msgs[idx] = {
                    ...last,
                    meta: {
                      ...(last.meta as Record<string, unknown>),
                      react_steps: [...reactSteps.value],
                      current_phase: 'thought',
                      current_round: payload.round,
                      tool_calls_log: [...currentToolCallsLog],
                      _rawLoading: (last.meta as Record<string, unknown>)?._rawLoading ?? false,
                    },
                  }
                  setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                }
                return
              }

              // ━━━ ReAct Action 阶段 ━━━
              if (event === 'action') {
                const payload = JSON.parse(data) as {
                  round?: number
                  thought?: string
                  tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown }>
                }
                
                // 记录 ReAct 步骤
                reactSteps.value.push({
                  phase: 'action',
                  round: payload.round,
                  data: payload,
                  content: payload.thought,
                  at: Date.now(),
                })

                // 收集到工具调用日志
                const toolRound = typeof payload.round === 'number' ? payload.round : reactSteps.value.length
                const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : []
                
                const logEntry = { 
                  type: 'call' as const, 
                  round: toolRound, 
                  data: { tool_calls: toolCalls }, 
                  at: Date.now() 
                }
                currentToolCallsLog.push(logEntry)

                const cur = activeSession.value
                if (!cur) return

                // 更新 assistant 消息 meta
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx >= 0 && msgs[idx]) {
                  const last = msgs[idx]
                  msgs[idx] = {
                    ...last,
                    meta: {
                      ...(last.meta as Record<string, unknown>),
                      react_steps: [...reactSteps.value],
                      current_phase: 'action',
                      current_round: payload.round,
                      tool_calls_log: [...currentToolCallsLog],
                      _rawLoading: (last.meta as Record<string, unknown>)?._rawLoading ?? false,
                    },
                  }
                  setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                }

                // 同时保留独立工具消息（用于可视化展示）
                const lines = toolCalls.map((c) => {
                  const name = typeof c.name === 'string' ? c.name : '(unknown)'
                  const args = c.arguments ?? {}
                  return `- ${name} ${formatJson(args)}`
                })

                const actionMsg = {
                  role: 'tool' as const,
                  content: `🔧 **Action** (第 ${payload.round ?? toolRound} 轮)\n${lines.join('\n')}`.trim(),
                  meta: { 
                    event: 'react_action', 
                    phase: 'action',
                    round: payload.round ?? toolRound, 
                    tool_calls: toolCalls,
                    thought: payload.thought,
                  } as Record<string, unknown>,
                  at: Date.now(),
                }

                setSession(
                  { ...cur, updatedAt: Date.now(), messages: [...cur.messages, actionMsg] },
                  { resetIfStarted: false },
                )
                return
              }

              // ━━━ ReAct Observation 阶段 ━━━
              if (event === 'observation') {
                const payload = JSON.parse(data) as {
                  round?: number
                  tool_results?: Array<Record<string, unknown>>
                }
                
                // 记录 ReAct 步骤
                reactSteps.value.push({
                  phase: 'observation',
                  round: payload.round,
                  data: payload,
                  at: Date.now(),
                })

                // 收集工具结果到日志
                const toolResults = Array.isArray(payload.tool_results) ? payload.tool_results : []
                for (const tr of toolResults) {
                  currentToolCallsLog.push({ 
                    type: 'result' as const, 
                    round: payload.round ?? reactSteps.value.length, 
                    data: { ...tr }, 
                    at: Date.now() 
                  })
                }

                const cur = activeSession.value
                if (!cur) return

                // 更新 assistant 消息 meta
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx >= 0 && msgs[idx]) {
                  const last = msgs[idx]
                  msgs[idx] = {
                    ...last,
                    meta: {
                      ...(last.meta as Record<string, unknown>),
                      react_steps: [...reactSteps.value],
                      current_phase: 'observation',
                      current_round: payload.round,
                      tool_calls_log: [...currentToolCallsLog],
                      _rawLoading: (last.meta as Record<string, unknown>)?._rawLoading ?? false,
                    },
                  }
                  setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                }

                // 保留独立的观察结果消息
                const obsLines = toolResults.map((tr) => {
                  const name = (tr as Record<string, unknown>).tool_name ?? '(unknown)'
                  const output = formatJson((tr as Record<string, unknown>).output ?? {})
                  return `**${name}**: ${output.slice(0, 200)}${output.length > 200 ? '...' : ''}`
                })

                const obsMsg = {
                  role: 'tool' as const,
                  content: `👁️ **Observation** (第 ${payload.round ?? '?'} 轮)\n${obsLines.join('\n\n')}`.trim(),
                  meta: { 
                    event: 'react_observation', 
                    phase: 'observation',
                    round: payload.round,
                    tool_results: toolResults,
                  } as Record<string, unknown>,
                  at: Date.now(),
                }

                setSession(
                  { ...cur, updatedAt: Date.now(), messages: [...cur.messages, obsMsg] },
                  { resetIfStarted: false },
                )
                return
              }

              // 兼容旧的 tool_call 事件（如果后端仍发送）
              if (event === 'tool_call') {
                const payload = JSON.parse(data) as {
                  tool_round?: number
                  tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown }>
                }
                const toolRound = typeof payload.tool_round === 'number' ? payload.tool_round : 0
                const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : []

                // 收集到工具调用日志（用于对比模式Agent栏内展示）
                const logEntry = { type: 'call' as const, round: toolRound, data: { tool_calls: toolCalls }, at: Date.now() }
                currentToolCallsLog.push(logEntry)

                // 更新当前 assistant 消息的 meta，嵌入工具调用信息
                const cur = activeSession.value
                if (cur) {
                  const msgs = cur.messages.slice()
                  let idx = msgs.length - 1
                  while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                  if (idx >= 0 && msgs[idx]) {
                    const last = msgs[idx]
                    msgs[idx] = {
                      ...last,
                      meta: {
                        ...(last.meta as Record<string, unknown>),
                        tool_calls_log: [...currentToolCallsLog],
                        _rawLoading: (last.meta as Record<string, unknown>)?._rawLoading ?? false,
                      },
                    }
                    setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                  }
                }

                // 同时保留独立工具消息（普通模式使用）
                const lines = toolCalls.map((c) => {
                  const name = typeof c.name === 'string' ? c.name : '(unknown)'
                  const args = c.arguments ?? {}
                  return `- ${name} ${formatJson(args)}`
                })

                const toolMsg = {
                  role: 'tool' as const,
                  content: `【工具调用】第 ${toolRound} 轮\n${lines.join('\n')}`.trim(),
                  meta: { event: 'tool_call', tool_round: toolRound, tool_calls: toolCalls },
                  at: Date.now(),
                }

                if (!cur) return
                setSession(
                  { ...cur, updatedAt: Date.now(), messages: [...cur.messages, toolMsg] },
                  { resetIfStarted: false },
                )
                return
              }

              if (event === 'tool_result') {
                const payload = JSON.parse(data) as {
                  tool_round?: number
                  tool_name?: string
                  tool_call_id?: string
                  arguments?: unknown
                  output?: unknown
                }
                const toolRound = typeof payload.tool_round === 'number' ? payload.tool_round : 0
                const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '(unknown)'

                // 收集到工具调用日志
                currentToolCallsLog.push({ type: 'result' as const, round: toolRound, data: { ...payload }, at: Date.now() })

                // 更新当前 assistant 消息的 meta
                const cur = activeSession.value
                if (cur) {
                  const msgs = cur.messages.slice()
                  let idx = msgs.length - 1
                  while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                  if (idx >= 0 && msgs[idx]) {
                    const last = msgs[idx]
                    msgs[idx] = {
                      ...last,
                      meta: {
                        ...(last.meta as Record<string, unknown>),
                        tool_calls_log: [...currentToolCallsLog],
                        _rawLoading: (last.meta as Record<string, unknown>)?._rawLoading ?? false,
                      },
                    }
                    setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                  }
                }

                // 同时保留独立工具消息（普通模式使用）
                const outText = formatJson(payload.output ?? {})
                const toolMsg = {
                  role: 'tool' as const,
                  content: `【工具结果】第 ${toolRound} 轮 ${toolName}\n${outText}`.trim(),
                  meta: { event: 'tool_result', ...payload },
                  at: Date.now(),
                }

                if (!cur) return
                setSession(
                  { ...cur, updatedAt: Date.now(), messages: [...cur.messages, toolMsg] },
                  { resetIfStarted: false },
                )
                return
              }

              if (event === 'final') {
                const payload = JSON.parse(data) as { content?: string }
                const finalContent = typeof payload.content === 'string' ? payload.content : ''
                const cur = activeSession.value
                if (!cur) return
                
                // 标记 ReAct 循环完成
                reactSteps.value.push({
                  phase: 'final',
                  data: { content: finalContent },
                  at: Date.now(),
                })
                
                const msgs = cur.messages.slice()
                let idx = msgs.length - 1
                while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
                if (idx < 0) {
                  msgs.push({ role: 'assistant' as const, content: finalContent, at: Date.now() })
                } else {
                  const last = msgs[idx]
                  if (!last) return
                  // 对比模式：保留/更新 raw_content（可能已有值或仍为加载中占位）
                  const existingRaw = (last.meta as Record<string, unknown>)?.raw_content as string | undefined
                  msgs[idx] = {
                    ...last,
                    content: finalContent,
                    meta: {
                      ...(last.meta as Record<string, unknown>),
                      react_steps: [...reactSteps.value],
                      current_phase: 'final',
                      tool_calls_log: [...currentToolCallsLog],
                      raw_content: rawLlmContent.value ?? existingRaw ?? '',
                      _rawLoading: !rawLlmContent.value && compareMode.value,
                    },
                  }
                }
                out = finalContent
                setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
                return
              }
            } catch {
              // ignore
            }
          },
          onData: (delta) => {
            out += delta
            const cur = activeSession.value
            if (!cur) return
            const msgs = cur.messages.slice()
            let idx = msgs.length - 1
            while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
            if (idx < 0) {
              msgs.push({ role: 'assistant' as const, content: '', at: Date.now() })
              idx = msgs.length - 1
            }
            const last = msgs[idx]
            if (!last) return
            msgs[idx] = { ...last, content: out }
            setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
          },
        },
      )

      // ── 对比模式：确保原始 LLM 结果已合并到消息中 ──
      if (compareMode.value && !rawLlmContent.value) {
        // 等待原始 LLM 最多 3 秒
        const deadline = Date.now() + 3000
        while (!rawLlmContent.value && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200))
        }
        // 超时则标记为加载失败
        if (!rawLlmContent.value) {
          const cur = activeSession.value
          if (cur) {
            const msgs = cur.messages.slice()
            let idx = msgs.length - 1
            while (idx >= 0 && msgs[idx]?.role !== 'assistant') idx -= 1
            if (idx >= 0 && msgs[idx]) {
              const last = msgs[idx]
              const meta = last.meta as Record<string, unknown>
              if (!meta?.raw_content || meta._rawLoading) {
                msgs[idx] = { ...last, meta: { ...meta, raw_content: '[原始 LLM 响应超时]', _rawLoading: false } }
                setSession({ ...cur, updatedAt: Date.now(), messages: msgs }, { resetIfStarted: false })
              }
            }
          }
        } else {
          // 在等待期间 rawLlmContent 已到达（通过 .then 回调已写入），无需重复操作
        }
      }

      await scrollToBottom()
      return
    }

  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '发送失败'
    // restore input for convenience
    input.value = content
  } finally {
    sending.value = false
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  if (e.shiftKey) return
  e.preventDefault()
  void send()
}

const suggestions = [
  '帮我规划从明天开始的一次 3 天 2 夜的杭州旅行',
  '帮我制定一份从上海站到杭州站的火车票',
  '给我一个适合亲子出游的上海行程安排，计划后天出发',
  '预算 3000 元，帮我制定一份成都旅行计划',
  '第一次去西安，哪些景点最值得去？',
  '帮我列一份这个暑假的云南旅行必备物品清单',
]

onMounted(async () => {
  ensureActiveSession()
  await loadLists()
})

watch(
  () => activeSessionId.value,
  () => {
    void scrollToBottom()
  },
)
</script>

<template>
  <div
    class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:grid md:h-[calc(100dvh-64px)] md:h-[calc(100vh-64px)] md:grid-cols-[300px_1fr]"
  >
    <aside
      class="flex max-h-[55dvh] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:max-h-none"
    >
      <div class="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div class="h-9 w-9 rounded-full bg-slate-200" />
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-slate-900">
            {{ auth.user?.user_name ?? '未登录' }}
          </div>
          <div class="truncate text-xs text-slate-500">{{ auth.user?.email ?? '' }}</div>
        </div>
      </div>

      <div class="space-y-3 p-3">
        <button
          class="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          :disabled="!canReadAgents || loading"
          @click="newChat"
        >
          新对话
        </button>

        <div class="rounded-xl border border-slate-200 p-3">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">对话设置</div>

          <div class="space-y-2">
            <label class="block text-xs font-medium text-slate-700">智能体</label>
            <select
              v-model="selectedAgentId"
              class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:ring-slate-400"
            >
              <option :value="null" disabled>请选择智能体</option>
              <option v-for="a in agents" :key="a.agent_id" :value="a.agent_id">
                {{ a.name }}
              </option>
            </select>

            <div v-if="selectedAgent" class="text-xs text-slate-500">
              <div class="truncate">
                绑定模型：{{
                  selectedAgent.model_id
                    ? (modelNameById.get(selectedAgent.model_id) ?? selectedAgent.model_id)
                    : '未绑定'
                }}
              </div>
              <div v-if="selectedAgent.description" class="mt-1 truncate">
                {{ selectedAgent.description }}
              </div>
            </div>

            <template v-if="canReadKBs">
              <label class="block text-xs font-medium text-slate-700">知识库（可选）</label>
              <div class="max-h-40 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2">
                <label
                  v-for="kb in knowledgeBases"
                  :key="kb.kb_id"
                  class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    class="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    :value="kb.kb_id"
                    :checked="selectedKbIds.includes(kb.kb_id)"
                    @change="
                      (e) => {
                        const checked = (e.target as HTMLInputElement).checked
                        const next = checked
                          ? [...selectedKbIds, kb.kb_id]
                          : selectedKbIds.filter((x) => x !== kb.kb_id)
                        selectedKbIds = next
                      }
                    "
                  />
                  <span class="min-w-0 flex-1 truncate text-sm text-slate-700">{{ kb.name }}</span>
                </label>
                <div v-if="knowledgeBases.length === 0" class="px-2 py-2 text-xs text-slate-500">
                  暂无知识库
                </div>
              </div>
              <div v-if="selectedKbNames.length > 0" class="mt-1 text-xs text-slate-500">
                已选：{{ selectedKbNames.join('、') }}
              </div>
            </template>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 p-3">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">历史对话</div>
          <div class="max-h-[30dvh] space-y-1 overflow-auto md:max-h-[260px]">
            <button
              v-for="s in sessions"
              :key="s.id"
              class="group flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50"
              :class="s.id === activeSessionId ? 'bg-slate-100 text-slate-900' : 'text-slate-700'"
              type="button"
              @click="activeSessionId = s.id"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{{ s.title }}</div>
                <div class="mt-0.5 truncate text-xs text-slate-500">
                  智能体 · {{ formatTime(s.updatedAt) }}
                </div>
              </div>
              <button
                class="hidden rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-700 group-hover:block"
                type="button"
                title="删除"
                @click.stop="removeSession(s.id)"
              >
                删除
              </button>
            </button>
          </div>
        </div>
      </div>

      <div class="mt-auto border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <div v-if="loading">加载中…</div>
        <div v-else-if="errorMessage" class="text-rose-600">{{ errorMessage }}</div>
        <div v-else>已连接后台资源（受权限控制）</div>
      </div>
    </aside>

    <main
      class="flex min-h-[45dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:min-h-0"
    >
      <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-slate-900">AI 对话</div>
          <div class="truncate text-xs text-slate-500">
            智能体：{{ selectedAgent?.name ?? '未选择' }}
          </div>
        </div>
      </div>

      <div ref="messageListEl" class="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-6">
        <template v-if="!canReadAgents">
          <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            缺少权限：agents.read
          </div>
        </template>

        <template v-else-if="activeSession?.messages.length === 0">
          <div class="mx-auto max-w-xl text-center">
            <div class="text-2xl font-semibold text-slate-900">有什么我能帮你的吗？</div>
            <div class="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                v-for="s in suggestions"
                :key="s"
                type="button"
                class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 hover:bg-slate-100"
                @click="
                  () => {
                    input = s
                  }
                "
              >
                {{ s }}
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            v-for="(m, idx) in activeSession?.messages ?? []"
            :key="idx"
            class="flex"
            :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <!-- 工具消息：ReAct 流程可视化 -->
            <details
              v-if="m.role === 'tool'"
              class="group max-w-[85%] rounded-2xl border overflow-hidden"
              :class="
                (m.meta as Record<string, unknown>)?.event === 'react_action' 
                  ? 'border-blue-200 bg-blue-50/80' 
                  : (m.meta as Record<string, unknown>)?.event === 'react_observation'
                    ? 'border-green-200 bg-green-50/80'
                    : 'border-amber-200 bg-amber-50'
              "
              :open="false"
            >
              <summary
                class="cursor-pointer select-none rounded-2xl px-4 py-3 font-mono text-xs hover:opacity-90 transition-opacity"
                :class="
                  (m.meta as Record<string, unknown>)?.event === 'react_action'
                    ? 'text-blue-900 hover:bg-blue-100'
                    : (m.meta as Record<string, unknown>)?.event === 'react_observation'
                      ? 'text-green-900 hover:bg-green-100'
                      : 'text-amber-900 hover:bg-amber-100'
                "
              >
                <span class="inline-flex items-center gap-2">
                  <!-- ReAct 阶段图标 -->
                  <template v-if="(m.meta as Record<string, unknown>)?.event === 'react_action'">
                    <svg class="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span class="font-bold">Action 第 {{ (m.meta as Record<string, unknown>).round ?? '?' }} 轮</span>
                    <span class="rounded-full bg-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                      {{ (((m.meta as Record<string, unknown>).tool_calls as Array<unknown>)?.length ?? 0) }} 个工具调用
                    </span>
                  </template>
                  <template v-else-if="(m.meta as Record<string, unknown>)?.event === 'react_observation'">
                    <svg class="h-4 w-4 text-green-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span class="font-bold">Observation 第 {{ (m.meta as Record<string, unknown>).round ?? '?' }} 轮</span>
                    <span class="rounded-full bg-green-200 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">
                      {{ (((m.meta as Record<string, unknown>).tool_results as Array<unknown>)?.length ?? 0) }} 个结果
                    </span>
                  </template>
                  <template v-else-if="m.content.startsWith('【工具调用】')">
                    <svg class="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span>工具调用</span>
                  </template>
                  <template v-else-if="m.content.startsWith('【工具结果】')">
                    <svg class="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span>工具结果</span>
                  </template>
                  <template v-else>
                    <svg class="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span>工具信息</span>
                  </template>
                </span>
              </summary>
              <div
                class="whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs max-h-[300px] overflow-auto"
                :class="
                  (m.meta as Record<string, unknown>)?.event === 'react_action'
                    ? 'border-blue-200 text-blue-900 bg-white/60'
                    : (m.meta as Record<string, unknown>)?.event === 'react_observation'
                      ? 'border-green-200 text-green-900 bg-white/60'
                      : 'border-amber-200 text-amber-900'
                "
              >
                <!-- Action 详情：展示思考内容 + 工具调用列表 -->
                <template v-if="(m.meta as Record<string, unknown>)?.event === 'react_action'">
                  <div v-if="(m.meta as Record<string, unknown>)?.thought" class="mb-3 p-2 rounded-lg bg-blue-100/50 text-blue-800">
                    <div class="text-[10px] font-semibold uppercase tracking-wide mb-1 text-blue-600">💭 思考</div>
                    <div class="whitespace-normal">{{ ((m.meta as Record<string, unknown>).thought as string).slice(0, 500) }}</div>
                  </div>
                  <div class="space-y-2">
                    <div 
                      v-for="(tc, tcIdx) in ((m.meta as Record<string, unknown>).tool_calls as Array<{name?: string; arguments?: unknown}>)" 
                      :key="tcIdx"
                      class="rounded-lg bg-blue-100/80 p-2"
                    >
                      <div class="flex items-center gap-2 mb-1">
                        <span class="rounded bg-blue-300 px-1.5 py-0.5 text-[10px] font-bold text-blue-900">
                          {{ tc.name ?? 'unknown' }}
                        </span>
                      </div>
                      <pre class="text-[11px] text-blue-700 whitespace-pre-wrap">{{ formatJson(tc.arguments) }}</pre>
                    </div>
                  </div>
                </template>

                <!-- Observation 详情：展示工具执行结果 -->
                <template v-else-if="(m.meta as Record<string, unknown>)?.event === 'react_observation'">
                  <div class="space-y-2">
                    <div 
                      v-for="(tr, trIdx) in ((m.meta as Record<string, unknown>).tool_results as Array<Record<string, unknown>>)" 
                      :key="trIdx"
                      class="rounded-lg bg-green-100/80 p-2"
                    >
                      <div class="flex items-center gap-2 mb-1">
                        <span class="rounded-full bg-green-300 px-1.5 py-0.5 text-[10px] font-bold text-green-900">
                          ✓ {{ tr.tool_name ?? 'result' }}
                        </span>
                        <span class="text-[10px] text-green-700">第 {{ tr.tool_round ?? '?' }} 轮</span>
                      </div>
                      <pre class="max-h-[150px] overflow-auto text-[10px] text-green-800 whitespace-pre-wrap">{{ formatJson(tr.output) }}</pre>
                    </div>
                  </div>
                </template>

                <!-- 兼容旧格式 -->
                <template v-else>
                  {{ m.content }}
                </template>
              </div>
            </details>

            <!-- 用户消息 -->
            <div
              v-else-if="m.role === 'user'"
              class="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white"
            >
              {{ m.content }}
            </div>

            <!-- 助手消息 -->
            <template v-else-if="m.role === 'assistant'">
              <!-- 对比模式：左右分栏 -->
              <div
                v-if="compareMode && (m.meta as Record<string, unknown>)?.raw_content"
                class="flex w-full max-w-[95%] flex-col gap-3"
              >
                <div class="flex items-center gap-2 text-xs font-medium">
                  <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">对比视图</span>
                  <span class="text-slate-400">左侧 = 原始 LLM 响应 | 右侧 = Agent 编排输出</span>
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <!-- 左：原始 LLM 响应 -->
                  <div class="flex flex-col rounded-xl border border-rose-200 bg-rose-50/50">
                    <div class="flex items-center justify-between border-b border-rose-200 px-4 py-2">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                          原始 LLM
                        </span>
                        <span class="text-xs text-slate-400">无 RAG / 无工具</span>
                      </div>
                      <span class="shrink-0 text-xs text-slate-400">{{ ((m.meta as Record<string, unknown>).raw_content as string).length }} 字</span>
                    </div>

                    <!-- 状态1：加载中 / 流式中 -->
                    <template v-if="(m.meta as Record<string, unknown>)?._rawLoading">
                      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-slate-400">
                        <svg class="h-8 w-8 animate-spin text-rose-300" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        <div class="text-center">
                          <div class="text-xs font-medium text-rose-500">原始 LLM 流式输出中</div>
                          <div class="mt-1 text-xs text-slate-300">{{ ((m.meta as Record<string, unknown>).raw_content as string).length || 0 }} 字已生成…</div>
                        </div>
                      </div>
                    </template>

                    <!-- 状态2/3：已返回内容（无论长短都正常渲染，加提示条）-->
                    <template v-else>
                      <!-- 过短/异常提示条 -->
                      <div
                        v-if="((m.meta as Record<string, unknown>).raw_content as string).length > 0
                              && ((m.meta as Record<string, unknown>).raw_content as string).length < 30
                              || (m.meta as Record<string, unknown>).raw_content === '[原始 LLM 响应超时]'"
                        class="mx-4 mt-3 rounded-lg bg-amber-50/80 px-3 py-2 text-xs"
                      >
                        <div class="flex items-start gap-2 text-amber-700">
                          <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.227 2.502-4.95A49.45 49.45 0 0112 11c0 27.46-13.25 48.74-29.76C4.636 51.766 1 44.046 1 26 0 11.55 9.35 21 21 21s9.35-9.45 21-21z" /></svg>
                          <span>
                            <span class="font-medium">原始 LLM 输出极短</span>
                            — 模型无外部知识增强时的典型表现。
                            右侧为 Agent 经过 RAG + 工具调用后的完整回答。
                          </span>
                        </div>
                      </div>
                      <!-- 内容区 - 流式显示支持 -->
                      <div class="max-h-[500px] flex-1 overflow-auto p-4 text-sm leading-relaxed prose prose-sm prose-slate max-w-none" 
                           v-html="renderMarkdown((m.meta as Record<string, unknown>).raw_content as string)"></div>
                      <!-- 流式光标指示器 -->
                      <div v-if="(m.meta as Record<string, unknown>)?._rawLoading && (m.meta as Record<string, unknown>)?.raw_content" 
                           class="mx-4 mb-2 flex items-center gap-1 text-xs text-rose-400">
                        <span class="inline-block h-3 w-0.5 animate-pulse bg-rose-400"></span>
                        正在输出…
                      </div>
                    </template>
                  </div>
                  <!-- 右：Agent 编排输出 -->
                  <div class="flex flex-col rounded-xl border border-emerald-200 bg-emerald-50/50">
                    <div class="flex items-center justify-between border-b border-emerald-200 px-4 py-2">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                          Agent 编排
                        </span>
                        <span class="text-xs text-slate-400">RAG + 工具 + 整合</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span v-if="(m.meta as Record<string, unknown>)?.tool_calls_log && ((m.meta as Record<string, unknown>).tool_calls_log as Array<Record<string, unknown>>).length > 0" 
                              class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {{ (((m.meta as Record<string, unknown>).tool_calls_log as Array<Record<string, unknown>>)?.filter((t: Record<string, unknown>) => t.type === 'call')?.length ?? 0) }} 次工具调用
                        </span>
                        <span class="shrink-0 text-xs text-slate-400">{{ m.content.length }} 字</span>
                      </div>
                    </div>

                    <!-- 工具调用流程展示区 -->
                    <div v-if="(m.meta as Record<string, unknown>)?.tool_calls_log && ((m.meta as Record<string, unknown>).tool_calls_log as Array<Record<string, unknown>>).length > 0"
                         class="border-b border-emerald-100">
                      <button 
                        @click="toggleToolLog(m)"
                        class="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium text-emerald-600 hover:bg-emerald-100/50 transition-colors">
                        <span class="flex items-center gap-1.5">
                          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          工具调用流程
                        </span>
                        <svg :class="['h-3.5 w-3.5 transition-transform', expandedToolLogs.has(`${m.at}`) ? 'rotate-180' : '']" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      
                      <!-- 展开的工具调用详情 -->
                      <div v-show="expandedToolLogs.has(`${m.at}`)" class="max-h-[300px] overflow-auto bg-emerald-900/5 p-3 space-y-2">
                        <template v-for="(log, logIdx) in ((m.meta as Record<string, unknown>).tool_calls_log as Array<{type: string; round: number; data: Record<string, unknown>}>)" :key="logIdx">
                          <!-- 工具调用卡片 -->
                          <div v-if="log.type === 'call'" 
                               class="rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2">
                            <div class="mb-1 flex items-center gap-2">
                              <span class="inline-flex items-center rounded bg-blue-200 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                                调用 #{{ log.round }}
                              </span>
                            </div>
                            <div class="space-y-1">
                              <div v-for="(tc, tcIdx) in ((log.data as Record<string, unknown>).tool_calls as Array<{name?: string; arguments?: unknown}>)" :key="tcIdx"
                                   class="rounded bg-white/60 px-2 py-1.5 font-mono text-[11px] text-slate-700">
                                <span class="font-semibold text-blue-700">{{ tc.name ?? 'unknown' }}</span>
                                <span v-if="tc.arguments" class="text-slate-500 ml-1">{{ formatJson(tc.arguments) }}</span>
                              </div>
                            </div>
                          </div>

                          <!-- 工具结果卡片 -->
                          <div v-if="log.type === 'result'" 
                               class="rounded-lg border border-green-200 bg-green-50/80 px-3 py-2">
                            <div class="mb-1 flex items-center gap-2">
                              <span class="inline-flex items-center rounded bg-green-200 px-1.5 py-0.5 text-[10px] font-bold text-green-800">
                                结果 #{{ log.round }}
                              </span>
                              <span class="text-[11px] font-medium text-green-700">{{ (log.data as Record<string, unknown>).tool_name ?? '' }}</span>
                            </div>
                            <pre class="max-h-[120px] overflow-auto rounded bg-white/60 p-2 font-mono text-[10px] text-slate-600 whitespace-pre-wrap">{{ formatJson((log.data as Record<string, unknown>).output) }}</pre>
                          </div>
                        </template>
                      </div>
                    </div>

                    <!-- 最终回答内容区 -->
                    <div class="relative max-h-[500px] flex-1 overflow-auto p-4 text-sm leading-relaxed text-slate-800 prose prose-sm prose-slate max-w-none shadow-sm" v-html="renderMarkdown(m.content)"></div>
                    
                    <!-- ReAct 流程状态指示器 -->
                    <div 
                      v-if="(m.meta as Record<string, unknown>)?.react_steps && (((m.meta as Record<string, unknown>).react_steps as Array<Record<string, unknown>>)?.length ?? 0) > 0" 
                      class="mx-4 mb-3 rounded-lg bg-gradient-to-r from-indigo-50 via-purple-50 to-emerald-50 border border-indigo-100 p-3"
                    >
                      <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2 text-xs font-semibold text-indigo-700">
                          <svg class="h-4 w-4 animate-pulse" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          ReAct 循环
                        </div>
                        <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                          {{ ((m.meta as Record<string, unknown>).react_steps as Array<Record<string, unknown>>).filter((s: Record<string, unknown>) => s.phase !== 'final').length }} 轮
                        </span>
                      </div>
                      
                      <!-- ReAct 阶段进度条 -->
                      <div class="flex items-center gap-1 text-[10px] text-indigo-600 overflow-x-auto pb-1">
                        <template v-for="(step, stepIdx) in ((m.meta as Record<string, unknown>).react_steps as Array<{phase?: string; round?: number}>)" :key="stepIdx">
                          <span 
                            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded whitespace-nowrap"
                            :class="
                              step.phase === 'thought' ? 'bg-blue-100 text-blue-700' :
                              step.phase === 'action' ? 'bg-violet-100 text-violet-700' :
                              step.phase === 'observation' ? 'bg-emerald-100 text-emerald-700' :
                              'bg-gray-100 text-gray-600'
                            "
                          >
                            <template v-if="step.phase === 'thought'">🧠 T{{ step.round }}</template>
                            <template v-else-if="step.phase === 'action'">⚡ A{{ step.round }}</template>
                            <template v-else-if="step.phase === 'observation'">👁️ O{{ step.round }}</template>
                            <template v-else>✅ Done</template>
                          </span>
                          <span v-if="stepIdx < (((m.meta as Record<string, unknown>).react_steps as Array<unknown>)?.length ?? 0) - 1" class="text-indigo-300">→</span>
                        </template>
                      </div>
                      
                      <!-- 当前阶段高亮 -->
                      <div v-if="(m.meta as Record<string, unknown>)?.current_phase && (m.meta as Record<string, unknown>).current_phase !== 'final'" class="mt-2 flex items-center gap-1.5 text-xs">
                        <span class="animate-pulse">⏳</span>
                        <span class="font-medium" :class="
                          (m.meta as Record<string, unknown>)?.current_phase === 'thought' ? 'text-blue-600' :
                          (m.meta as Record<string, unknown>)?.current_phase === 'action' ? 'text-violet-600' :
                          'text-emerald-600'
                        ">
                          {{ (m.meta as Record<string, unknown>)?.current_phase === 'thought' ? '思考中...' :
                             (m.meta as Record<string, unknown>)?.current_phase === 'action' ? '执行工具...' :
                             '观察结果...' }}
                        </span>
                      </div>
                    </div>
                    
                    <!-- 流式中指示器 -->
                    <div v-if="sending && !m.content" class="mx-4 mb-2 flex items-center gap-1 text-xs text-emerald-400">
                      <svg class="h-3 w-3 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      <span>Agent 思考中…</span>
                    </div>
                  </div>
                </div>
                <!-- 对比差异摘要 -->
                <div v-if="(m.meta as Record<string, unknown>)?.raw_content" class="rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-2 text-xs text-indigo-600">
                  差异：
                  <span class="font-semibold text-indigo-700">{{ m.content.length }}</span>
                  字（Agent）vs
                  <span class="font-semibold text-rose-600">{{ ((m.meta as Record<string, unknown>).raw_content as string).length || '加载中…' }}</span>
                  字（原始）
                  <template v-if="((m.meta as Record<string, unknown>).raw_content as string)">
                    · Agent 输出约是原始的
                    <span class="font-semibold">{{ Math.max(1, Math.round(m.content.length / Math.max(1, ((m.meta as Record<string, unknown>).raw_content as string).length))) }}</span>
                    倍
                  </template>
                </div>
              </div>
              <!-- 普通模式：单栏助手消息 -->
              <div
                v-else
                class="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm prose prose-slate max-w-none"
                v-html="renderMarkdown(m.content)"
              ></div>
            </template>
          </div>
        </template>
      </div>

      <div class="border-t border-slate-200 px-5 py-4">
        <div
          class="flex items-end gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-slate-400"
        >
          <textarea
            v-model="input"
            class="min-h-[44px] flex-1 resize-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
            :disabled="sending || !canReadAgents"
            rows="1"
            @keydown="onInputKeydown"
          />
          <button
            class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="sending || !input.trim() || !canReadAgents"
            @click="send"
          >
            发送
          </button>
        </div>

        <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-2">
              <input
                v-model="agentStreaming"
                type="checkbox"
                class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              流式输出（SSE）
            </label>
            <label class="flex items-center gap-2">
              <input
                v-model="compareMode"
                type="checkbox"
                class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
              />
              <span class="text-indigo-600 font-medium">对比模式（原始 vs Agent）</span>
            </label>
          </div>
          <div v-if="sending && agentStreaming" class="text-slate-500">输出中…</div>
        </div>

        <details v-if="activeSession?.lastMeta" class="mt-3">
          <summary class="cursor-pointer text-xs font-medium text-slate-600">调试信息（meta）</summary>
          <pre
            class="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
            >{{ formatJson(activeSession.lastMeta) }}</pre
          >
        </details>
      </div>
    </main>
  </div>
</template>
