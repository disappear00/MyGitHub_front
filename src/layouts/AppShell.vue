<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import ModeSwitch from '@/components/ModeSwitch.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
auth.initFromStorage()

const route = useRoute()
const router = useRouter()

const mode = computed<'front' | 'admin'>(() => (route.path.startsWith('/admin') ? 'admin' : 'front'))

async function onLogout() {
  await auth.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-full bg-slate-50">
    <header class="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <div class="flex items-center gap-2">
          <div class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
            MG
          </div>
          <div class="hidden sm:block">
            <div class="text-sm font-semibold text-slate-900">MyGitHub</div>
            <div class="text-xs text-slate-500">FastAPI + Vue3</div>
          </div>
        </div>

        <div class="flex flex-1 items-center justify-end gap-3">
          <ModeSwitch :mode="mode" />

          <!-- <div class="hidden md:flex">
            <input
              class="w-80 rounded-xl border-slate-200 bg-white/60 px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:ring-slate-400"
              placeholder="Type / to search (mock)"
              disabled
            />
          </div> -->

          <div class="flex items-center gap-2">
            <template v-if="auth.isAuthed">
              <div class="hidden sm:block text-right">
                <div class="text-sm font-medium text-slate-900">{{ auth.user?.user_name }}</div>
                <div class="text-xs text-slate-500">{{ auth.user?.email }}</div>
              </div>
              <button
                class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                type="button"
                @click="onLogout"
              >
                退出
              </button>
            </template>
            <template v-else>
              <button
                class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                type="button"
                @click="$router.push({ name: 'login' })"
              >
                登录
              </button>
            </template>
          </div>
        </div>
      </div>
    </header>

    <RouterView />
  </div>
</template>

