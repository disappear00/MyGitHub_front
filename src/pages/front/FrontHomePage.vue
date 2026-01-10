<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

const canChat = computed(() => auth.isAuthed && auth.hasPermission('agents.read'))
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-10">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
      <div class="mx-auto mb-3 h-10 w-10 rounded-2xl bg-slate-900" />
      <h1 class="text-xl font-semibold text-slate-900">前台</h1>
      <p class="mt-2 text-sm text-slate-600">
        从这里进入 AI 对话页（模型/智能体/知识库由后台管理，按权限可见）。
      </p>

      <div class="mt-6 flex items-center justify-center gap-3">
        <RouterLink
          v-if="canChat"
          to="/chat"
          class="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          进入 AI 对话
        </RouterLink>
        <RouterLink
          v-else
          to="/auth/login"
          class="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          登录后使用
        </RouterLink>
      </div>

      <div v-if="auth.isAuthed && !auth.hasPermission('agents.read')" class="mt-3 text-xs text-amber-700">
        当前账号缺少权限：agents.read
      </div>
    </div>
  </div>
</template>
