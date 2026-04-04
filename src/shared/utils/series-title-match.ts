import type { SeriesTitleMatchConfig, SeriesVariantSubtitleProfile, SeriesVariantVideoProfile } from '../types/project'
import type { SiteId } from '../types/site'

const TOKEN_PATTERN = /<([a-zA-Z][a-zA-Z0-9_]*)>/g
const TEAM_KEY_ALIASES = ['team', 'group', 'studio', 'fansub', 'releasegroup', 'subgroup']
const TITLE_KEY_ALIASES = ['title', 'name', 'series', 'show', 'anime']
const EPISODE_KEY_ALIASES = ['ep', 'episode', 'episodeno', 'number', 'no', 'num']
const SOURCE_KEY_ALIASES = ['source', 'src', 'type']
const RESOLUTION_KEY_ALIASES = ['res', 'resolution', 'quality']
const VIDEO_KEY_ALIASES = ['video', 'videocodec', 'codec', 'vcodec', 'encode', 'encoding']
const AUDIO_KEY_ALIASES = ['audio', 'audiocodec', 'acodec']
const SUBTITLE_KEY_ALIASES = ['sub', 'subs', 'subtitle', 'language', 'lang']
const TECHNICAL_KEY_ALIASES = ['tech', 'spec', 'meta', 'info', 'detail', 'quality']

export interface SeriesTitleMatchPreview {
  fileName: string
  matched: boolean
  variables?: Record<string, string>
  episodeLabel?: string
  variantName?: string
  title?: string
  releaseTeam?: string
  seriesTitle?: string
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
  subtitle?: string
  customTags: string[]
  videoProfile?: SeriesVariantVideoProfile
  subtitleProfile?: SeriesVariantSubtitleProfile
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeTokenKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeWhitespace(value: string | undefined) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  return [...new Set(values.map(item => normalizeWhitespace(item)).filter(Boolean))]
}

function readVariableByAliases(variables: Record<string, string>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeTokenKey)

  for (const [key, value] of Object.entries(variables)) {
    if (!normalizedAliases.includes(normalizeTokenKey(key))) {
      continue
    }

    const normalizedValue = normalizeWhitespace(value)
    if (normalizedValue) {
      return normalizedValue
    }
  }

  return undefined
}

function collectSearchCandidates(
  variables: Record<string, string>,
  fileName: string,
  aliases: string[],
) {
  return uniqueNonEmpty([
    readVariableByAliases(variables, aliases),
    readVariableByAliases(variables, TECHNICAL_KEY_ALIASES),
    ...Object.values(variables),
    stripTorrentExtension(fileName),
  ])
}

function findSourceType(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, SOURCE_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  for (const candidate of collectSearchCandidates(variables, fileName, SOURCE_KEY_ALIASES)) {
    if (/web[ ._-]?rip/i.test(candidate)) return 'WebRip'
    if (/web[ ._-]?dl/i.test(candidate)) return 'WEB-DL'
    if (/blu[ ._-]?ray|bdrip|bdmv/i.test(candidate)) return 'BDRip'
    if (/remux/i.test(candidate)) return 'Remux'
    if (/hdtv/i.test(candidate)) return 'HDTV'
    if (/tv[ ._-]?rip/i.test(candidate)) return 'TVRip'
    if (/dvd[ ._-]?rip|dvd/i.test(candidate)) return 'DVDRip'
    if (/uhd/i.test(candidate)) return 'UHD'
  }

  return undefined
}

function findResolution(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, RESOLUTION_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  for (const candidate of collectSearchCandidates(variables, fileName, RESOLUTION_KEY_ALIASES)) {
    const match = candidate.match(/\b(4320|2160|1440|1080|720|576|540|480)\s*([pi])?\b/i)
    if (match) {
      return `${match[1]}${(match[2] || 'p').toLowerCase()}`
    }
  }

  return undefined
}

function canonicalizeVideoCodec(value: string) {
  if (/hevc|h\.?265|x265/i.test(value)) return 'HEVC'
  if (/avc|h\.?264|x264/i.test(value)) return 'AVC'
  if (/av1/i.test(value)) return 'AV1'
  if (/vp9/i.test(value)) return 'VP9'
  if (/vc-?1/i.test(value)) return 'VC-1'
  if (/mpeg-?2/i.test(value)) return 'MPEG-2'
  return normalizeWhitespace(value)
}

function findVideoCodec(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, VIDEO_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  for (const candidate of collectSearchCandidates(variables, fileName, VIDEO_KEY_ALIASES)) {
    const codecMatch = candidate.match(/\b(HEVC|H\.?265|x265|AVC|H\.?264|x264|AV1|VP9|VC-?1|MPEG-?2)\b/i)
    if (!codecMatch) {
      continue
    }

    const bitDepthMatch = candidate.match(/\b(10bit|12bit|8bit|Hi10P)\b/i)
    const codec = canonicalizeVideoCodec(codecMatch[1])
    const bitDepth = bitDepthMatch ? bitDepthMatch[1].replace(/hi10p/i, 'Hi10P') : ''
    return bitDepth ? `${codec}-${bitDepth}` : codec
  }

  return undefined
}

function canonicalizeAudioCodec(value: string) {
  if (/truehd/i.test(value)) return 'TrueHD'
  if (/dts[- ]?hd(?:[- ]?ma)?/i.test(value)) return 'DTS-HD MA'
  if (/dts/i.test(value)) return 'DTS'
  if (/e-?ac-?3|eac3/i.test(value)) return 'EAC3'
  if (/ddp/i.test(value)) return 'DDP'
  if (/ac-?3/i.test(value)) return 'AC3'
  if (/flac/i.test(value)) return 'FLAC'
  if (/aac/i.test(value)) return 'AAC'
  if (/lpcm/i.test(value)) return 'LPCM'
  if (/opus/i.test(value)) return 'Opus'
  return normalizeWhitespace(value)
}

function findAudioCodec(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, AUDIO_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  for (const candidate of collectSearchCandidates(variables, fileName, AUDIO_KEY_ALIASES)) {
    const codecMatch = candidate.match(/\b(TrueHD|DTS[- ]?HD(?:[- ]?MA)?|DTS|E-?AC-?3|EAC3|DDP|AC-?3|FLAC|AAC|LPCM|Opus)\b/i)
    if (codecMatch) {
      return canonicalizeAudioCodec(codecMatch[1])
    }
  }

  return undefined
}

function findSubtitle(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, SUBTITLE_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  for (const candidate of collectSearchCandidates(variables, fileName, SUBTITLE_KEY_ALIASES)) {
    if (/\bassx?2\b/i.test(candidate)) return 'ASSx2'
    if (/\bjpsc\b/i.test(candidate)) return 'JPSC'
    if (/\bjptc\b/i.test(candidate)) return 'JPTC'
    if (/bilingual|dual|\u53cc\u8bed|\u7b80\u7e41/i.test(candidate)) return 'Bilingual'
    if (/chs&cht/i.test(candidate)) return 'CHS&CHT'
    if (/chs|\u7b80\u4e2d|\u7b80\u4f53/i.test(candidate)) return 'CHS'
    if (/cht|\u7e41\u4e2d|\u7e41\u9ad4|\u7e41\u4f53/i.test(candidate)) return 'CHT'
    if (/english|eng/i.test(candidate)) return 'ENG'
  }

  return undefined
}

function findReleaseTeam(variables: Record<string, string>, fileName: string) {
  const explicitValue = readVariableByAliases(variables, TEAM_KEY_ALIASES)
  if (explicitValue) {
    return explicitValue
  }

  const leadingBracketMatch = fileName.match(/^\[([^\]]+)\]/)
  if (leadingBracketMatch?.[1]) {
    return normalizeWhitespace(leadingBracketMatch[1])
  }

  return undefined
}

function findSeriesTitle(variables: Record<string, string>) {
  return readVariableByAliases(variables, TITLE_KEY_ALIASES)
}

function findEpisodeLabel(variables: Record<string, string>) {
  return readVariableByAliases(variables, EPISODE_KEY_ALIASES)
}

function buildDefaultVariantName(input: {
  resolution?: string
  subtitle?: string
  videoCodec?: string
  fileName: string
}) {
  const preferredName = [input.resolution, input.subtitle].filter(Boolean).join('-')
  if (preferredName) {
    return preferredName
  }

  const fallbackName = [input.resolution, input.videoCodec].filter(Boolean).join('-')
  if (fallbackName) {
    return fallbackName
  }

  return stripTorrentExtension(input.fileName)
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

export function renderSeriesTitleCustomTags(template: string | undefined, variables: Record<string, string>) {
  const rendered = renderSeriesTitleTemplate(template, variables)
  if (!rendered) {
    return []
  }

  return [...new Set(
    rendered
      .split(/[\r\n,]+/)
      .map(item => item.trim())
      .filter(Boolean),
  )]
}

export function buildSeriesTitleMatchPreview(
  config: SeriesTitleMatchConfig | undefined,
  fileName: string,
): SeriesTitleMatchPreview | null {
  const trimmedFileName = fileName.trim()
  if (!config?.fileNamePattern || !trimmedFileName) {
    return null
  }

  const variables = matchSeriesTitlePattern(config.fileNamePattern, trimmedFileName)
  if (!variables) {
    return {
      fileName: trimmedFileName,
      matched: false,
      customTags: [],
    }
  }

  const renderedEpisodeLabel = renderSeriesTitleTemplate(config.episodeTemplate || '<ep>', variables)
  const renderedReleaseTeam = renderSeriesTitleTemplate(config.releaseTeamTemplate, variables)
  const renderedSourceType = renderSeriesTitleTemplate(config.sourceTypeTemplate, variables)
  const renderedResolution = renderSeriesTitleTemplate(config.resolutionTemplate, variables)
  const renderedVideoCodec = renderSeriesTitleTemplate(config.videoCodecTemplate, variables)
  const renderedAudioCodec = renderSeriesTitleTemplate(config.audioCodecTemplate, variables)
  const renderedSubtitle = renderSeriesTitleTemplate(config.subtitleTemplate, variables)
  const renderedVariantName = renderSeriesTitleTemplate(config.variantTemplate, variables)

  const episodeLabel = renderedEpisodeLabel || findEpisodeLabel(variables)
  const releaseTeam = renderedReleaseTeam || findReleaseTeam(variables, trimmedFileName)
  const seriesTitle = findSeriesTitle(variables)
  const sourceType = renderedSourceType || findSourceType(variables, trimmedFileName)
  const resolution = renderedResolution || findResolution(variables, trimmedFileName)
  const videoCodec = renderedVideoCodec || findVideoCodec(variables, trimmedFileName)
  const audioCodec = renderedAudioCodec || findAudioCodec(variables, trimmedFileName)
  const subtitle = renderedSubtitle || findSubtitle(variables, trimmedFileName)
  const customTags = renderSeriesTitleCustomTags(config.customTemplate, variables)

  return {
    fileName: trimmedFileName,
    matched: true,
    variables,
    episodeLabel,
    variantName:
      renderedVariantName ||
      buildDefaultVariantName({
        resolution,
        subtitle,
        videoCodec,
        fileName: trimmedFileName,
      }),
    title: renderSeriesTitleTemplate(config.titleTemplate, variables),
    releaseTeam,
    seriesTitle,
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
    customTags,
    videoProfile: normalizeMatchedVideoProfile(resolution),
    subtitleProfile: normalizeMatchedSubtitleProfile(subtitle),
  }
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
    customTemplate: normalizeText(raw.customTemplate) || undefined,
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
    normalizedValue.includes('assx2') ||
    normalizedValue.includes('\u53cc\u8bed') ||
    normalizedValue.includes('\u7b80\u7e41')
  ) {
    return 'bilingual'
  }

  if (normalizedValue.includes('jptc')) {
    return 'cht'
  }

  if (normalizedValue.includes('jpsc')) {
    return 'chs'
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
