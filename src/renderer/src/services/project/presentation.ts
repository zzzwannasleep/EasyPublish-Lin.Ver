import type { PublishResult, PublishState } from '../../types/publish'
import type { ProjectMode, ProjectSourceKind, ProjectStage, ProjectStatus, PublishProject } from '../../types/project'
import type { SiteId } from '../../types/site'
import { getCurrentLocale, translate } from '../../i18n'

export type ProjectRouteName = 'edit' | 'check' | 'bt_publish' | 'forum_publish' | 'finish'

export type TargetSiteProgressSummary = {
  publishedSiteIds: SiteId[]
  pendingSiteIds: SiteId[]
  failedSiteIds: SiteId[]
}

export const projectStageLabelKeys: Record<ProjectStage, string> = {
  edit: 'project.stage.edit',
  review: 'project.stage.review',
  torrent_publish: 'project.stage.torrent_publish',
  forum_publish: 'project.stage.forum_publish',
  completed: 'project.stage.completed',
}

export const projectModeLabelKeys: Record<ProjectMode, string> = {
  episode: 'project.mode.episode',
  feature: 'project.mode.feature',
}

export const projectSourceLabelKeys: Record<ProjectSourceKind, string> = {
  quick: 'project.source.quick',
  file: 'project.source.file',
  template: 'project.source.template',
}

export const projectStatusLabelKeys: Record<ProjectStatus, string> = {
  draft: 'project.status.draft',
  publishing: 'project.status.publishing',
  published: 'project.status.published',
}

export const projectStatusTones: Record<
  ProjectStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  draft: 'info',
  publishing: 'warning',
  published: 'success',
}

export const publishStateLabelKeys: Record<PublishState, string> = {
  idle: 'project.publishState.idle',
  pending: 'project.publishState.pending',
  published: 'project.publishState.published',
  failed: 'project.publishState.failed',
}

export const publishStateTones: Record<PublishState, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  idle: 'neutral',
  pending: 'warning',
  published: 'success',
  failed: 'danger',
}

export const siteLabelKeys: Record<string, string> = {
  bangumi: 'project.site.bangumi',
  mikan: 'project.site.mikan',
  anibt: 'project.site.anibt',
  miobt: 'project.site.miobt',
  nyaa: 'project.site.nyaa',
  acgrip: 'project.site.acgrip',
  dmhy: 'project.site.dmhy',
  acgnx_a: 'project.site.acgnx_a',
  acgnx_g: 'project.site.acgnx_g',
  forum: 'project.site.forum',
}

export function getProjectStageLabel(stage: ProjectStage) {
  return translate(projectStageLabelKeys[stage])
}

export function getProjectModeLabel(mode: ProjectMode) {
  return translate(projectModeLabelKeys[mode])
}

export function getProjectSourceLabel(source: ProjectSourceKind) {
  return translate(projectSourceLabelKeys[source])
}

export function getProjectStatusLabel(status: ProjectStatus) {
  return translate(projectStatusLabelKeys[status])
}

export function getPublishStateLabel(state: PublishState) {
  return translate(publishStateLabelKeys[state])
}

export function getSiteLabel(siteId: SiteId) {
  return siteLabelKeys[siteId] ? translate(siteLabelKeys[siteId]) : siteId
}

export function formatProjectTimestamp(value?: string) {
  if (!value) {
    return translate('project.timestamp.empty')
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(getCurrentLocale())
}

export function getRecordedSiteIds(project: PublishProject): SiteId[] {
  return [...new Set(project.publishResults.map(item => item.siteId))]
}

export function getPublishedSiteIds(project: PublishProject): SiteId[] {
  return [
    ...new Set(
      project.publishResults
        .filter(item => item.status === 'published')
        .map(item => item.siteId),
    ),
  ]
}

export function getMissingTargetSiteIds(project: PublishProject): SiteId[] {
  if (!project.targetSites.length) {
    return []
  }

  const publishedSites = new Set(getPublishedSiteIds(project))
  return project.targetSites.filter(siteId => !publishedSites.has(siteId))
}

export function getLatestPublishResultMap(results: PublishResult[] = []) {
  const orderedResults = [...results].sort((left, right) => getPublishResultTimeValue(right) - getPublishResultTimeValue(left))
  const resultMap = new Map<SiteId, PublishResult>()
  orderedResults.forEach(result => {
    if (!resultMap.has(result.siteId)) {
      resultMap.set(result.siteId, result)
    }
  })

  return resultMap
}

export function summarizeTargetSiteProgress(
  targetSiteIds: SiteId[] = [],
  results: PublishResult[] = [],
): TargetSiteProgressSummary {
  const latestResultMap = getLatestPublishResultMap(results)
  const normalizedTargetSiteIds = [...new Set(targetSiteIds.filter(Boolean))]

  return normalizedTargetSiteIds.reduce<TargetSiteProgressSummary>(
    (summary, siteId) => {
      const latestStatus = latestResultMap.get(siteId)?.status
      if (latestStatus === 'published') {
        summary.publishedSiteIds.push(siteId)
      } else if (latestStatus === 'failed') {
        summary.failedSiteIds.push(siteId)
      } else {
        summary.pendingSiteIds.push(siteId)
      }

      return summary
    },
    {
      publishedSiteIds: [],
      pendingSiteIds: [],
      failedSiteIds: [],
    },
  )
}

export function getProjectResumeRouteName(project: PublishProject): ProjectRouteName {
  switch (project.stage) {
    case 'review':
      return 'check'
    case 'torrent_publish':
      return project.projectMode === 'episode' ? 'check' : 'bt_publish'
    case 'forum_publish':
      return project.projectMode === 'episode' ? 'edit' : 'forum_publish'
    case 'completed':
      return project.projectMode === 'episode' ? 'edit' : 'finish'
    case 'edit':
    default:
      return 'edit'
  }
}

export function getProjectCompletionBackRouteName(project: PublishProject): ProjectRouteName {
  if (project.projectMode === 'episode' || project.sourceKind === 'quick') {
    return 'bt_publish'
  }

  return 'forum_publish'
}

export function getProjectWorkflowRouteNames(project: PublishProject): ProjectRouteName[] {
  if (project.projectMode === 'episode') {
    return ['edit', 'check']
  }

  return ['edit', 'check', 'bt_publish', 'forum_publish', 'finish']
}

function getPublishResultTimeValue(result: PublishResult) {
  if (!result.timestamp) {
    return 0
  }

  const value = new Date(result.timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

export function sortPublishResults(results: PublishResult[]) {
  return [...results].sort((left, right) => getPublishResultTimeValue(right) - getPublishResultTimeValue(left))
}
