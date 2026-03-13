import type {
  SiteSection,
  SiteSectionOption,
  SiteSectionSubCategory,
  SiteSectionTag,
} from '../../../shared/types/site'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? `${value}` : ''
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function mapSectionOption(value: unknown): SiteSectionOption {
  const record = asRecord(value) ?? {}
  return {
    id: readNumber(record.id),
    name: readString(record.name),
  }
}

function mapSectionTag(value: unknown): SiteSectionTag {
  const record = asRecord(value) ?? {}
  return {
    id: readNumber(record.id),
    name: readString(record.name),
    color: readString(record.color) || undefined,
    fontColor: readString(record.fontColor ?? record.font_color) || undefined,
  }
}

function mapSectionSubCategory(value: unknown): SiteSectionSubCategory {
  const record = asRecord(value) ?? {}
  const rawData = Array.isArray(record.data) ? record.data : []

  return {
    field: readString(record.field),
    label: readString(record.label),
    data: rawData.map(mapSectionOption).filter(item => item.id > 0 && item.name !== ''),
  }
}

function mapSection(value: unknown): SiteSection {
  const record = asRecord(value) ?? {}
  const rawCategories = Array.isArray(record.categories) ? record.categories : []
  const rawTags = Array.isArray(record.tags) ? record.tags : []
  const subCategorySource = record.subCategories ?? record.sub_categories
  const rawSubCategories: unknown[] = Array.isArray(subCategorySource) ? subCategorySource : []

  return {
    id: readNumber(record.id),
    name: readString(record.name),
    displayName: readString(record.displayName ?? record.display_name) || undefined,
    categories: rawCategories.map(mapSectionOption).filter(item => item.id > 0 && item.name !== ''),
    tags: rawTags.map(mapSectionTag).filter(item => item.id > 0 && item.name !== ''),
    subCategories: rawSubCategories
      .map(mapSectionSubCategory)
      .filter(item => item.field !== '' && item.label !== ''),
  }
}

export function ensureNexusApiSuccess(value: unknown): void {
  const record = asRecord(value)
  const ret = record?.ret

  if (ret === 0) {
    return
  }

  if (typeof ret === 'number') {
    const message = readString(record?.msg ?? record?.message) || 'Request failed'
    throw new Error(`API returned code=${ret}: ${message}`)
  }

  throw new Error('API response missing ret field')
}

export function extractNexusData(value: unknown): unknown {
  const record = asRecord(value)
  const firstData = record?.data
  const nested = asRecord(firstData)?.data

  if (nested !== undefined) {
    return nested
  }

  if (firstData !== undefined) {
    return firstData
  }

  throw new Error('API response missing data field')
}

export function extractNexusSections(value: unknown): SiteSection[] {
  const rawSections = extractNexusData(value)
  if (!Array.isArray(rawSections)) {
    throw new Error('NexusPHP sections payload is not an array')
  }

  return rawSections
    .map(mapSection)
    .filter(section => section.id > 0 && section.name !== '')
}
