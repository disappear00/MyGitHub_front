<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiBusinessError, authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()

const auth = useAuthStore()
auth.initFromStorage()

const loading = ref(false)
const errorMsg = ref<string | null>(null)
const okMsg = ref<string | null>(null)

const token = ref('')

async function verifyNow() {
  errorMsg.value = null
  okMsg.value = null
  if (!token.value.trim()) {
    errorMsg.value = '缺少 token'
    return
  }

  loading.value = true
  try {
    const res = await authApi.verifyEmail({ token: token.value.trim() })
    okMsg.value = res.is_email_verified ? '邮箱验证成功' : '邮箱验证状态已更新'
    await auth.refreshEmailStatus()
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '验证失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const q = route.query.token
  if (typeof q === 'string' && q.trim()) {
    token.value = q
    await verifyNow()
  }
})
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-slate-900">邮箱验证</h1>
    <p class="mt-1 text-sm text-slate-600">支持从邮件链接自动带入 `token`。</p>

    <div
      v-if="errorMsg"
      class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      {{ errorMsg }}
    </div>
    <div
      v-if="okMsg"
      class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
    >
      {{ okMsg }}
    </div>

    <div class="mt-4 space-y-3">
      <div>
        <label class="block text-sm font-medium text-slate-700">token</label>
        <input
          v-model="token"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
          placeholder="token"
        />
      </div>
      <button
        class="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        :disabled="loading"
        @click="verifyNow"
      >
        {{ loading ? '验证中…' : '验证' }}
      </button>
      <button
        class="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        type="button"
        @click="router.push({ name: 'login' })"
      >
        去登录
      </button>
    </div>
  </div>
</template>
