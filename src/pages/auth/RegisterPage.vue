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
const email = ref('')
const phone = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const hintMsg = ref<string | null>(null)

async function onSubmit() {
  errorMsg.value = null
  hintMsg.value = null
  loading.value = true
  try {
    await auth.register(userName.value.trim(), email.value.trim(), password.value, phone.value.trim() || null)
    hintMsg.value = '注册成功：需要先完成邮箱验证后才能进入后台（后端要求 is_email_verified=true）。'
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/auth/verify-email'
    await router.push(redirect)
  } catch (e) {
    errorMsg.value = e instanceof ApiBusinessError ? e.message : '注册失败，请检查后端是否启动'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-slate-900">注册</h1>
    <p class="mt-1 text-sm text-slate-600">注册后会发送邮箱验证（开发环境可从后端控制台拿 token）</p>

    <div v-if="errorMsg" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {{ errorMsg }}
    </div>
    <div v-if="hintMsg" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {{ hintMsg }}
    </div>

    <form class="mt-4 space-y-4" @submit.prevent="onSubmit">
      <div>
        <label class="block text-sm font-medium text-slate-700">用户名</label>
        <input
          v-model="userName"
          class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400"
          placeholder="user_name"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700">邮箱</label>
        <input v-model="email" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" placeholder="name@example.com" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700">手机号（可选）</label>
        <input v-model="phone" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" placeholder="13800138000" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700">密码</label>
        <input v-model="password" type="password" class="mt-1 w-full rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:ring-slate-400" placeholder="至少 8 位" />
      </div>
      <button
        type="submit"
        class="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
      >
        {{ loading ? '提交中…' : '创建账号' }}
      </button>
    </form>

    <div class="mt-4 text-sm text-slate-600">
      已有账号？
      <RouterLink class="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-500" to="/auth/login">
        去登录
      </RouterLink>
    </div>
  </div>
</template>

