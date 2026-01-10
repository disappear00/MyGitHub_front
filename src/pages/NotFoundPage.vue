<template>
  <div class="mx-auto max-w-7xl px-4 py-16">
    <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div class="text-2xl font-semibold text-slate-900">404</div>
      <div class="mt-2 text-sm text-slate-600">页面不存在</div>
      <button
        class="mt-6 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        type="button"
        @click="$router.push('/')"
      >
        返回首页
      </button>
    </div>
  </div>
</template>
