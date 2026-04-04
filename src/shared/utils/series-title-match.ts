import type {
  SeriesTitleMatchConfig,
  SeriesTitleTagMapping,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
} from '../types/project'
import type { SiteId } from '../types/site'

const TOKEN_PATTERN = /<([a-zA-Z][a-zA-Z0-9_]*)>/g
const DEFAULT_TITLE_TAG_TEMPLATE = '<tags>'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTitleTagTemplateToken(value: unknown, fallback = DEFAULT_TITLE_TAG_TEMPLATE) {
  const rawValue = normalizeText(value)
  const tokenSource = rawValue || fallback
  const matchedToken = extractSeriesTitleMatchTokens(tokenSource)[0]
  if (matchedToken) {
    return `<${matchedToken}>`
  }

  const bareToken = tokenSource.replace(/[<>]/g, '').trim()
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(bareToken)) {
    return `<${bareToken}>`
  }

  return fallback
}

function normalizeTitleTagMappings(value: unknown, legacyTemplateToken = DEFAULT_TITLE_TAG_TEMPLATE): SeriesTitleTagMapping[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const mappings = value
    .filter((item): item is SeriesTitleTagMapping => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map(item => ({
      id: normalizeText(item.id) || undefined,
      keyword: normalizeText(item.keyword),
      templateToken: normalizeTitleTagTemplateToken(item.templateToken, legacyTemplateToken),
      label: normalizeText(item.label),
    }))
    .filter(item => item.keyword && item.label)

  return mappings.length ? mappings : undefined
}

export function stripTorrentExtension(value: string) {
  return value.replace(/\.torrent$/i, '')
}

export function extractSeriesTitleMatchTokens(template: string) {
  return [...template.matchAll(TOKEN_PATTERN)].map((match) => match[1])
}

export function getDefaultSeriesTitleTagTemplate() {
  return DEFAULT_TITLE_TAG_TEMPLATE
}

export function resolveSeriesTitleTagTemplateInfo(template: string | undefined) {
  const normalizedTemplate = normalizeTitleTagTemplateToken(template)
  const token = extractSeriesTitleMatchTokens(normalizedTemplate)[0]
  if (!token) {
    return undefined
  }

  return {
    key: token,
    placeholder: `<${token}>`,
  }
}

export function renderSeriesTitleTagValue(titleTags: string[] | undefined) {
  return [...new Set((titleTags ?? []).map(item => item.trim()).filter(Boolean))].join(' / ')
}

export function resolveSeriesTitleMappedTagBindings(
  mappings: SeriesTitleTagMapping[] | undefined,
  texts: Array<string | undefined>,
) {
  if (!mappings?.length) {
    return []
  }

  const haystack = texts
    .map(text => text?.trim().toLowerCase() ?? '')
    .filter(Boolean)

  if (!haystack.length) {
    return []
  }

  const bindingMap = new Map<string, string[]>()
  mappings.forEach(mapping => {
    const keyword = mapping.keyword.trim().toLowerCase()
    const label = mapping.label.trim()
    const templateToken = normalizeTitleTagTemplateToken(mapping.templateToken)
    if (!keyword || !label || !templateToken) {
      return
    }

    if (!haystack.some(text => text.includes(keyword))) {
      return
    }

    const labels = bindingMap.get(templateToken) ?? []
    if (!labels.includes(label)) {
      labels.push(label)
      bindingMap.set(templateToken, labels)
    }
  })

  return [...bindingMap.entries()].map(([templateToken, labels]) => ({
    templateToken,
    labels,
    value: renderSeriesTitleTagValue(labels),
  }))
}

export function resolveSeriesTitleMappedTags(
  mappings: SeriesTitleTagMapping[] | undefined,
  texts: Array<string | undefined>,
) {
  return resolveSeriesTitleMappedTagBindings(mappings, texts).flatMap(binding => binding.labels)
}

export function applySeriesTitleTagTemplateVariables(
  variables: Record<string, string>,
  titleTagBindings: Array<{ templateToken: string; value: string }>,
) {
  const nextVariables = { ...variables }
  titleTagBindings.forEach(binding => {
    const tokenInfo = resolveSeriesTitleTagTemplateInfo(binding.templateToken)
    if (!tokenInfo) {
      return
    }
    nextVariables[tokenInfo.key] = binding.value
  })
  return nextVariables
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

export function composeSeriesPublishTitle(input: {
  releaseTeam?: string
  mainTitle?: string
  seasonLabel?: string
  episodeLabel?: string
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
  variantName?: string
}) {
  const releaseTeam = normalizeText(input.releaseTeam)
  const mainTitle = normalizeText(input.mainTitle)
  const seasonLabel = normalizeText(input.seasonLabel)
  const episodeLabel = normalizeText(input.episodeLabel)
  const techLabel = [
    normalizeText(input.sourceType),
    normalizeText(input.resolution),
    normalizeText(input.videoCodec),
    normalizeText(input.audioCodec),
    normalizeText(input.variantName),
  ]
    .filter(Boolean)
    .join(' / ')

  let title = [releaseTeam ? `[${releaseTeam}]` : '', mainTitle, seasonLabel].filter(Boolean).join(' ')
  if (episodeLabel) {
    title = title ? `${title} - ${episodeLabel}` : episodeLabel
  }
  if (techLabel) {
    title = title ? `${title} [${techLabel}]` : `[${techLabel}]`
  }
  return title.slice(0, 128)
}

export function normalizeSeriesTitleMatchConfig(value: unknown): SeriesTitleMatchConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const raw = value as Partial<SeriesTitleMatchConfig> & { titleTagTemplate?: unknown }
  const targetSites = Array.isArray(raw.targetSites)
    ? [...new Set(raw.targetSites.filter((siteId): siteId is string => typeof siteId === 'string').map((siteId) => siteId.trim()).filter(Boolean))]
    : []
  const legacyTemplateToken = normalizeTitleTagTemplateToken(raw.titleTagTemplate)

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
    titleTagMappings: normalizeTitleTagMappings(raw.titleTagMappings, legacyTemplateToken),
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

  if (
    normalizedValue.includes('bilingual') ||
    normalizedValue.includes('chs&cht') ||
    normalizedValue.includes('\u7b80\u7e41')
  ) {
    return 'bilingual'
  }

  if (normalizedValue.includes('cht') || normalizedValue.includes('\u7e41')) {
    return 'cht'
  }

  if (normalizedValue.includes('eng') || normalizedValue.includes('english')) {
    return 'eng'
  }

  if (normalizedValue.includes('chs') || normalizedValue.includes('\u7b80')) {
    return 'chs'
  }

  return 'custom'
}
