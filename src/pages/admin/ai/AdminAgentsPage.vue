<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { agentApi, aiModelApi, ApiBusinessError, groupApi, knowledgeBaseApi, mcpApi } from '@/lib/api'
import { formatJson, safeParseJson } from '@/lib/json'
import type {
  AgentCreate,
  AgentResponse,
  AgentUpdate,
  AIModelResponse,
  GroupResponse,
  KnowledgeBaseResponse,
  McpToolInfo,
} from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

type AgentFormState = {
  name: string
  description: string
  system_prompt: string
  model_id: number | null
  group_id: number | null
  is_private: boolean
  configText: string
}

const auth = useAuthStore()
auth.initFromStorage()

const canCreate = computed(() => auth.hasPermission('agents.create'))
const canUpdate = computed(() => auth.hasPermission('agents.update'))
const canDelete = computed(() => auth.hasPermission('agents.delete'))
const canReadModels = computed(() => auth.hasPermission('models.read'))
const canReadGroups = computed(() => auth.hasPermission('groups.read'))
const canReadKBs = computed(() => auth.hasPermission('knowledge_bases.read'))

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const items = ref<AgentResponse[]>([])
const models = ref<AIModelResponse[]>([])
const groups = ref<GroupResponse[]>([])
const knowledgeBases = ref<KnowledgeBaseResponse[]>([])
const mcpTools = ref<McpToolInfo[]>([])

const modelNameById = computed(() => {
  const map = new Map<number, string>()
  for (const m of models.value) map.set(m.model_id, m.name)
  return map
})

const groupById = computed(() => {
  const map = new Map<number, GroupResponse>()
  for (const g of groups.value) map.set(g.group_id, g)
  return map
})

async function refreshAll() {
  loading.value = true
  errorMsg.value = null
  try {
    const [a, m, g, kbs, tools] = await Promise.all([
      agentApi.list(),
      canReadModels.value ? aiModelApi.list() : Promise.resolve([]),
      canReadGroups.value ? groupApi.list({ order_by_path: true }) : Promise.resolve([]),
      canReadKBs.value ? knowledgeBaseApi.list() : Promise.resolve([]),
      mcpApi
        .listTools()
        .catch(() => []),
    ])
    items.value = a
    models.value = m
    groups.value = g
    knowledgeBases.value = kbs
    mcpTools.value = tools
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
const showRawConfig = ref(false)
const toolSearch = ref('')

function _readConfig(): Record<string, unknown> {
  const parsed = safeParseJson<Record<string, unknown>>(form.value.configText || '{}')
  if (!parsed.ok) return {}
  return parsed.value
}

function _writeConfig(next: Record<string, unknown>) {
  form.value.configText = formatJson(next ?? {})
}

function _patchConfig(patch: Record<string, unknown>) {
  const cur = _readConfig()
  _writeConfig({ ...cur, ...patch })
}

const configKbIds = computed<number[]>({
  get() {
    const v = _readConfig().kb_ids
    if (!Array.isArray(v)) return []
    const ids = v
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 50)
    return Array.from(new Set(ids))
  },
  set(nextIds) {
    const ids = Array.from(new Set(nextIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)))
    _patchConfig({ kb_ids: ids })
  },
})

const configAllowedTools = computed<string[]>({
  get() {
    const v = _readConfig().allowed_tools ?? _readConfig().tool_allowlist
    if (!Array.isArray(v)) return []
    return Array.from(new Set(v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean))).slice(0, 200)
  },
  set(nextTools) {
    const tools = Array.from(new Set(nextTools.map((x) => String(x)).map((s) => s.trim()).filter(Boolean))).slice(
      0,
      200,
    )
    _patchConfig({ allowed_tools: tools })
  },
})

function toggleKbId(kbId: number) {
  const set = new Set(configKbIds.value)
  if (set.has(kbId)) set.delete(kbId)
  else set.add(kbId)
  configKbIds.value = Array.from(set)
}

function toggleTool(name: string) {
  const set = new Set(configAllowedTools.value)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  configAllowedTools.value = Array.from(set)
}

function clearAllowedTools() {
  configAllowedTools.value = []
}

const filteredTools = computed(() => {
  const q = toolSearch.value.trim().toLowerCase()
  if (!q) return mcpTools.value
  return mcpTools.value.filter((t) => {
    return t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
  })
})

const form = ref<AgentFormState>({
  name: '',
  description: '',
  system_prompt: '',
  model_id: null,
  group_id: null,
  is_private: true,
  configText: formatJson({ kb_ids: [] }),
})

function openCreate() {
  if (!canCreate.value) return
  modalMode.value = 'create'
  editingId.value = null
  showRawConfig.value = false
  form.value = {
    name: '',
    description: '',
    system_prompt: '',
    model_id: models.value.find((x) => x.model_kind === 'llm')?.model_id ?? null,
    group_id: null,
    is_private: true,
    configText: formatJson({ kb_ids: [] }),
  }
  modalError.value = null
  modalOpen.value = true
}

function openEdit(a: AgentResponse) {
  if (!canUpdate.value) return
  modalMode.value = 'edit'
  editingId.value = a.agent_id
  showRawConfig.value = false
  form.value = {
    name: a.name,
    description: a.description ?? '',
    system_prompt: a.system_prompt ?? '',
    model_id: a.model_id ?? null,
    group_id: a.group_id ?? null,
    is_private: a.is_private,
    configText: formatJson(a.config ?? {}),
  }
  modalError.value = null
  modalOpen.value = true
}

function buildPayload(): { ok: true; value: AgentCreate } | { ok: false; error: string } {
  const parsed = safeParseJson<Record<string, unknown>>(form.value.configText || '{}')
  if (!parsed.ok) return parsed
  const payload: AgentCreate = {
    name: form.value.name.trim(),
    description: form.value.description.trim() || null,
    system_prompt: form.value.system_prompt.trim() || null,
    model_id: form.value.model_id ?? null,
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
      await agentApi.create(built.value)
    } else {
      const id = editingId.value
      if (!id) throw new Error('missing agentId')
      const update: AgentUpdate = built.value as unknown as AgentUpdate
      await agentApi.update(id, update)
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
  if (!confirm('确认删除该智能体？')) return
  deletingId.value = id
  try {
    await agentApi.remove(id)
    await refreshAll()
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '删除失败'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-lg font-semibold text-slate-900">智能体管理</h1>
      <p class="mt-1 text-sm text-slate-600">对接后端 `/api/v1/agents`</p>
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
        新建智能体
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
              模型
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
          <tr v-for="a in items" :key="a.agent_id" class="hover:bg-slate-50/60">
            <td class="px-4 py-3 text-sm text-slate-700">{{ a.agent_id }}</td>
            <td class="px-4 py-3">
              <div class="text-sm font-medium text-slate-900">{{ a.name }}</div>
              <div class="text-xs text-slate-500">{{ a.description || '—' }}</div>
            </td>
            <td class="px-4 py-3 text-sm text-slate-700">
              {{ a.model_id ? (modelNameById.get(a.model_id) ?? `#${a.model_id}`) : '未绑定' }}
            </td>
            <td class="px-4 py-3 text-sm text-slate-700">
              {{ groupById.get(a.group_id)?.full_path || groupById.get(a.group_id)?.group_name || `#${a.group_id}` }}
            </td>
            <td class="px-4 py-3 text-sm">
              <span
                class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                :class="a.is_private ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'"
              >
                {{ a.is_private ? '私有' : '共享' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right text-sm">
              <button
                class="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                type="button"
                :disabled="!canUpdate"
                @click="openEdit(a)"
              >
                编辑
              </button>
              <button
                class="rounded-lg px-3 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                type="button"
                :disabled="!canDelete || deletingId === a.agent_id"
                @click="onDelete(a.agent_id)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!loading && items.length === 0">
            <td class="px-4 py-10 text-center text-sm text-slate-500" colspan="6">暂无数据</td>
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
      class="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-lg font-semibold text-slate-900">
            {{ modalMode === 'create' ? '新建智能体' : '编辑智能体' }}
          </div>
          <div class="mt-1 text-sm text-slate-600">前台对话页将按权限读取并使用这些智能体</div>
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
        <label class="block md:col-span-2">
          <div class="text-xs font-semibold text-slate-600">名称</div>
          <input
            v-model="form.name"
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

        <label class="block md:col-span-2">
          <div class="text-xs font-semibold text-slate-600">System Prompt（可选）</div>
          <textarea
            v-model="form.system_prompt"
            rows="4"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          />
        </label>

        <label class="block">
          <div class="text-xs font-semibold text-slate-600">模型</div>
          <select
            v-model="form.model_id"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
            :disabled="!canReadModels || models.length === 0"
          >
            <option :value="null">未选择</option>
            <option v-if="form.model_id !== null && !modelNameById.has(form.model_id)" :value="form.model_id">
              #{{ form.model_id }}
            </option>
            <option
              v-for="m in models.filter((x) => x.model_kind === 'llm')"
              :key="m.model_id"
              :value="m.model_id"
            >
              {{ m.name }}
            </option>
          </select>
          <div v-if="!canReadModels" class="mt-1 text-xs text-amber-700">
            缺少权限：models.read（无法拉取模型列表）
          </div>
          <div v-else-if="models.length === 0" class="mt-1 text-xs text-slate-500">暂无可用模型</div>
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

        <label class="flex items-center gap-2">
          <input
            v-model="form.is_private"
            type="checkbox"
            class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          <span class="text-sm text-slate-700">私有（默认建议开启）</span>
        </label>
      </div>

      <div class="mt-4">
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-700">知识库（kb_ids）</div>
              <div class="text-xs text-slate-500">{{ configKbIds.length }} 个</div>
            </div>
            <div v-if="!canReadKBs" class="mt-2 text-xs text-amber-700">缺少权限：knowledge_bases.read</div>
            <div v-else-if="knowledgeBases.length === 0" class="mt-2 text-xs text-slate-500">暂无知识库</div>
            <div v-else class="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              <label
                v-for="kb in knowledgeBases"
                :key="kb.kb_id"
                class="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm text-slate-900">{{ kb.name }}</div>
                  <div class="truncate text-xs text-slate-500">#{{ kb.kb_id }}</div>
                </div>
                <input
                  type="checkbox"
                  class="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  :checked="configKbIds.includes(kb.kb_id)"
                  @change="() => toggleKbId(kb.kb_id)"
                />
              </label>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs font-semibold text-slate-700">MCP 工具（allowed_tools）</div>
              <button
                class="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                type="button"
                @click="clearAllowedTools"
              >
                清空
              </button>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <input
                v-model="toolSearch"
                class="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
                placeholder="搜索工具名/描述…"
              />
              <div class="shrink-0 text-xs text-slate-500">{{ configAllowedTools.length }} 个</div>
            </div>
            <div v-if="mcpTools.length === 0" class="mt-2 text-xs text-slate-500">
              无法加载工具列表（需要 agents.read 权限）
            </div>
            <div v-else class="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              <label
                v-for="t in filteredTools"
                :key="t.name"
                class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-slate-900">{{ t.name }}</div>
                  <div class="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{{ t.description }}</div>
                  <div v-if="t.required_permission_codes?.length" class="mt-1 text-xs text-slate-500">
                    权限：{{ t.required_permission_codes.join(', ') }}
                  </div>
                </div>
                <input
                  type="checkbox"
                  class="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  :checked="configAllowedTools.includes(t.name)"
                  @change="() => toggleTool(t.name)"
                />
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="text-xs font-semibold text-slate-600">config（JSON）</div>
          <button
            class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            type="button"
            @click="showRawConfig = !showRawConfig"
          >
            {{ showRawConfig ? '隐藏' : '显示' }}原始 JSON
          </button>
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
          v-if="showRawConfig"
          v-model="form.configText"
          rows="6"
          class="mt-2 max-h-64 min-h-32 w-full resize-y rounded-xl border-slate-200 px-3 py-2 font-mono text-xs shadow-sm"
        />
        <div class="mt-2 text-xs text-slate-500">
          建议在 config 中配置：`kb_ids`、`allowed_tools` 等（由后端 Agent runner 使用）
        </div>
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
</template>
