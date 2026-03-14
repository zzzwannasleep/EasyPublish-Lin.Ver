interface Unit3dRecord {
  [key: string]: unknown
}

export interface Unit3dUserSummary {
  id?: string
  username?: string
  group?: string
}

export interface Unit3dUploadResponse {
  downloadLink?: string
  message?: string
}

export interface Unit3dTorrentRecord {
  id?: string
  name?: string
  detailsLink?: string
  downloadLink?: string
  categoryId?: number
  typeId?: number
  resolutionId?: number
  tmdb?: number
  imdb?: number
  tvdb?: number
  mal?: number
  igdb?: number
  createdAt?: string
}

function asRecord(value: unknown): Unit3dRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Unit3dRecord) : undefined
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`
  }

  return undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function collectErrors(value: unknown): string[] {
  if (typeof value === 'string' && value.trim() !== '') {
    return [value.trim()]
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectErrors(item))
  }

  const record = asRecord(value)
  if (!record) {
    return []
  }

  return Object.values(record).flatMap(item => collectErrors(item))
}

function mapTorrentRecord(value: unknown): Unit3dTorrentRecord {
  const record = asRecord(value) ?? {}
  const attributes = asRecord(record.attributes) ?? record

  return {
    id: readString(record.id ?? attributes.id),
    name: readString(attributes.name),
    detailsLink: readString(attributes.details_link ?? attributes.detailsLink),
    downloadLink: readString(attributes.download_link ?? attributes.downloadLink),
    categoryId: readNumber(attributes.category_id ?? attributes.categoryId),
    typeId: readNumber(attributes.type_id ?? attributes.typeId),
    resolutionId: readNumber(attributes.resolution_id ?? attributes.resolutionId),
    tmdb: readNumber(attributes.tmdb_id ?? attributes.tmdb),
    imdb: readNumber(attributes.imdb_id ?? attributes.imdb),
    tvdb: readNumber(attributes.tvdb_id ?? attributes.tvdb),
    mal: readNumber(attributes.mal_id ?? attributes.mal),
    igdb: readNumber(attributes.igdb_id ?? attributes.igdb),
    createdAt: readString(attributes.created_at ?? attributes.createdAt),
  }
}

export function extractUnit3dErrorMessage(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) {
    return typeof value === 'string' ? value : undefined
  }

  const directMessage =
    readString(record.message) ??
    readString(record.error) ??
    readString(asRecord(record.data)?.message)
  if (directMessage) {
    return directMessage
  }

  const validationErrors = collectErrors(record.errors)
  if (validationErrors.length > 0) {
    return validationErrors.join(' | ')
  }

  const dataErrors = collectErrors(record.data)
  return dataErrors.length > 0 ? dataErrors.join(' | ') : undefined
}

export function ensureUnit3dSuccess(value: unknown): void {
  const record = asRecord(value)
  if (record?.success === true) {
    return
  }

  throw new Error(extractUnit3dErrorMessage(value) || 'UNIT3D rejected the request')
}

export function extractUnit3dUserSummary(value: unknown): Unit3dUserSummary | undefined {
  const record = asRecord(value) ?? {}
  const data = asRecord(record.data) ?? record
  const attributes = asRecord(data.attributes) ?? data
  const username = readString(attributes.username)
  const group = readString(attributes.group) ?? readString(asRecord(attributes.group)?.name)
  const id = readString(data.id ?? attributes.id)

  if (!username && !group && !id) {
    return undefined
  }

  return {
    id,
    username,
    group,
  }
}

export function extractUnit3dUploadResponse(value: unknown): Unit3dUploadResponse {
  const record = asRecord(value) ?? {}
  const data = record.data
  const nested = asRecord(data)

  return {
    downloadLink:
      readString(data) ??
      readString(nested?.download_link) ??
      readString(nested?.downloadLink),
    message: readString(record.message),
  }
}

export function extractUnit3dTorrentRecords(value: unknown): Unit3dTorrentRecord[] {
  const record = asRecord(value)
  const nestedData = asRecord(record?.data)?.data
  const source = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(nestedData)
      ? nestedData
      : Array.isArray(value)
        ? value
        : []

  return source.map(mapTorrentRecord).filter(item => Boolean(item.id || item.name || item.downloadLink))
}
