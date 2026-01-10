<script setup lang="ts">
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ mode: 'front' | 'admin' }>()

const router = useRouter()
const auth = useAuthStore()
auth.initFromStorage()

const items = [
  { id: 'front', label: '前台', to: '/' },
  { id: 'admin', label: '后台', to: '/admin' },
] as const

const visibleItems = computed(() => {
  const base = [items[0]] as Array<(typeof items)[number]>
  if (auth.isAuthed && auth.hasPermission('ui.admin.access')) base.push(items[1])
  return base
})

const selected = computed(() => visibleItems.value.find((i) => i.id === props.mode) ?? items[0])

async function onChange(item: (typeof items)[number]) {
  await router.push(item.to)
}
</script>

<template>
  <Listbox :model-value="selected" @update:model-value="onChange">
    <div class="relative">
      <ListboxButton
        class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <span class="inline-flex h-2 w-2 rounded-full" :class="mode === 'admin' ? 'bg-emerald-500' : 'bg-indigo-500'" />
        <span>{{ selected.label }}</span>
        <span class="text-slate-400">▾</span>
      </ListboxButton>

      <ListboxOptions
        class="absolute right-0 mt-2 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg focus:outline-none"
      >
        <ListboxOption
          v-for="item in visibleItems"
          :key="item.id"
          :value="item"
          class="cursor-pointer px-3 py-2 text-sm text-slate-700 data-[focus]:bg-slate-50"
        >
          {{ item.label }}
        </ListboxOption>
      </ListboxOptions>
    </div>
  </Listbox>
</template>
