import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      children: [
        {
          path: '',
          name: 'front-home',
          component: () => import('@/pages/front/FrontHomePage.vue'),
          meta: { mode: 'front' },
        },
        {
          path: 'admin',
          component: () => import('@/layouts/AdminShell.vue'),
          meta: { requiresAuth: true, mode: 'admin', requiredPermissions: ['ui.admin.access'] },
          children: [
            {
              path: '',
              name: 'admin-index',
              component: () => import('@/pages/admin/AdminIndexPage.vue'),
              meta: { requiresVerified: true },
            },
            {
              path: 'users',
              name: 'admin-users',
              component: () => import('@/pages/admin/AdminUsersPage.vue'),
              meta: { requiresVerified: true, requiredPermissions: ['users.read'] },
            },
            {
              path: 'groups',
              name: 'admin-groups',
              component: () => import('@/pages/admin/AdminGroupsPage.vue'),
              meta: { requiresVerified: true, requiredPermissions: ['groups.read'] },
            },
            {
              path: 'permissions',
              name: 'admin-permissions',
              component: () => import('@/pages/admin/AdminPermissionsPage.vue'),
              meta: { requiresVerified: true, requiredPermissions: ['permissions.read'] },
            },
          ],
        },
      ],
    },
    {
      path: '/auth',
      component: () => import('@/layouts/AuthShell.vue'),
      children: [
        { path: 'login', name: 'login', component: () => import('@/pages/auth/LoginPage.vue') },
        { path: 'register', name: 'register', component: () => import('@/pages/auth/RegisterPage.vue') },
        {
          path: 'verify-email',
          name: 'verify-email',
          component: () => import('@/pages/auth/VerifyEmailPage.vue'),
          meta: { requiresAuth: true },
        },
      ],
    },
    {
      path: '/verify-email',
      component: () => import('@/layouts/AuthShell.vue'),
      children: [{ path: '', name: 'verify-email-public', component: () => import('@/pages/public/VerifyEmailPublicPage.vue') }],
    },
    {
      path: '/reset-password',
      component: () => import('@/layouts/AuthShell.vue'),
      children: [{ path: '', name: 'reset-password', component: () => import('@/pages/public/ResetPasswordPage.vue') }],
    },
    { path: '/403', name: 'forbidden', component: () => import('@/pages/ForbiddenPage.vue') },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  auth.initFromStorage()
  auth.syncFromStorage()

  if (auth.isAuthed && auth.permissionCodes === null) {
    await auth.refreshPermissions()
  }

  const requiresAuth = Boolean(to.meta.requiresAuth)
  if (requiresAuth && !auth.isAuthed) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const requiresVerified = Boolean(to.meta.requiresVerified)
  if (requiresVerified) {
    if (auth.isEmailVerified === null) {
      await auth.refreshEmailStatus()
    }
    if (auth.isEmailVerified === false) {
      return { name: 'verify-email', query: { redirect: to.fullPath } }
    }
  }

  const requiredPermissions = Array.isArray(to.meta.requiredPermissions) ? (to.meta.requiredPermissions as string[]) : []
  if (requiredPermissions.length > 0) {
    if (auth.permissionCodes === null) {
      await auth.refreshPermissions()
    }

    const ok = requiredPermissions.every((p) => auth.hasPermission(p))
    if (!ok) {
      return { name: 'forbidden' }
    }
  }

  return true
})
