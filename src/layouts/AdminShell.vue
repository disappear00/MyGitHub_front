<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
    <aside class="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">后台</div>
      <nav class="space-y-1">
        <RouterLink
          to="/admin/users"
          class="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          active-class="bg-slate-100 text-slate-900"
        >
          用户管理
        </RouterLink>
        <RouterLink
          to="/admin/groups"
          class="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          active-class="bg-slate-100 text-slate-900"
        >
          分组管理
        </RouterLink>
      </nav>
    </aside>

    <main class="min-h-[60vh] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <RouterView />
    </main>
  </div>
</template>

