import type { PublishResult, PublishState } from '../../types/publish'
import type { ProjectSourceKind, ProjectStage, ProjectStatus, PublishProject } from '../../types/project'
import type { SiteId } from '../../types/site'
import { getCurrentLocale, translate } from '../../i18n'

export const projectStageLabelKeys: Record<ProjectStage, string> = {
  edit: 'project.stage.edit',
  review: 'project.stage.review',
  torrent_publish: 'project.stage.torrent_publish',
  forum_publish: 'project.stage.forum_publish',
  completed: 'project.stage.completed',
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
