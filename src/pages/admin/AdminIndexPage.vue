<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
auth.initFromStorage()

onMounted(async () => {
  if (auth.hasPermission('users.read')) {
    await router.replace({ name: 'admin-users' })
    return
  }
  if (auth.hasPermission('groups.read')) {
    await router.replace({ name: 'admin-groups' })
    return
  }
  if (auth.hasPermission('permissions.read')) {
    await router.replace({ name: 'admin-permissions' })
    return
  }
  await router.replace({ name: 'forbidden' })
})
</script>

<template>
  <div class="text-sm text-slate-500">Redirecting…</div>
</template>
