export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  language: 'zh-CN' | 'en-US'
  proxy: Config.ProxyConfig
  logLevel: 'info' | 'warn' | 'error'
  updatePolicy: 'manual'
  activeConfigName: string
  defaultProjectRoot?: string
}

