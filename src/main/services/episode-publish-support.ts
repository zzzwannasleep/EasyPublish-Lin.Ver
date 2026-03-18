import fs from 'fs'
import { basename, join } from 'path'
import type { MarkupFormat, PublishTorrentEntry } from '../../shared/types/project'
import { buildDerivedMarkupFromContent, buildDerivedMarkupFromHtml } from './markup-conversion'

function cloneConfig(config: Config.PublishConfig) {
  return JSON.parse(JSON.stringify(config)) as Config.PublishConfig
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizePublishTorrentEntry(value: unknown, index: number): PublishTorrentEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const path = readOptionalString(raw.path)
  if (!path) {
    return null
  }

  return {
    id: readOptionalString(raw.id) ?? `torrent-${index + 1}-${basename(path)}`,
    name: readOptionalString(raw.name) ?? basename(path),
    path,
    enabled: raw.enabled !== false,
    titleOverride: readOptionalString(raw.titleOverride),
    bodyOverride: typeof raw.bodyOverride === 'string' ? raw.bodyOverride : undefined,
  }
}

function buildFallbackPublishTorrentEntry(config: Config.PublishConfig): PublishTorrentEntry | null {
  const path = readOptionalString(config.torrentPath)
  if (!path) {
    return null
  }

  return {
    id: config.activeTorrentId?.trim() || 'torrent-default',
    name: readOptionalString(config.torrentName) ?? basename(path),
    path,
    enabled: true,
  }
}

function escapeMarkup(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function getPublishTorrentEntries(config: Config.PublishConfig) {
  const entries = Array.isArray(config.torrentEntries)
    ? config.torrentEntries
        .map((entry, index) => normalizePublishTorrentEntry(entry, index))
        .filter((entry): entry is PublishTorrentEntry => Boolean(entry))
    : []

  if (entries.length > 0) {
    return entries
  }

  const fallback = buildFallbackPublishTorrentEntry(config)
  return fallback ? [fallback] : []
}

export function getActivePublishTorrentEntry(config: Config.PublishConfig) {
  const entries = getPublishTorrentEntries(config)
  if (entries.length === 0) {
    return undefined
  }

  return (
    entries.find(entry => entry.id === config.activeTorrentId) ??
    entries.find(entry => entry.enabled !== false) ??
    entries[0]
  )
}

export function getSelectedPublishTorrentEntries(config: Config.PublishConfig) {
  const entries = getPublishTorrentEntries(config)
  const selectedEntries = entries.filter(entry => entry.enabled !== false)
  if (selectedEntries.length > 0) {
    return selectedEntries
  }

  const activeEntry = getActivePublishTorrentEntry(config)
  return activeEntry ? [activeEntry] : []
}

export function applyPublishTorrentEntry(config: Config.PublishConfig, entry?: PublishTorrentEntry) {
  const nextConfig = cloneConfig(config)
  const entries = getPublishTorrentEntries(nextConfig)
  if (entries.length > 0) {
    nextConfig.torrentEntries = entries
  } else {
    delete nextConfig.torrentEntries
  }

  const activeEntry = entry ?? getActivePublishTorrentEntry(nextConfig)
  if (!activeEntry) {
    nextConfig.activeTorrentId = undefined
    nextConfig.torrentPath = ''
    nextConfig.torrentName = ''
    return nextConfig
  }

  nextConfig.activeTorrentId = activeEntry.id
  nextConfig.torrentPath = activeEntry.path
  nextConfig.torrentName = activeEntry.name
  if (activeEntry.titleOverride?.trim()) {
    nextConfig.title = activeEntry.titleOverride.trim()
  }

  return nextConfig
}

function buildEpisodeHtml(config: Config.PublishConfig, info: Config.Content_episode) {
  const titles = [info.seriesTitleCN, info.seriesTitleEN, info.seriesTitleJP].filter(Boolean)
  const titleBlock = titles.map(item => escapeMarkup(item)).join(' / ')
  const summaryBlock = info.summary
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => `<p>${escapeMarkup(item)}</p>`)
    .join('\n')

  const metaRows = [
    ['Title', titleBlock],
    ['Season', escapeMarkup(info.seasonLabel ?? '')],
    ['Episode', escapeMarkup(info.episodeLabel)],
    ['Episode Title', escapeMarkup(info.episodeTitle ?? '')],
    [
      'Format',
      escapeMarkup([info.sourceType, info.resolution, info.videoCodec, info.audioCodec].filter(Boolean).join(' / ')),
    ],
    ['Release Team', escapeMarkup(info.releaseTeam)],
  ].filter(([, value]) => Boolean(value))

  return [
    '<section>',
    `<p><strong>${escapeMarkup(config.title)}</strong></p>`,
    '<ul>',
    ...metaRows.map(([label, value]) => `<li>${label}: ${value}</li>`),
    '</ul>',
    summaryBlock || '<p>No additional summary.</p>',
    '</section>',
  ].join('\n')
}

function resolveEpisodeBodyFormat(format?: MarkupFormat): MarkupFormat {
  return format ?? 'html'
}

function resolveEpisodeBodySource(
  config: Config.PublishConfig,
  bodyOverride?: string,
): { html: string } | { content: string; format: MarkupFormat } {
  const info = config.content as Config.Content_episode
  const bodyTemplate = config.bodyTemplate?.trim()
  const overrideContent = typeof bodyOverride === 'string' && bodyOverride.trim() ? bodyOverride.trim() : undefined

  if (overrideContent) {
    return {
      content: overrideContent,
      format: resolveEpisodeBodyFormat(config.bodyTemplateFormat),
    }
  }

  if (!bodyTemplate) {
    return {
      html: buildEpisodeHtml(config, info),
    }
  }

  return {
    content: bodyTemplate,
    format: resolveEpisodeBodyFormat(config.bodyTemplateFormat),
  }
}

export function buildEpisodeDerivedContent(config: Config.PublishConfig, bodyOverride?: string) {
  const resolvedBody = resolveEpisodeBodySource(config, bodyOverride)
  if ('html' in resolvedBody) {
    return buildDerivedMarkupFromHtml(resolvedBody.html)
  }

  return buildDerivedMarkupFromContent(resolvedBody.content, resolvedBody.format)
}

export function resolveEpisodePublishHtml(config: Config.PublishConfig, bodyOverride?: string) {
  return buildEpisodeDerivedContent(config, bodyOverride).html
}

export function writeDerivedContent(
  taskPath: string,
  content: {
    html: string
    md: string
    bbcode: string
  },
) {
  fs.writeFileSync(join(taskPath, 'bangumi.html'), content.html)
  fs.writeFileSync(join(taskPath, 'nyaa.md'), content.md)
  fs.writeFileSync(join(taskPath, 'acgrip.bbcode'), content.bbcode)
}

export function materializeEpisodePublishDraft(
  taskPath: string,
  config: Config.PublishConfig,
  entry?: PublishTorrentEntry,
) {
  const nextConfig = applyPublishTorrentEntry(config, entry)
  if (!nextConfig.torrentPath || !fs.existsSync(nextConfig.torrentPath)) {
    throw new Error('noSuchFile_torrent')
  }

  const activeEntry = entry ?? getActivePublishTorrentEntry(nextConfig)
  const content = buildEpisodeDerivedContent(nextConfig, activeEntry?.bodyOverride)
  fs.writeFileSync(join(taskPath, 'config.json'), JSON.stringify(nextConfig))
  writeDerivedContent(taskPath, content)
  fs.copyFileSync(nextConfig.torrentPath, join(taskPath, basename(nextConfig.torrentPath)))
  return nextConfig
}
