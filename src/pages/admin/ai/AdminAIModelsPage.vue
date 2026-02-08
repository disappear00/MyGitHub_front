<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { aiModelApi, ApiBusinessError, groupApi } from '@/lib/api'
import { formatJson, safeParseJson } from '@/lib/json'
import { sseJsonPost } from '@/lib/sse'
import type { AIModelCreate, AIModelResponse, AIModelUpdate, GroupResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

type ModelFormState = {
  name: string
  provider: string
  model_kind: string
  base_url: string
  credential_ref: string
  description: string
  is_private: boolean
  group_id: number | null
  configText: string
}

const auth = useAuthStore()
auth.initFromStorage()

const canCreate = computed(() => auth.hasPermission('models.create'))
const canUpdate = computed(() => auth.hasPermission('models.update'))
const canDelete = computed(() => auth.hasPermission('models.delete'))
const canReadGroups = computed(() => auth.hasPermission('groups.read'))

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const items = ref<AIModelResponse[]>([])
const groups = ref<GroupResponse[]>([])

const groupById = computed(() => {
  const map = new Map<number, GroupResponse>()
  for (const g of groups.value) map.set(g.group_id, g)
  return map
})

async function refreshAll() {
  loading.value = true
  errorMsg.value = null
  try {
    const [m, g] = await Promise.all([
      aiModelApi.list(),
      canReadGroups.value ? groupApi.list({ order_by_path: true }) : Promise.resolve([]),
    ])
    items.value = m
    groups.value = g
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(refreshAll)

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const modalError = ref<string | null>(null)
const saving = ref(false)

const form = ref<ModelFormState>({
  name: '',
  provider: 'openai',
  model_kind: 'llm',
  base_url: '',
  credential_ref: '',
  description: '',
  is_private: false,
  group_id: null,
  configText: formatJson({}),
})

function openCreate() {
  if (!canCreate.value) return
  modalMode.value = 'create'
  editingId.value = null
  form.value = {
    name: '',
    provider: 'openai',
    model_kind: 'llm',
    base_url: '',
    credential_ref: '',
    description: '',
    is_private: false,
    group_id: null,
    configText: formatJson({}),
  }
  modalError.value = null
  modalOpen.value = true
}

function openEdit(m: AIModelResponse) {
  if (!canUpdate.value) return
  modalMode.value = 'edit'
  editingId.value = m.model_id
  form.value = {
    name: m.name,
    provider: m.provider,
    model_kind: m.model_kind,
    base_url: m.base_url ?? '',
    credential_ref: m.credential_ref ?? '',
    description: m.description ?? '',
    is_private: m.is_private,
    group_id: m.group_id ?? null,
    configText: formatJson(m.config ?? {}),
  }
  modalError.value = null
  modalOpen.value = true
}

function buildPayload(): { ok: true; value: AIModelCreate } | { ok: false; error: string } {
  const parsed = safeParseJson<Record<string, unknown>>(form.value.configText || '{}')
  if (!parsed.ok) return parsed
  const payload: AIModelCreate = {
    name: form.value.name.trim(),
    provider: form.value.provider.trim(),
    model_kind: form.value.model_kind.trim(),
    base_url: form.value.base_url.trim() || null,
    credential_ref: form.value.credential_ref.trim() || null,
    description: form.value.description.trim() || null,
    config: parsed.value,
    group_id: form.value.group_id ?? null,
    is_private: form.value.is_private,
  }
  return { ok: true, value: payload }
}

async function onSave() {
  modalError.value = null
  saving.value = true
  try {
    const built = buildPayload()
    if (!built.ok) {
      modalError.value = built.error
      return
    }
    if (modalMode.value === 'create') {
      await aiModelApi.create(built.value)
    } else {
      const id = editingId.value
      if (!id) throw new Error('missing modelId')
      const update: AIModelUpdate = built.value as unknown as AIModelUpdate
      await aiModelApi.update(id, update)
    }
    modalOpen.value = false
    await refreshAll()
  } catch (e) {
    modalError.value = e instanceof ApiBusinessError ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

const deletingId = ref<number | null>(null)
async function onDelete(id: number) {
  if (!canDelete.value) return
  if (!confirm('确认删除该模型？')) return
  deletingId.value = id
  try {
    await aiModelApi.remove(id)
    await refreshAll()
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '删除失败'
  } finally {
    deletingId.value = null
  }
}

const chatOpen = ref(false)
const chatModel = ref<AIModelResponse | null>(null)
const prompt = ref('')
const output = ref('')
const streaming = ref(true)
const chatting = ref(false)
let chatAbort: AbortController | null = null

function openChat(m: AIModelResponse) {
  chatModel.value = m
  chatOpen.value = true
  prompt.value = ''
  output.value = ''
  streaming.value = true
}

async function runChat() {
  const m = chatModel.value
  if (!m) return
  const content = prompt.value.trim()
  if (!content) return
  output.value = ''
  chatting.value = true
  try {
    if (!streaming.value) {
      const res = await aiModelApi.chat(
        m.model_id,
        { messages: [{ role: 'user', content }] },
        { stream: false },
      )
      output.value = res.content
      return
    }

    chatAbort?.abort()
    chatAbort = new AbortController()
    await sseJsonPost(
      `/api/v1/models/${m.model_id}/chat?stream=true`,
      { messages: [{ role: 'user', content }] },
      {
        signal: chatAbort.signal,
        onData: (delta) => {
          output.value += delta
        },
      },
    )
  } catch (e) {
    output.value = `Error: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    chatting.value = false
  }
}

function stopChat() {
  chatAbort?.abort()
  chatAbort = null
  chatting.value = false
}
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-lg font-semibold text-slate-900">模型管理</h1>
      <p class="mt-1 text-sm text-slate-600">对接后端 `/api/v1/models`</p>
    </div>
    <div class="flex gap-2">
      <button
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        type="button"
        :disabled="loading"
        @click="refreshAll"
      >
        刷新
      </button>
      <button
        class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
        type="button"
        :disabled="!canCreate"
        @click="openCreate"
      >
        新建模型
      </button>
    </div>
  </div>

  <div
    v-if="errorMsg"
    class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
  >
    {{ errorMsg }}
  </div>

  <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200">
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              ID
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              名称
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              类型
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Provider
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              分组
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              可见性
            </th>
            <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              操作
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200 bg-white">
          <tr v-for="m in items" :key="m.model_id" class="hover:bg-slate-50/60">
            <td class="px-4 py-3 text-sm text-slate-700">{{ m.model_id }}</td>
            <td class="px-4 py-3">
              <div class="text-sm font-medium text-slate-900">{{ m.name }}</div>
              <div class="text-xs text-slate-500">{{ m.base_url || '默认 Base URL' }}</div>
            </td>
            <td class="px-4 py-3 text-sm text-slate-700">{{ m.model_kind }}</td>
            <td class="px-4 py-3 text-sm text-slate-700">{{ m.provider }}</td>
            <td class="px-4 py-3 text-sm text-slate-700">
              {{ groupById.get(m.group_id)?.full_path || groupById.get(m.group_id)?.group_name || `#${m.group_id}` }}
            </td>
            <td class="px-4 py-3 text-sm">
              <span
                class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                :class="m.is_private ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'"
              >
                {{ m.is_private ? '私有' : '共享' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right text-sm">
              <button
                class="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
                type="button"
                @click="openChat(m)"
              >
                测试对话
              </button>
              <button
                class="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                type="button"
                :disabled="!canUpdate"
                @click="openEdit(m)"
              >
                编辑
              </button>
              <button
                class="rounded-lg px-3 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                type="button"
                :disabled="!canDelete || deletingId === m.model_id"
                @click="onDelete(m.model_id)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!loading && items.length === 0">
            <td class="px-4 py-10 text-center text-sm text-slate-500" colspan="7">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div
    v-if="modalOpen"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/30 p-4 py-8"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-lg font-semibold text-slate-900">
            {{ modalMode === 'create' ? '新建模型' : '编辑模型' }}
          </div>
          <div class="mt-1 text-sm text-slate-600">敏感字段建议用 `credential_ref` 引用（不直接存 key）</div>
        </div>
        <button
          class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
          type="button"
          @click="modalOpen = false"
        >
          ×
        </button>
      </div>

      <div
        v-if="modalError"
        class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        {{ modalError }}
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label class="block">
          <div class="text-xs font-semibold text-slate-600">名称</div>
          <input
            v-model="form.name"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label class="block">
          <div class="text-xs font-semibold text-slate-600">Provider</div>
          <input
            v-model="form.provider"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label class="block">
          <div class="text-xs font-semibold text-slate-600">模型类型</div>
          <select
            v-model="form.model_kind"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          >
            <option value="llm">llm</option>
            <option value="embedding">embedding</option>
            <option value="rerank">rerank</option>
          </select>
        </label>
        <label class="block">
          <div class="text-xs font-semibold text-slate-600">分组</div>
          <select
            v-model.number="form.group_id"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
            :disabled="!canReadGroups"
          >
            <option :value="null">默认（当前用户分组）</option>
            <option
              v-if="modalMode === 'edit' && form.group_id !== null && !groupById.has(form.group_id)"
              :value="form.group_id"
            >
              #{{ form.group_id }}
            </option>
            <option v-for="g in groups" :key="g.group_id" :value="g.group_id">
              {{ g.full_path || g.group_name }}
            </option>
          </select>
          <div v-if="!canReadGroups" class="mt-1 text-xs text-amber-700">
            缺少权限：groups.read（无法拉取分组列表）
          </div>
        </label>
        <label class="block md:col-span-2">
          <div class="text-xs font-semibold text-slate-600">Base URL（可选）</div>
          <input
            v-model="form.base_url"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label class="block md:col-span-2">
          <div class="text-xs font-semibold text-slate-600">Credential Ref（可选）</div>
          <input
            v-model="form.credential_ref"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label class="block md:col-span-2">
          <div class="text-xs font-semibold text-slate-600">描述（可选）</div>
          <textarea
            v-model="form.description"
            rows="2"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label class="flex items-center gap-2">
          <input
            v-model="form.is_private"
            type="checkbox"
            class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          <span class="text-sm text-slate-700">私有（仅创建者可见/可改）</span>
        </label>
      </div>

      <div class="mt-4">
        <div class="flex items-center justify-between">
          <div class="text-xs font-semibold text-slate-600">config（JSON）</div>
          <button
            class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            type="button"
            @click="
              () => {
                const parsed = safeParseJson<unknown>(form.configText || '{}')
                if (parsed.ok) form.configText = formatJson(parsed.value)
              }
            "
          >
            格式化
          </button>
        </div>
        <textarea
          v-model="form.configText"
          rows="6"
          class="mt-1 max-h-64 min-h-32 w-full resize-y rounded-xl border-slate-200 px-3 py-2 font-mono text-xs shadow-sm"
        />
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button
          class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          type="button"
          @click="modalOpen = false"
        >
          取消
        </button>
        <button
          class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          type="button"
          :disabled="saving"
          @click="onSave"
        >
          保存
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="chatOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="truncate text-lg font-semibold text-slate-900">测试对话：{{ chatModel?.name }}</div>
          <div class="mt-1 text-sm text-slate-600">对接 `POST /api/v1/models/{id}/chat`（可选 SSE）</div>
        </div>
        <button
          class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
          type="button"
          @click="chatOpen = false"
        >
          ×
        </button>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input
            v-model="streaming"
            type="checkbox"
            class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          SSE 流式输出
        </label>
        <button
          v-if="chatting && streaming"
          class="rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
          type="button"
          @click="stopChat"
        >
          停止
        </button>
      </div>

      <textarea
        v-model="prompt"
        rows="3"
        class="mt-3 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
        placeholder="输入一段提示词…"
      />

      <div class="mt-3 flex justify-end">
        <button
          class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          type="button"
          :disabled="chatting || !prompt.trim()"
          @click="runChat"
        >
          运行
        </button>
      </div>

      <div class="mt-4">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">输出</div>
        <div
          class="mt-2 max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
        >
          {{ output || '—' }}
        </div>
      </div>
    </div>
  </div>
</template>
