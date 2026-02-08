<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { aiModelApi, ApiBusinessError, groupApi, knowledgeBaseApi } from '@/lib/api'
import { formatJson } from '@/lib/json'
import type {
  AIModelResponse,
  GroupResponse,
  KBDocumentResponse,
  KBQueryResponse,
  KnowledgeBaseResponse,
} from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

const canUpdate = computed(() => auth.hasPermission('knowledge_bases.update'))
const canReadModels = computed(() => auth.hasPermission('models.read'))
const canReadGroups = computed(() => auth.hasPermission('groups.read'))

const route = useRoute()
const router = useRouter()

const kbId = computed(() => Number(route.params.kbId))

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const kb = ref<KnowledgeBaseResponse | null>(null)
const docs = ref<KBDocumentResponse[]>([])
const models = ref<AIModelResponse[]>([])
const groups = ref<GroupResponse[]>([])

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

const uploading = ref(false)
const uploadError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const scrapeUrl = ref('')
const crawlAdditional = ref(false)
const maxPages = ref(10)
const maxDepth = ref(1)
const scraping = ref(false)
const scrapeError = ref<string | null>(null)

const queryText = ref('')
const topK = ref(5)
const querying = ref(false)
const queryError = ref<string | null>(null)
const queryRes = ref<KBQueryResponse | null>(null)

async function refreshAll() {
  loading.value = true
  errorMsg.value = null
  try {
    const id = kbId.value
    if (!Number.isFinite(id) || id <= 0) throw new Error('invalid kbId')
    const [k, d, m, g] = await Promise.all([
      knowledgeBaseApi.get(id),
      knowledgeBaseApi.listDocuments(id),
      canReadModels.value ? aiModelApi.list() : Promise.resolve([]),
      canReadGroups.value ? groupApi.list({ order_by_path: true }) : Promise.resolve([]),
    ])
    kb.value = k
    docs.value = d
    models.value = m
    groups.value = g
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(refreshAll)

async function onUpload() {
  uploadError.value = null
  const id = kbId.value
  const file = fileInput.value?.files?.[0]
  if (!file) {
    uploadError.value = '请选择文件'
    return
  }
  uploading.value = true
  try {
    await knowledgeBaseApi.uploadDocument(id, file)
    if (fileInput.value) fileInput.value.value = ''
    await refreshAll()
  } catch (e) {
    uploadError.value = e instanceof ApiBusinessError ? e.message : '上传失败'
  } finally {
    uploading.value = false
  }
}

async function onQuery() {
  queryError.value = null
  queryRes.value = null
  const id = kbId.value
  const q = queryText.value.trim()
  if (!q) return
  querying.value = true
  try {
    queryRes.value = await knowledgeBaseApi.query(id, { query: q, top_k: topK.value })
  } catch (e) {
    queryError.value = e instanceof ApiBusinessError ? e.message : '检索失败'
  } finally {
    querying.value = false
  }
}

async function onScrape() {
  scrapeError.value = null
  const id = kbId.value
  const url = scrapeUrl.value.trim()
  if (!url) {
    scrapeError.value = '请输入URL'
    return
  }
  
  scraping.value = true
  try {
    // 显示进度提示
    scrapeError.value = crawlAdditional.value ? '正在爬取网页及额外链接，这可能需要一些时间...' : '正在爬取网页...'
    
    await knowledgeBaseApi.scrapeWebContent(id, {
      url,
      crawl_additional: crawlAdditional.value,
      max_pages: maxPages.value,
      max_depth: maxDepth.value,
    })
    
    // 清除进度提示
    scrapeError.value = null
    scrapeUrl.value = ''
    await refreshAll()
  } catch (e) {
    scrapeError.value = e instanceof ApiBusinessError ? e.message : '爬取失败'
  } finally {
    scraping.value = false
  }
}

function fmtDate(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <h1 class="truncate text-lg font-semibold text-slate-900">知识库详情：{{ kb?.name ?? `#${kbId}` }}</h1>
      <p class="mt-1 text-sm text-slate-600">文档上传与检索调试</p>
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
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        type="button"
        @click="router.push({ name: 'admin-ai-kbs' })"
      >
        返回列表
      </button>
    </div>
  </div>

  <div
    v-if="errorMsg"
    class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
  >
    {{ errorMsg }}
  </div>

  <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-slate-900">知识库信息</div>
        <span
          v-if="kb"
          class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
          :class="kb.is_private ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'"
        >
          {{ kb.is_private ? '私有' : '共享' }}
        </span>
      </div>

      <div v-if="kb" class="mt-3 space-y-2 text-sm text-slate-700">
        <div class="flex items-center justify-between gap-3">
          <div class="text-slate-500">ID</div>
          <div class="font-medium">{{ kb.kb_id }}</div>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="text-slate-500">Embedding</div>
          <div class="font-medium">
            {{
              kb.embedding_model_id
                ? (modelNameById.get(kb.embedding_model_id) ?? `#${kb.embedding_model_id}`)
                : '—'
            }}
          </div>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="text-slate-500">Group</div>
          <div class="font-medium">
            {{ groupById.get(kb.group_id)?.full_path || groupById.get(kb.group_id)?.group_name || `#${kb.group_id}` }}
          </div>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="text-slate-500">Updated</div>
          <div class="font-medium">{{ fmtDate(kb.updated_at) }}</div>
        </div>
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">config</div>
          <pre
            class="mt-2 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
            >{{ formatJson(kb.config ?? {}) }}</pre
          >
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="text-sm font-semibold text-slate-900">上传文档</div>
      <p class="mt-1 text-xs text-slate-500">
        对接 `POST /api/v1/knowledge-bases/{id}/documents`（字段名 `file`）
      </p>

      <div
        v-if="!canUpdate"
        class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        缺少权限：knowledge_bases.update（上传会被禁止）
      </div>

      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref="fileInput"
          type="file"
          class="block w-full text-sm text-slate-700"
          :disabled="!canUpdate || uploading"
        />
        <button
          class="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          type="button"
          :disabled="!canUpdate || uploading"
          @click="onUpload"
        >
          上传
        </button>
      </div>

      <div
        v-if="uploadError"
        class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        {{ uploadError }}
      </div>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="text-sm font-semibold text-slate-900">爬取网页</div>
      <p class="mt-1 text-xs text-slate-500">
        对接 `POST /api/v1/knowledge-bases/{id}/scrape` - 输入URL爬取网页内容
      </p>

      <div
        v-if="!canUpdate"
        class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        缺少权限：knowledge_bases.update（爬取会被禁止）
      </div>

      <div class="mt-3 space-y-3">
        <div>
          <label class="block">
            <div class="text-xs font-semibold text-slate-600">URL地址</div>
            <input
              v-model="scrapeUrl"
              class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
              placeholder="https://example.com/article"
            />
          </label>
        </div>
        
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="block">
            <div class="text-xs font-semibold text-slate-600">最大页面数</div>
            <input
              v-model.number="maxPages"
              type="number"
              min="1"
              max="50"
              class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
            />
          </label>
          
          <label class="block">
            <div class="text-xs font-semibold text-slate-600">最大深度</div>
            <input
              v-model.number="maxDepth"
              type="number"
              min="0"
              max="3"
              class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
            />
          </label>
          
          <label class="flex items-center">
            <input
              v-model="crawlAdditional"
              type="checkbox"
              class="rounded border-slate-300"
            />
            <span class="ml-2 text-sm text-slate-700">爬取额外链接</span>
          </label>
        </div>
        
        <button
          class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          type="button"
          :disabled="!canUpdate || scraping || !scrapeUrl.trim()"
          @click="onScrape"
        >
          开始爬取
        </button>
      </div>

      <div
        v-if="scrapeError"
        class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        {{ scrapeError }}
      </div>
    </section>
  </div>

  <section class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold text-slate-900">文档列表</div>
      <div class="text-xs text-slate-500">{{ docs.length }} 条</div>
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
                文件名
              </th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                状态
              </th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                更新时间
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr v-for="d in docs" :key="d.document_id" class="hover:bg-slate-50/60">
              <td class="px-4 py-3 text-sm text-slate-700">{{ d.document_id }}</td>
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-slate-900">{{ d.file_name }}</div>
                <div class="text-xs text-slate-500">{{ d.source_type }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-slate-700">{{ d.status }}</td>
              <td class="px-4 py-3 text-sm text-slate-700">{{ fmtDate(d.updated_at) }}</td>
            </tr>
            <tr v-if="!loading && docs.length === 0">
              <td class="px-4 py-8 text-center text-sm text-slate-500" colspan="4">暂无文档</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="text-sm font-semibold text-slate-900">检索调试</div>
    <p class="mt-1 text-xs text-slate-500">对接 `POST /api/v1/knowledge-bases/{id}/query`</p>

    <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto] md:items-end">
      <label class="block">
        <div class="text-xs font-semibold text-slate-600">Query</div>
        <input
          v-model="queryText"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
          placeholder="输入检索内容…"
        />
      </label>
      <label class="block">
        <div class="text-xs font-semibold text-slate-600">Top K</div>
        <input
          v-model.number="topK"
          type="number"
          min="1"
          max="50"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm shadow-sm"
        />
      </label>
      <button
        class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
        type="button"
        :disabled="querying || !queryText.trim()"
        @click="onQuery"
      >
        检索
      </button>
    </div>

    <div
      v-if="queryError"
      class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      {{ queryError }}
    </div>

    <div v-if="queryRes" class="mt-4 space-y-3">
      <div class="text-xs text-slate-500">命中：{{ queryRes.hits.length }} 条</div>
      <div
        v-for="h in queryRes.hits"
        :key="h.chunk_id"
        class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-semibold text-slate-900">Chunk #{{ h.chunk_id }}</div>
          <div class="text-xs font-medium text-slate-600">score: {{ h.score.toFixed(4) }}</div>
        </div>
        <div class="mt-2 whitespace-pre-wrap text-sm text-slate-700">{{ h.content }}</div>
        <details class="mt-3">
          <summary class="cursor-pointer text-xs font-medium text-slate-600">meta</summary>
          <pre class="mt-2 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs">{{
            formatJson(h.meta ?? {})
          }}</pre>
        </details>
      </div>
    </div>
  </section>
</template>