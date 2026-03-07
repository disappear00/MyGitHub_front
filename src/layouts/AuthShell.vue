<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-full bg-slate-50">
    <header class="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <RouterLink to="/" class="flex items-center gap-2 font-semibold text-slate-900">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white"
            >MG</span
          >
          <span>旅游咨询平台</span>
        </RouterLink>
        <div class="text-sm text-slate-600">登录 / 注册</div>
      </div>
    </header>

    <main class="mx-auto flex max-w-6xl items-center justify-center px-4 py-10">
      <div class="w-full max-w-md">
        <RouterView />
      </div>
    </main>
  </div>
</template>
