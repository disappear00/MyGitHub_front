<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { ApiBusinessError, groupApi, permissionApi } from '@/lib/api'
import type { GroupPermissionItem, GroupResponse, PermissionResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const groups = ref<GroupResponse[]>([])
const permissions = ref<PermissionResponse[]>([])

const principalGroupId = ref<number | null>(null)
const rules = ref<GroupPermissionItem[]>([])

const canGrant = computed(() => auth.hasPermission('permissions.grant'))

const groupById = computed(() => {
  const map = new Map<number, GroupResponse>()
  for (const g of groups.value) map.set(g.group_id, g)
  return map
})

const principal = computed(() =>
  principalGroupId.value ? (groupById.value.get(principalGroupId.value) ?? null) : null,
)

const subtreeGroupOptions = computed(() => {
  const p = principal.value
  if (!p || !p.full_path) return []
  const prefix = p.full_path
  return groups.value
    .filter((g) => g.full_path === prefix || Boolean(g.full_path?.startsWith(`${prefix} > `)))
    .sort((a, b) => (a.full_path ?? '').localeCompare(b.full_path ?? ''))
})

const permissionOptions = computed(() => {
  return [...permissions.value].sort(
    (a, b) => (a.category || '').localeCompare(b.category || '') || a.code.localeCompare(b.code),
  )
})

async function grantAll() {
  if (!principalGroupId.value) return
  if (!canGrant.value) return
  if (permissionOptions.value.length === 0) return

  const ok = window.confirm('将为该分组分配全部权限（ALLOW / SUBTREE），并覆盖当前规则。是否继续？')
  if (!ok) return

  rules.value = permissionOptions.value.map((p) => ({
    permission_code: p.code,
    effect: 'ALLOW',
    scope: 'SUBTREE',
    scope_group_id: null,
  }))

  await save()
}

async function clearAll() {
  if (!principalGroupId.value) return
  if (!canGrant.value) return

  const ok = window.confirm('将清空该分组的所有权限规则，并立即保存。是否继续？')
  if (!ok) return

  rules.value = []
  await save()
}

function addRule() {
  if (!principalGroupId.value) return
  rules.value.push({
    permission_code: permissionOptions.value[0]?.code ?? '',
    effect: 'ALLOW',
    scope: 'SUBTREE',
    scope_group_id: null,
  })
}

function removeRule(index: number) {
  rules.value.splice(index, 1)
}

async function loadBase() {
  errorMsg.value = null
  loading.value = true
  try {
    const [g, p] = await Promise.all([
      groupApi.list({ order_by_path: true }),
      permissionApi.listPermissions({ assignable_only: true }),
    ])
    groups.value = g
    permissions.value = p

    const firstGroup = g.at(0)
    if (!principalGroupId.value && firstGroup) principalGroupId.value = firstGroup.group_id
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : 'Load failed'
  } finally {
    loading.value = false
  }
}

async function loadGroupRules(groupId: number) {
  errorMsg.value = null
  loading.value = true
  try {
    const res = await permissionApi.getGroupPermissions(groupId)
    rules.value = res.items.map((i) => ({
      permission_code: i.permission_code,
      effect: i.effect,
      scope: i.scope,
      scope_group_id: i.scope_group_id ?? null,
    }))
  } catch (e) {
    rules.value = []
    errorMsg.value = e instanceof ApiBusinessError ? e.message : 'Load failed'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!principalGroupId.value) return
  if (!canGrant.value) return
  errorMsg.value = null
  saving.value = true
  try {
    const payload = {
      items: rules.value
        .map((r) => ({
          permission_code: r.permission_code.trim(),
          effect: r.effect,
          scope: r.scope,
          scope_group_id: r.scope_group_id ?? null,
        }))
        .filter((r) => r.permission_code.length > 0),
    }
    await permissionApi.replaceGroupPermissions(principalGroupId.value, payload)
    await loadGroupRules(principalGroupId.value)
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : 'Save failed'
  } finally {
    saving.value = false
  }
}

watch(
  () => principalGroupId.value,
  async (id) => {
    if (!id) return
    await loadGroupRules(id)
  },
)

onMounted(loadBase)
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-lg font-semibold text-slate-900">Permissions</h1>
      <p class="mt-1 text-sm text-slate-600">Manage group permissions (direct rules).</p>
    </div>
    <div class="flex gap-2">
      <button
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        type="button"
        :disabled="loading"
        @click="loadBase"
      >
        Refresh
      </button>
      <button
        class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        :disabled="saving || !canGrant || !principalGroupId"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <button
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        :disabled="saving || loading || !canGrant || !principalGroupId"
        @click="clearAll"
      >
        清空全部权限
      </button>
      <button
        class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        :disabled="saving || loading || !canGrant || !principalGroupId || permissionOptions.length === 0"
        @click="grantAll"
      >
        一键分配全部权限
      </button>
    </div>
  </div>

  <div
    v-if="errorMsg"
    class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
  >
    {{ errorMsg }}
  </div>

  <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
    <div class="rounded-2xl border border-slate-200 bg-white p-4">
      <div class="text-sm font-semibold text-slate-900">Principal Group</div>
      <div class="mt-2">
        <select
          v-model.number="principalGroupId"
          class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
        >
          <option v-for="g in groups" :key="g.group_id" :value="g.group_id">
            {{ g.full_path || g.group_name }}
          </option>
        </select>
      </div>
      <div class="mt-3 text-xs text-slate-500">
        Scope group id is limited to the principal group subtree (server validates).
      </div>
      <button
        class="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        :disabled="!canGrant || !principalGroupId"
        @click="addRule"
      >
        Add Rule
      </button>
    </div>

    <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div class="max-h-[calc(100vh-320px)] overflow-auto">
        <table class="min-w-full divide-y divide-slate-200">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Permission
              </th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Effect
              </th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Scope
              </th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Scope Group
              </th>
              <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr v-for="(r, idx) in rules" :key="idx" class="hover:bg-slate-50/60">
              <td class="px-4 py-3">
                <select
                  v-model="r.permission_code"
                  class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
                  :disabled="!canGrant"
                >
                  <option v-for="p in permissionOptions" :key="p.code" :value="p.code">
                    {{ p.category }} · {{ p.name }} ({{ p.code }})
                  </option>
                </select>
              </td>
              <td class="px-4 py-3">
                <select
                  v-model="r.effect"
                  class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
                  :disabled="!canGrant"
                >
                  <option value="ALLOW">ALLOW</option>
                  <option value="DENY">DENY</option>
                </select>
              </td>
              <td class="px-4 py-3">
                <select
                  v-model="r.scope"
                  class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
                  :disabled="!canGrant"
                >
                  <option value="SELF">SELF</option>
                  <option value="SUBTREE">SUBTREE</option>
                </select>
              </td>
              <td class="px-4 py-3">
                <select
                  v-model.number="r.scope_group_id"
                  class="w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
                  :disabled="!canGrant || !principalGroupId"
                >
                  <option :value="null">Default (principal group)</option>
                  <option v-for="g in subtreeGroupOptions" :key="g.group_id" :value="g.group_id">
                    {{ g.full_path || g.group_name }}
                  </option>
                </select>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  type="button"
                  :disabled="!canGrant"
                  @click="removeRule(idx)"
                >
                  Remove
                </button>
              </td>
            </tr>

            <tr v-if="!loading && rules.length === 0">
              <td class="px-4 py-10 text-center text-sm text-slate-500" colspan="5">No rules</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
