<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ApiBusinessError } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

const router = useRouter()
const route = useRoute()

const userName = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref<string | null>(null)

async function onSubmit() {
  errorMsg.value = null
  loading.value = true
  try {
    await auth.login(userName.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '登录失败，请检查后端是否启动'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-slate-900">登录</h1>
    <p class="mt-1 text-sm text-slate-600">使用用户名/邮箱/手机号 + 密码登录</p>

    <div
      v-if="errorMsg"
      class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      {{ errorMsg }}
    </div>

    <form class="mt-4 space-y-4" @submit.prevent="onSubmit">
      <div>
        <label class="block text-sm font-medium text-slate-700">账号</label>
        <input
          v-model="userName"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
          placeholder="user_name / email / phone"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700">密码</label>
        <input
          v-model="password"
          type="password"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
          placeholder="至少 8 位"
        />
      </div>
      <button
        type="submit"
        class="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
      >
        {{ loading ? '登录中…' : '登录' }}
      </button>
    </form>

    <div class="mt-4 text-sm text-slate-600">
      没有账号？
      <RouterLink
        class="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-500"
        to="/auth/register"
      >
        去注册
      </RouterLink>
    </div>
  </div>
</template>
