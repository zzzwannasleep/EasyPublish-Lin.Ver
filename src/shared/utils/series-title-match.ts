import type { SeriesTitleMatchConfig, SeriesVariantSubtitleProfile, SeriesVariantVideoProfile } from '../types/project'
import type { SiteId } from '../types/site'

const TOKEN_PATTERN = /<([a-zA-Z][a-zA-Z0-9_]*)>/g

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripTorrentExtension(value: string) {
  return value.replace(/\.torrent$/i, '')
}

export function extractSeriesTitleMatchTokens(template: string) {
  return [...template.matchAll(TOKEN_PATTERN)].map((match) => match[1])
}

export function matchSeriesTitlePattern(pattern: string, fileName: string) {
  const trimmedPattern = stripTorrentExtension(pattern.trim())
  const trimmedFileName = stripTorrentExtension(fileName.trim())

  if (!trimmedPattern || !trimmedFileName) {
    return null
  }

  let sourceIndex = 0
  let regexSource = '^'
  const tokens: string[] = []

  for (const match of trimmedPattern.matchAll(TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0
    regexSource += escapeRegExp(trimmedPattern.slice(sourceIndex, matchIndex))
    regexSource += '(.+?)'
    tokens.push(match[1])
    sourceIndex = matchIndex + match[0].length
  }

  regexSource += escapeRegExp(trimmedPattern.slice(sourceIndex))
  regexSource += '$'

  if (!tokens.length) {
    return trimmedPattern === trimmedFileName ? {} : null
  }

  const matched = trimmedFileName.match(new RegExp(regexSource, 'i'))
  if (!matched) {
    return null
  }

  const variables: Record<string, string> = {}
  tokens.forEach((token, index) => {
    const value = matched[index + 1]?.trim()
    if (value) {
      variables[token] = value
    }
  })

  return variables
}

export function renderSeriesTitleTemplate(template: string | undefined, variables: Record<string, string>) {
  if (!template) {
    return ''
  }

  return template.replace(TOKEN_PATTERN, (_match, token: string) => variables[token] ?? '').trim()
}

export function normalizeSeriesTitleMatchConfig(value: unknown): SeriesTitleMatchConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const raw = value as Partial<SeriesTitleMatchConfig>
  const normalizeText = (text: unknown) => (typeof text === 'string' ? text.trim() : '')
  const targetSites = Array.isArray(raw.targetSites)
    ? [...new Set(raw.targetSites.filter((siteId): siteId is string => typeof siteId === 'string').map((siteId) => siteId.trim()).filter(Boolean))]
    : []

  const config: SeriesTitleMatchConfig = {
    fileNamePattern: normalizeText(raw.fileNamePattern),
    episodeTemplate: normalizeText(raw.episodeTemplate) || undefined,
    variantTemplate: normalizeText(raw.variantTemplate) || undefined,
    titleTemplate: normalizeText(raw.titleTemplate) || undefined,
    releaseTeamTemplate: normalizeText(raw.releaseTeamTemplate) || undefined,
    sourceTypeTemplate: normalizeText(raw.sourceTypeTemplate) || undefined,
    resolutionTemplate: normalizeText(raw.resolutionTemplate) || undefined,
    videoCodecTemplate: normalizeText(raw.videoCodecTemplate) || undefined,
    audioCodecTemplate: normalizeText(raw.audioCodecTemplate) || undefined,
    subtitleTemplate: normalizeText(raw.subtitleTemplate) || undefined,
    informationTemplate: normalizeText(raw.informationTemplate) || undefined,
    targetSites: targetSites.length ? (targetSites as SiteId[]) : undefined,
    createdAt: normalizeText(raw.createdAt) || undefined,
    updatedAt: normalizeText(raw.updatedAt) || undefined,
  }

  return config.fileNamePattern ? config : undefined
}

export function normalizeMatchedVideoProfile(
  value: string | undefined,
): SeriesVariantVideoProfile | undefined {
  const normalizedValue = value?.trim().toLowerCase() ?? ''
  if (!normalizedValue) {
    return undefined
  }

  if (normalizedValue.includes('2160')) {
    return '2160p'
  }

  if (normalizedValue.includes('1080')) {
    return '1080p'
  }

  return 'custom'
}

export function normalizeMatchedSubtitleProfile(
  value: string | undefined,
): SeriesVariantSubtitleProfile | undefined {
  const normalizedValue = value?.trim().toLowerCase() ?? ''
  if (!normalizedValue) {
    return undefined
  }

  if (normalizedValue.includes('bilingual') || normalizedValue.includes('chs&cht') || normalizedValue.includes('简繁')) {
    return 'bilingual'
  }

  if (normalizedValue.includes('cht') || normalizedValue.includes('繁')) {
    return 'cht'
  }

  if (normalizedValue.includes('eng') || normalizedValue.includes('english')) {
    return 'eng'
  }

  if (normalizedValue.includes('chs') || normalizedValue.includes('简')) {
    return 'chs'
  }

  return 'custom'
}
