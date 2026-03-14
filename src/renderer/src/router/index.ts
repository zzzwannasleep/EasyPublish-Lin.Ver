import { createRouter, createWebHashHistory } from 'vue-router'

import ProjectEditorStage from '../features/project-editor/ProjectEditorStage.vue'
import ProjectReviewStage from '../features/project-editor/ProjectReviewStage.vue'
import PublishCompletionStage from '../features/publish-panel/PublishCompletionStage.vue'
import TorrentPublishStage from '../features/publish-panel/TorrentPublishStage.vue'
import ForumPublishStage from '../legacy/forum/ForumPublishStage.vue'
import DashboardView from '../views/dashboard/DashboardView.vue'
import ProjectWorkflowView from '../views/project-detail/ProjectWorkflowView.vue'
import ProjectCreateView from '../views/projects/ProjectCreateView.vue'
import ProjectsView from '../views/projects/ProjectsView.vue'
import AccountsView from '../views/accounts/AccountsView.vue'
import LogsView from '../views/logs/LogsView.vue'
import ModifyView from '../views/tools/ModifyView.vue'
import GuideView from '../views/guides/GuideView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      name: 'home',
      path: '/',
      component: DashboardView,
      meta: {
        titleKey: 'route.home.title',
        subtitleKey: 'route.home.subtitle'
      }
    },
    {
      name: 'create_task',
      path: '/new-project',
      alias: ['/create_task'],
      component: ProjectCreateView,
      meta: {
        titleKey: 'route.create.title',
        subtitleKey: 'route.create.subtitle'
      }
    },
    {
      name: 'task_list',
      path: '/projects',
      alias: ['/task_list'],
      component: ProjectsView,
      meta: {
        titleKey: 'route.projects.title',
        subtitleKey: 'route.projects.subtitle'
      }
    },
    {
      name: 'task',
      path: '/projects/:id',
      component: ProjectWorkflowView,
      redirect: to => ({ name: 'edit', params: { id: to.params.id } }),
      meta: {
        titleKey: 'route.projectDetail.title',
        subtitleKey: 'route.projectDetail.subtitle'
      },
      children: [
        {
          name: 'edit',
          path: 'edit',
          alias: ['/task/edit/:id'],
          component: ProjectEditorStage,
          props: route => ({ id: Number(route.params.id) }),
          meta: {
            titleKey: 'route.edit.title',
            subtitleKey: 'route.edit.subtitle'
          }
        },
        {
          name: 'check',
          path: 'review',
          alias: ['/task/check/:id'],
          component: ProjectReviewStage,
          props: route => ({ id: Number(route.params.id) }),
          meta: {
            titleKey: 'route.review.title',
            subtitleKey: 'route.review.subtitle'
          }
        },
        {
          name: 'bt_publish',
          path: 'torrent-publish',
          alias: ['/task/bt_publish/:id'],
          component: TorrentPublishStage,
          props: route => ({ id: Number(route.params.id) }),
          meta: {
            titleKey: 'route.publish.title',
            subtitleKey: 'route.publish.subtitle'
          }
        },
        {
          name: 'forum_publish',
          path: 'main-site',
          alias: ['/task/forum_publish/:id'],
          component: ForumPublishStage,
          props: route => ({ id: Number(route.params.id) }),
          meta: {
            titleKey: 'route.forum.title',
            subtitleKey: 'route.forum.subtitle'
          }
        },
        {
          name: 'finish',
          path: 'complete',
          alias: ['/task/finish/:id'],
          component: PublishCompletionStage,
          props: route => ({ id: Number(route.params.id) }),
          meta: {
            titleKey: 'route.finish.title',
            subtitleKey: 'route.finish.subtitle'
          }
        }
      ]
    },
    {
      name: 'modify',
      path: '/legacy/modify',
      alias: ['/modify'],
      component: ModifyView,
      meta: {
        titleKey: 'route.tools.title',
        subtitleKey: 'route.tools.subtitle'
      }
    },
    {
      name: 'account',
      path: '/accounts',
      alias: ['/account'],
      component: AccountsView,
      meta: {
        titleKey: 'route.accounts.title',
        subtitleKey: 'route.accounts.subtitle'
      }
    },
    {
      name: 'logs',
      path: '/logs',
      component: LogsView,
      meta: {
        titleKey: 'route.logs.title',
        subtitleKey: 'route.logs.subtitle'
      }
    },
    {
      name: 'quickstart',
      path: '/guide',
      alias: ['/quickstart'],
      component: GuideView,
      meta: {
        titleKey: 'route.guide.title',
        subtitleKey: 'route.guide.subtitle'
      }
    }
  ]
})

export default router
