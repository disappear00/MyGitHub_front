<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import GroupTree from '@/components/admin/GroupTree.vue'
import { ApiBusinessError, groupApi } from '@/lib/api'
import type { GroupResponse } from '@/lib/types'

type TreeNode = GroupResponse & { children: TreeNode[] }

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const groups = ref<GroupResponse[]>([])
const selectedId = ref<number | null>(null)

const tree = computed<TreeNode[]>(() => {
  const byId = new Map<number, TreeNode>()
  for (const g of groups.value) byId.set(g.group_id, { ...g, children: [] })

  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    const parentId = node.parent_id
    if (parentId && byId.has(parentId)) byId.get(parentId)!.children.push(node)
    else roots.push(node)
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.group_id - b.group_id)
    for (const n of nodes) sort(n.children)
  }
  sort(roots)
  return roots
})

const selected = computed(() => groups.value.find((g) => g.group_id === selectedId.value) ?? null)

async function refresh() {
  errorMsg.value = null
  loading.value = true
  try {
    groups.value = await groupApi.list({ order_by_path: true })
    if (selectedId.value && !groups.value.some((g) => g.group_id === selectedId.value)) selectedId.value = null
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const formName = ref('')
const formParentId = ref<number | null>(null)
const formSortOrder = ref(0)
const saving = ref(false)
const modalError = ref<string | null>(null)

function openCreate(parentId?: number | null) {
  modalMode.value = 'create'
  modalError.value = null
  formName.value = ''
  formParentId.value = parentId ?? null
  formSortOrder.value = 0
  modalOpen.value = true
}

function openEdit() {
  if (!selected.value) return
  modalMode.value = 'edit'
  modalError.value = null
  formName.value = selected.value.group_name
  formParentId.value = selected.value.parent_id
  formSortOrder.value = selected.value.sort_order
  modalOpen.value = true
}

async function onSave() {
  modalError.value = null
  saving.value = true
  try {
    const payload = { group_name: formName.value.trim(), parent_id: formParentId.value, sort_order: formSortOrder.value }
    if (modalMode.value === 'create') {
      await groupApi.create(payload)
    } else {
      if (!selected.value) throw new Error('missing selection')
      await groupApi.update(selected.value.group_id, payload)
    }
    modalOpen.value = false
    await refresh()
  } catch (e) {
    modalError.value = e instanceof ApiBusinessError ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (!selected.value) return
  if (!confirm('确认删除该分组？')) return
  try {
    await groupApi.remove(selected.value.group_id)
    selectedId.value = null
    await refresh()
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '删除失败'
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-lg font-semibold text-slate-900">分组管理</h1>
      <p class="mt-1 text-sm text-slate-600">树形展示（基于 `parent_id` 构建）</p>
    </div>
    <div class="flex gap-2">
      <button
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        type="button"
        :disabled="loading"
        @click="refresh"
      >
        刷新
      </button>
      <button class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800" type="button" @click="openCreate(null)">
        新建根分组
      </button>
    </div>
  </div>

  <div v-if="errorMsg" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
    {{ errorMsg }}
  </div>

  <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
    <div class="rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">分组树</div>
      <div class="mt-2">
        <GroupTree :nodes="tree" :selected-id="selectedId" @select="(id:number)=> (selectedId = id)" @create-child="openCreate" />
      </div>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-slate-900">详情</div>
          <div class="mt-1 text-xs text-slate-500">选择一个分组查看</div>
        </div>
        <div class="flex gap-2">
          <button
            class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            type="button"
            :disabled="!selected"
            @click="openEdit"
          >
            编辑
          </button>
          <button
            class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-50"
            type="button"
            :disabled="!selected"
            @click="onDelete"
          >
            删除
          </button>
        </div>
      </div>

      <div v-if="selected" class="mt-4 space-y-2 text-sm text-slate-700">
        <div><span class="text-slate-500">ID：</span>{{ selected.group_id }}</div>
        <div><span class="text-slate-500">名称：</span>{{ selected.group_name }}</div>
        <div><span class="text-slate-500">路径：</span>{{ selected.full_path || '—' }}</div>
        <div><span class="text-slate-500">父级：</span>{{ selected.parent_id ?? '—' }}</div>
        <div><span class="text-slate-500">排序：</span>{{ selected.sort_order }}</div>
        <button class="mt-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800" type="button" @click="openCreate(selected.group_id)">
          新建子分组
        </button>
      </div>
      <div v-else class="mt-6 text-sm text-slate-500">请选择分组</div>
    </div>
  </div>

  <div v-if="modalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true">
    <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
      <div class="flex items-start justify-between gap-4">
        <div class="text-lg font-semibold text-slate-900">{{ modalMode === 'create' ? '新建分组' : '编辑分组' }}</div>
        <button class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" type="button" @click="modalOpen = false">✕</button>
      </div>

      <div v-if="modalError" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {{ modalError }}
      </div>

      <div class="mt-4 space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700">名称</label>
          <input v-model="formName" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" />
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm font-medium text-slate-700">父级</label>
            <select v-model.number="formParentId" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400">
              <option :value="null">（根）</option>
              <option v-for="g in groups" :key="g.group_id" :value="g.group_id">{{ g.full_path || g.group_name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700">排序</label>
            <input v-model.number="formSortOrder" type="number" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" />
          </div>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" type="button" @click="modalOpen = false">
          取消
        </button>
        <button
          class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          :disabled="saving"
          @click="onSave"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

