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

    // Protect URLs so punctuation inside them won't be modified
    const urls: string[] = []
    const tmp = content.replace(/https?:\/\/\S+/g, (m) => {
      const i = urls.length
      urls.push(m)
      return `__URL_PLACEHOLDER_${i}__`
    })

    // Insert Markdown line-breaks after sentence-ending punctuation, excluding '.' to avoid splitting URLs
    // Two trailing spaces + newline create a Markdown <br>
    const withBreaks = tmp.replace(/([。！？;；!?])\s*/g, '$1  \n')

    // Restore URLs
    const restored = withBreaks.replace(/__URL_PLACEHOLDER_(\d+)__/g, (_m, idx) => urls[Number(idx)] || '')

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
let agentAbort: AbortController | null = null

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

        const assistantMsg = { role: 'assistant' as const, content: res.content, at: Date.now() }
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

      const assistantMsg = { role: 'assistant' as const, content: '', at: Date.now() }
      setSession(
        { ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistantMsg] },
        { resetIfStarted: false },
      )
      await scrollToBottom()

      agentAbort = new AbortController()
      let out = ''

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

              if (event === 'tool_call') {
                const payload = JSON.parse(data) as {
                  tool_round?: number
                  tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown }>
                }
                const toolRound = typeof payload.tool_round === 'number' ? payload.tool_round : 0
                const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : []

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

                const cur = activeSession.value
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
                const outText = formatJson(payload.output ?? {})
                const toolMsg = {
                  role: 'tool' as const,
                  content: `【工具结果】第 ${toolRound} 轮 ${toolName}\n${outText}`.trim(),
                  meta: { event: 'tool_result', ...payload },
                  at: Date.now(),
                }

                const cur = activeSession.value
                if (!cur) return
                setSession(
                  { ...cur, updatedAt: Date.now(), messages: [...cur.messages, toolMsg] },
                  { resetIfStarted: false },
                )
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
  '帮我总结一下今天的工作重点',
  '给我一个学习计划：Vue3 + TypeScript',
  '根据一段文本生成要点列表',
  '写一份周报（给出结构）',
  '帮我排查一个 HTTP 400 错误的可能原因',
  '给我 5 个可执行的优化建议',
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
            <!-- 工具消息：默认可折叠 -->
            <details
              v-if="m.role === 'tool'"
              class="group max-w-[85%] rounded-2xl border border-amber-200 bg-amber-50"
              :open="false"
            >
              <summary
                class="cursor-pointer select-none rounded-2xl px-4 py-3 font-mono text-xs text-amber-900 hover:bg-amber-100"
              >
                <span class="inline-flex items-center gap-2">
                  <svg
                    class="h-3 w-3 transition-transform group-open:rotate-90"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  <span v-if="m.content.startsWith('【工具调用】')">工具调用</span>
                  <span v-else-if="m.content.startsWith('【工具结果】')">工具结果</span>
                  <span v-else>工具信息</span>
                </span>
              </summary>
              <div
                class="whitespace-pre-wrap border-t border-amber-200 px-4 py-3 font-mono text-xs text-amber-900"
              >
                {{ m.content }}
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
            <div
              v-else
              class="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm prose prose-slate max-w-none"
              v-html="renderMarkdown(m.content)"
            ></div>
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
          <label class="flex items-center gap-2">
            <input
              v-model="agentStreaming"
              type="checkbox"
              class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            流式输出（SSE）
          </label>
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