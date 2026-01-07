<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiBusinessError } from '@/lib/api'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

const router = useRouter()
const route = useRoute()

const token = ref('')
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const hintMsg = ref<string | null>(null)

async function onVerify() {
  errorMsg.value = null
  hintMsg.value = null
  loading.value = true
  try {
    await auth.verifyEmailByToken(token.value.trim())
    hintMsg.value = '邮箱验证成功，可以进入后台了。'
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/admin/users'
    await router.push(redirect)
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '验证失败'
  } finally {
    loading.value = false
  }
}

const resendLoading = ref(false)
async function onResend() {
  if (!auth.user?.email) return
  errorMsg.value = null
  hintMsg.value = null
  resendLoading.value = true
  try {
    await authApi.resendVerifyEmail({ email: auth.user.email })
    hintMsg.value = '已请求重新发送验证邮件（开发环境可能打印在后端控制台）。'
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '发送失败'
  } finally {
    resendLoading.value = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-slate-900">邮箱验证</h1>
    <p class="mt-1 text-sm text-slate-600">后端对 `/users`、`/groups` 要求邮箱已验证，否则会 403。</p>

    <div v-if="auth.isEmailVerified" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      当前账号已验证邮箱。
    </div>
    <div v-else class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      当前账号未验证邮箱：{{ auth.user?.email }}
    </div>

    <div v-if="errorMsg" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {{ errorMsg }}
    </div>
    <div v-if="hintMsg" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {{ hintMsg }}
    </div>

    <div class="mt-4 space-y-3">
      <div>
        <label class="block text-sm font-medium text-slate-700">验证 token</label>
        <input v-model="token" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" placeholder="从邮件或后端控制台复制 token" />
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loading"
          @click="onVerify"
        >
          {{ loading ? '验证中…' : '验证' }}
        </button>
        <button
          type="button"
          class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="resendLoading || !auth.user?.email"
          @click="onResend"
        >
          {{ resendLoading ? '发送中…' : '重发邮件' }}
        </button>
      </div>
    </div>
  </div>
</template>

