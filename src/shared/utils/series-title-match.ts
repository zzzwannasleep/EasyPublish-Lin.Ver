import type {
  SeriesTitleMatchConfig,
  SeriesTitleTagMapping,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
} from '../types/project'
import type { SiteId } from '../types/site'

const TOKEN_PATTERN = /<([a-zA-Z][a-zA-Z0-9_]*)>/g
const DEFAULT_TITLE_TAG_TEMPLATE = '<tags>'
const DEFAULT_EPISODE_TEMPLATE = '<ep>'
const DEFAULT_VARIANT_TEMPLATE = '<res>p-<sub>'
const DEFAULT_OPTIONAL_EPISODE_LABEL = '1'
const SERIES_SOURCE_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: 'WEB-DL', pattern: /\bweb[-_. ]?dl\b/i },
  { value: 'WEBRip', pattern: /\bweb[-_. ]?rip\b/i },
  { value: 'BluRay', pattern: /\b(?:blu[-_. ]?ray|bdrip|bdmv|bd)\b/i },
  { value: 'DVD', pattern: /\bdvd(?:rip)?\b/i },
  { value: 'TV', pattern: /\b(?:hdtv|tvrip|tv)\b/i },
]
const SERIES_VIDEO_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: 'AV1', pattern: /\bav1\b/i },
  { value: 'HEVC', pattern: /\b(?:hevc|x265|h\.?265)\b/i },
  { value: 'AVC', pattern: /\b(?:avc|x264|h\.?264)\b/i },
]
const SERIES_AUDIO_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: 'FLAC', pattern: /\bflac\b/i },
  { value: 'AAC', pattern: /\baac\b/i },
  { value: 'DDP', pattern: /\bddp(?:\d(?:\.\d)?)?\b/i },
  { value: 'AC3', pattern: /\bac3\b/i },
  { value: 'Opus', pattern: /\bopus\b/i },
]
const SERIES_SUBTITLE_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: '简繁日内封', pattern: /(?:简繁|chs[&+/_-]?cht).*(?:日|jpn|jp).*(?:内封|内嵌)|(?:内封|内嵌).*(?:简繁|chs[&+/_-]?cht).*(?:日|jpn|jp)/i },
  { value: '简繁内封', pattern: /(?:简繁|chs[&+/_-]?cht).*(?:内封|内嵌)|(?:内封|内嵌).*(?:简繁|chs[&+/_-]?cht)/i },
  { value: '简日双语', pattern: /(?:简|chs).*(?:日|jpn|jp)|(?:日|jpn|jp).*(?:简|chs)/i },
  { value: '繁日双语', pattern: /(?:繁|cht).*(?:日|jpn|jp)|(?:日|jpn|jp).*(?:繁|cht)/i },
  { value: '简中', pattern: /\bchs\b|简中|简体/i },
  { value: '繁中', pattern: /\bcht\b|繁中|繁体/i },
  { value: '日语', pattern: /\b(?:jpn|jp)\b|日语/i },
  { value: '英语', pattern: /\b(?:eng|english)\b|英语/i },
]

function normalizeSeriesFileNameText(fileName: string) {
  return stripTorrentExtension(fileName).replace(/[._]/g, ' ').trim()
}

function findSeriesPatternValue(
  text: string,
  patterns: Array<{ value: string; pattern: RegExp }>,
) {
  const matched = patterns.find(item => item.pattern.test(text))
  return matched?.value ?? ''
}

function extractSeriesEpisodeLabelFromFileName(fileName: string) {
  const text = normalizeSeriesFileNameText(fileName)
  const patterns = [
    /\b(?:ep|episode|e)\s*0*(\d{1,3}(?:v\d+)?)\b/i,
    /第\s*0*(\d{1,3}(?:v\d+)?)\s*[话話集]/i,
    /-\s*0*(\d{1,3}(?:v\d+)?)\s*(?=[\[(]|$)/i,
  ]

  for (const pattern of patterns) {
    const matched = text.match(pattern)?.[1]?.trim()
    if (matched) {
      return matched
    }
  }

  return ''
}

function extractSeriesReleaseTeamFromFileName(fileName: string) {
  const matched = stripTorrentExtension(fileName).match(/^\[([^\]]+)\]/)?.[1]?.trim()
  if (!matched) {
    return ''
  }

  if (/\b(?:2160|1080|720|hevc|avc|aac|flac|web|bd|chs|cht)\b/i.test(matched)) {
    return ''
  }

  return matched
}

function extractSeriesResolutionTokenFromFileName(fileName: string) {
  const text = normalizeSeriesFileNameText(fileName)
  return text.match(/\b(2160|1080|720|480)\s*[pi]?\b/i)?.[1]?.trim() ?? ''
}

function buildSeriesTitleDetectedVariables(fileName: string) {
  const normalizedFileName = normalizeSeriesFileNameText(fileName)
  const episodeLabel = extractSeriesEpisodeLabelFromFileName(fileName)
  const releaseTeam = extractSeriesReleaseTeamFromFileName(fileName)
  const sourceType = findSeriesPatternValue(normalizedFileName, SERIES_SOURCE_PATTERNS)
  const resolution = extractSeriesResolutionTokenFromFileName(fileName)
  const videoCodec = findSeriesPatternValue(normalizedFileName, SERIES_VIDEO_PATTERNS)
  const audioCodec = findSeriesPatternValue(normalizedFileName, SERIES_AUDIO_PATTERNS)
  const subtitle = findSeriesPatternValue(normalizedFileName, SERIES_SUBTITLE_PATTERNS)

  return {
    ep: episodeLabel,
    episode: episodeLabel,
    team: releaseTeam,
    group: releaseTeam,
    source: sourceType,
    res: resolution,
    resolution,
    video: videoCodec,
    audio: audioCodec,
    sub: subtitle,
    subtitle,
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalTemplate(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined
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

export function normalizeSeriesTitleTagMappings(
  value: unknown,
  legacyTemplateToken = DEFAULT_TITLE_TAG_TEMPLATE,
): SeriesTitleTagMapping[] | undefined {
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

function normalizeTitleTagMappings(value: unknown, legacyTemplateToken = DEFAULT_TITLE_TAG_TEMPLATE) {
  return normalizeSeriesTitleTagMappings(value, legacyTemplateToken)
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
  const labels = new Set<string>()
  resolveSeriesTitleMappedTagBindings(mappings, texts).forEach(binding => {
    binding.labels.forEach(label => labels.add(label))
  })
  return [...labels]
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

export function resolveSeriesTitleDetectedVariables(fileName: string) {
  return Object.fromEntries(
    Object.entries(buildSeriesTitleDetectedVariables(fileName)).filter(([, value]) => normalizeText(value)),
  ) as Record<string, string>
}

function resolveSeriesTitleVariableValue(variables: Record<string, string>, aliases: string[]) {
  const normalizedEntries = Object.entries(variables).map(([key, value]) => [key.trim().toLowerCase(), normalizeText(value)] as const)
  for (const alias of aliases) {
    const found = normalizedEntries.find(([key]) => key === alias.trim().toLowerCase())
    if (found?.[1]) {
      return found[1]
    }
  }
  return ''
}

function normalizeSeriesResolutionValue(value: string) {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) {
    return ''
  }

  return /^\d{3,4}$/i.test(normalizedValue) ? `${normalizedValue}p` : normalizedValue
}

export function resolveSeriesTitleDerivedFields(variables: Record<string, string>) {
  const episodeLabel = resolveSeriesTitleVariableValue(variables, ['ep', 'episode', 'episodelabel', 'no'])
  const releaseTeam = resolveSeriesTitleVariableValue(variables, ['team', 'releaseteam', 'group', 'fansub'])
  const sourceType = resolveSeriesTitleVariableValue(variables, ['source', 'sourcetype'])
  const resolution = normalizeSeriesResolutionValue(resolveSeriesTitleVariableValue(variables, ['res', 'resolution']))
  const videoCodec = resolveSeriesTitleVariableValue(variables, ['video', 'videocodec', 'vcodec'])
  const audioCodec = resolveSeriesTitleVariableValue(variables, ['audio', 'audiocodec', 'acodec'])
  const subtitle = resolveSeriesTitleVariableValue(variables, ['sub', 'subtitle', 'subs'])
  const variantName = [sourceType, resolution, videoCodec, audioCodec, subtitle].filter(Boolean).join(' / ')

  return {
    episodeLabel,
    releaseTeam,
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
    variantName,
  }
}

export function renderSeriesEpisodeTemplate(template: string | undefined, variables: Record<string, string>) {
  if (template === undefined) {
    return renderSeriesTitleTemplate(DEFAULT_EPISODE_TEMPLATE, variables)
  }

  const rendered = renderSeriesTitleTemplate(template, variables)
  return rendered || (!template.trim() ? DEFAULT_OPTIONAL_EPISODE_LABEL : '')
}

export function renderSeriesVariantTemplate(template: string | undefined, variables: Record<string, string>) {
  return renderSeriesTitleTemplate(template ?? DEFAULT_VARIANT_TEMPLATE, variables)
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
  titleTags?: string[]
}) {
  const releaseTeam = normalizeText(input.releaseTeam)
  const mainTitle = normalizeText(input.mainTitle)
  const seasonLabel = normalizeText(input.seasonLabel)
  const episodeLabel = normalizeText(input.episodeLabel)
  const titleTagValue = renderSeriesTitleTagValue(input.titleTags)
  const techLabel = [
    normalizeText(input.sourceType),
    normalizeText(input.resolution),
    normalizeText(input.videoCodec),
    normalizeText(input.audioCodec),
    normalizeText(input.variantName),
    titleTagValue,
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
    episodeTemplate: normalizeOptionalTemplate(raw.episodeTemplate),
    variantTemplate: normalizeOptionalTemplate(raw.variantTemplate),
    titleTemplate: normalizeOptionalTemplate(raw.titleTemplate),
    releaseTeamTemplate: normalizeOptionalTemplate(raw.releaseTeamTemplate),
    sourceTypeTemplate: normalizeOptionalTemplate(raw.sourceTypeTemplate),
    resolutionTemplate: normalizeOptionalTemplate(raw.resolutionTemplate),
    videoCodecTemplate: normalizeOptionalTemplate(raw.videoCodecTemplate),
    audioCodecTemplate: normalizeOptionalTemplate(raw.audioCodecTemplate),
    subtitleTemplate: normalizeOptionalTemplate(raw.subtitleTemplate),
    titleTagMappings: normalizeTitleTagMappings(raw.titleTagMappings, legacyTemplateToken),
    targetSites: targetSites.length ? (targetSites as SiteId[]) : undefined,
    createdAt: normalizeText(raw.createdAt) || undefined,
    updatedAt: normalizeText(raw.updatedAt) || undefined,
  }

  return config.fileNamePattern || config.titleTemplate || config.titleTagMappings?.length ? config : undefined
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
