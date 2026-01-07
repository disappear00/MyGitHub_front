<script setup lang="ts">
import { ref } from 'vue'

import type { GroupResponse } from '@/lib/types'

defineOptions({ name: 'GroupTree' })

type TreeNode = GroupResponse & { children: TreeNode[] }

defineProps<{
  nodes: TreeNode[]
  selectedId: number | null
}>()

const emit = defineEmits<{
  (e: 'select', groupId: number): void
  (e: 'create-child', parentId: number): void
}>()

const expanded = ref<Record<number, boolean>>({})

function toggle(id: number) {
  expanded.value[id] = !expanded.value[id]
}
</script>

<template>
  <ul class="space-y-1">
    <li v-for="node in nodes" :key="node.group_id">
      <div
        class="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-white"
        :class="selectedId === node.group_id ? 'bg-white shadow-sm ring-1 ring-slate-200' : ''"
      >
        <button
          v-if="node.children.length > 0"
          class="h-7 w-7 rounded-lg text-slate-500 hover:bg-slate-100"
          type="button"
          :aria-label="expanded[node.group_id] ? 'collapse' : 'expand'"
          @click="toggle(node.group_id)"
        >
          {{ expanded[node.group_id] ? '▾' : '▸' }}
        </button>
        <span v-else class="inline-flex h-7 w-7 items-center justify-center text-slate-300">•</span>

        <button class="flex-1 truncate text-left font-medium text-slate-800" type="button" @click="emit('select', node.group_id)">
          {{ node.group_name }}
        </button>

        <button class="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" type="button" @click="emit('create-child', node.group_id)">
          + 子分组
        </button>
      </div>

      <div v-if="node.children.length > 0 && expanded[node.group_id]" class="ml-6 mt-1 border-l border-slate-200 pl-3">
        <GroupTree :nodes="node.children" :selected-id="selectedId" @select="emit('select', $event)" @create-child="emit('create-child', $event)" />
      </div>
    </li>
  </ul>
</template>
