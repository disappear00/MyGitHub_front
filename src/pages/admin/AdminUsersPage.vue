<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ApiBusinessError, groupApi, userApi } from '@/lib/api'
import type { GroupResponse, UserResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

type UserFormState = {
  user_name: string
  email: string
  phone: string
  id_card: string
  group_id: number | null
  password: string
  is_active: boolean
  is_email_verified: boolean
}

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const users = ref<UserResponse[]>([])
const groups = ref<GroupResponse[]>([])

const auth = useAuthStore()
auth.initFromStorage()

const canCreate = computed(() => auth.hasPermission('users.create'))
const canUpdate = computed(() => auth.hasPermission('users.update'))
const canDelete = computed(() => auth.hasPermission('users.delete'))

const groupById = computed(() => {
  const map = new Map<number, GroupResponse>()
  for (const g of groups.value) map.set(g.group_id, g)
  return map
})

async function refreshAll() {
  errorMsg.value = null
  loading.value = true
  try {
    const [u, g] = await Promise.all([userApi.list({ order_by_time: true }), groupApi.list({ order_by_path: true })])
    users.value = u
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
const editingUserId = ref<number | null>(null)
const form = ref<UserFormState>({
  user_name: '',
  email: '',
  phone: '',
  id_card: '',
  group_id: null,
  password: '',
  is_active: true,
  is_email_verified: false,
})

function openCreate() {
  if (!canCreate.value) return
  modalMode.value = 'create'
  editingUserId.value = null
  form.value = {
    user_name: '',
    email: '',
    phone: '',
    id_card: '',
    group_id: null,
    password: '',
    is_active: true,
    is_email_verified: false,
  }
  modalOpen.value = true
}

function openEdit(u: UserResponse) {
  if (!canUpdate.value) return
  modalMode.value = 'edit'
  editingUserId.value = u.user_id
  form.value = {
    user_name: u.user_name,
    email: u.email,
    phone: u.phone ?? '',
    id_card: u.id_card ?? '',
    group_id: u.group_id ?? null,
    password: '',
    is_active: u.is_active,
    is_email_verified: u.is_email_verified,
  }
  modalOpen.value = true
}

const saving = ref(false)
const modalError = ref<string | null>(null)

async function onSave() {
  modalError.value = null
  saving.value = true
  try {
    if (modalMode.value === 'create') {
      await userApi.create({
        user_name: form.value.user_name.trim(),
        email: form.value.email.trim(),
        phone: form.value.phone.trim() || null,
        id_card: form.value.id_card.trim() || null,
        group_id: form.value.group_id ?? null,
        password: form.value.password,
      })
    } else {
      const userId = editingUserId.value
      if (!userId) throw new Error('missing userId')
      await userApi.update(userId, {
        user_name: form.value.user_name.trim(),
        email: form.value.email.trim(),
        phone: form.value.phone.trim() || null,
        group_id: form.value.group_id ?? null,
        is_active: form.value.is_active,
        is_email_verified: form.value.is_email_verified,
      })
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
async function onDelete(userId: number) {
  if (!canDelete.value) return
  if (!confirm('确认删除该用户？（后端为软删除）')) return
  deletingId.value = userId
  try {
    await userApi.remove(userId)
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
      <h1 class="text-lg font-semibold text-slate-900">用户管理</h1>
      <p class="mt-1 text-sm text-slate-600">对接后端 `/api/v1/users`</p>
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
        class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        type="button"
        :disabled="!canCreate"
        @click="openCreate"
      >
        新建用户
      </button>
    </div>
  </div>

  <div v-if="errorMsg" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
    {{ errorMsg }}
  </div>

  <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200">
    <table class="min-w-full divide-y divide-slate-200">
      <thead class="bg-slate-50">
        <tr>
          <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">ID</th>
          <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">用户名</th>
          <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">邮箱</th>
          <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">分组</th>
          <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">状态</th>
          <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">操作</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200 bg-white">
        <tr v-for="u in users" :key="u.user_id" class="hover:bg-slate-50/60">
          <td class="px-4 py-3 text-sm text-slate-700">{{ u.user_id }}</td>
          <td class="px-4 py-3">
            <div class="text-sm font-medium text-slate-900">{{ u.user_name }}</div>
            <div class="text-xs text-slate-500">{{ u.phone || '—' }}</div>
          </td>
          <td class="px-4 py-3 text-sm text-slate-700">{{ u.email }}</td>
          <td class="px-4 py-3 text-sm text-slate-700">
            {{ u.group_id ? groupById.get(u.group_id)?.full_path || groupById.get(u.group_id)?.group_name || `#${u.group_id}` : '—' }}
          </td>
          <td class="px-4 py-3 text-sm">
            <span
              class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
              :class="u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'"
            >
              {{ u.is_active ? '启用' : '禁用' }}
            </span>
            <span
              class="ml-2 inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
              :class="u.is_email_verified ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-800'"
            >
              {{ u.is_email_verified ? '已验证' : '未验证' }}
            </span>
          </td>
          <td class="px-4 py-3 text-right text-sm">
            <button
              class="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              type="button"
              :disabled="!canUpdate"
              @click="openEdit(u)"
            >
              编辑
            </button>
            <button
              class="rounded-lg px-3 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              type="button"
              :disabled="!canDelete || deletingId === u.user_id"
              @click="onDelete(u.user_id)"
            >
              删除
            </button>
          </td>
        </tr>
        <tr v-if="!loading && users.length === 0">
          <td class="px-4 py-10 text-center text-sm text-slate-500" colspan="6">暂无数据</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="modalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true">
    <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-lg font-semibold text-slate-900">{{ modalMode === 'create' ? '新建用户' : '编辑用户' }}</div>
          <div class="mt-1 text-sm text-slate-600">密码仅在新建时需要</div>
        </div>
        <button class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" type="button" @click="modalOpen = false">✕</button>
      </div>

      <div v-if="modalError" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {{ modalError }}
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="sm:col-span-1">
          <label class="block text-sm font-medium text-slate-700">用户名</label>
          <input v-model="form.user_name" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-sm font-medium text-slate-700">邮箱</label>
          <input v-model="form.email" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-sm font-medium text-slate-700">手机号</label>
          <input v-model="form.phone" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-sm font-medium text-slate-700">分组</label>
          <select v-model.number="form.group_id" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400">
            <option :value="null">—</option>
            <option v-for="g in groups" :key="g.group_id" :value="g.group_id">{{ g.full_path || g.group_name }}</option>
          </select>
        </div>
        <div v-if="modalMode === 'create'" class="sm:col-span-2">
          <label class="block text-sm font-medium text-slate-700">初始密码</label>
          <input
            v-model="form.password"
            type="password"
            class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
            placeholder="至少 8 位"
          />
        </div>
        <div v-else class="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input v-model="form.is_active" type="checkbox" class="rounded border-slate-300 text-slate-900 focus:ring-slate-400" />
            启用
          </label>
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input v-model="form.is_email_verified" type="checkbox" class="rounded border-slate-300 text-slate-900 focus:ring-slate-400" />
            邮箱已验证
          </label>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button
          class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          type="button"
          @click="modalOpen = false"
        >
          取消
        </button>
        <button
          class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          :disabled="saving || (modalMode === 'create' ? !canCreate : !canUpdate)"
          @click="onSave"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>
