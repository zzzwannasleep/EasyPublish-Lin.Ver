import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { PublishProject } from '../../types/project'

export interface ProjectContextValue {
  project: Ref<PublishProject | null>
  isLoading: Ref<boolean>
  errorMessage: Ref<string | null>
  refreshProject: () => Promise<void>
}

const projectContextKey: InjectionKey<ProjectContextValue> = Symbol('project-context')

export function provideProjectContext(context: ProjectContextValue) {
  provide(projectContextKey, context)
}

export function useProjectContext() {
  const context = inject(projectContextKey)
  if (!context) {
    throw new Error('Project context is not available')
  }
  return context
}

