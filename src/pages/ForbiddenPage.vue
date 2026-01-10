<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-10">
    <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div class="mx-auto mb-3 h-10 w-10 rounded-2xl bg-rose-600" />
      <h1 class="text-xl font-semibold text-slate-900">403 Forbidden</h1>
      <p class="mt-2 text-sm text-slate-600">You don't have permission to access this page.</p>
      <div class="mt-6 flex justify-center gap-2">
        <button
          class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          type="button"
          @click="router.push('/')"
        >
          Go Home
        </button>
        <button
          class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          type="button"
          @click="router.back()"
        >
          Back
        </button>
      </div>
    </div>
  </div>
</template>

