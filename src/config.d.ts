//数据库设置
declare namespace Config {
  import { Cookie } from 'electron'
  import type { PublishResult } from './shared/types/publish'
  import type {
    LegacyProjectType,
    MarkupFormat,
    PublishTorrentEntry,
    ProjectMode,
    ProjectSourceKind,
    SeriesPublishProfileSiteFieldDefaults,
  } from './shared/types/project'
  import type { SiteId } from './shared/types/site'

  type Task = {
    id: number
    name: string
    path: string
    bangumi?: string
    mikan?: string
    miobt?: string
    nyaa?: string
    acgrip?: string
    dmhy?: string
    acgnx_g?: string
    acgnx_a?: string
    forumLink?: string
    publishResults?: PublishResult[]
    sync: boolean
    mode?: ProjectMode
    type?: LegacyProjectType
    status: 'published' | 'publishing'
    step: 'edit' | 'check' | 'bt_publish' | 'forum_publish' | 'finish'
  }

  type LoginInfo = {
    name: string, 
    time: string, 
    status: string,
    username: string,
    password: string,
    apiToken?: string,
    enable: boolean,
    cookies: Cookie[]
  }

  type TaskData = {
    tasks: Task[]
  }

  type PTSiteConfig = {
    id: string
    name: string
    adapter: 'acgnx' | 'nexusphp' | 'unit3d'
    baseUrl: string
    enabled: boolean
    apiUid?: string
    username: string
    password: string
    apiToken?: string
    lastCheckAt?: string
    healthStatus?:
      | 'unknown'
      | 'disabled'
      | 'checking'
      | 'authenticated'
      | 'unauthenticated'
      | 'blocked'
      | 'error'
    statusMessage?: string
  }

  type UserData = {
    info: LoginInfo[]
    name?: string
    ptSites?: PTSiteConfig[]
    proxyConfig: ProxyConfig
    forum: {
      username: string
      password: string
      cookies?: Cookie[]
      lastCheckAt?: string
      healthStatus?:
        | 'unknown'
        | 'disabled'
        | 'checking'
        | 'authenticated'
        | 'unauthenticated'
        | 'blocked'
        | 'error'
      statusMessage?: string
    }
  }

  interface ProxyConfig{
    status: boolean
    type: string
    host: string
    port: number
  }

  interface Content_template {
    title_CN: string
    title_EN: string
    title_JP: string
    depth: string
    resolution: string
    encoding: string
    contentType: string
    reseed: boolean
    nomination: boolean
    note: string[]
    sub_CN?: string
    sub_EN?: string
    audio_CN?: string
    audio_EN?: string
    comment_CN: string
    comment_EN: string
    rsVersion: number
    rsComment_CN?: string
    rsComment_EN?: string
    subTeam_CN?: string[]
    subTeam_EN?: string[]
    nonsense?: string
    members: {
      script: string
      encode: string
      collate: string
      upload: string
    }
    providers?: string
    comparisons_html?: string
    comparisons_md?: string
    comparisons_bbcode?: string
    posterUrl: string
    mediaInfo?: string
    imageCredit?: string
    imageSource?: string
    imagePath?: string
    prefill: boolean
  }

  declare interface Content_file {
    path_md: string
    path_html: string
    path_bbcode: string
  }

  interface Content_episode {
    seriesTitleCN: string
    seriesTitleEN: string
    seriesTitleJP: string
    seasonLabel?: string
    episodeLabel: string
    episodeTitle?: string
    releaseTeam: string
    sourceType: string
    resolution: string
    videoCodec: string
    audioCodec: string
    summary: string
    targetSites: SiteId[]
  }

  declare interface PublishConfig {
    torrentPath: string
    torrentName: string
    activeTorrentId?: string
    torrentEntries?: PublishTorrentEntry[]
    category_bangumi: string
    category_nyaa: string
    siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
    tags: {label: string, value: string}[]
    content: Content_file | Content_template | Content_episode
    completed?: boolean
    information: string
    remake?: boolean
    title: string
    sourceKind?: ProjectSourceKind
    targetSites?: SiteId[]
    bodyTemplate?: string
    bodyTemplateFormat?: MarkupFormat
  }
}
