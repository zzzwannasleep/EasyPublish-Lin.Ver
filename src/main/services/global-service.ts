import { app, clipboard, dialog, shell } from 'electron'
import fs from 'fs'
import { Low } from 'lowdb'
import commonmark from 'commonmark'
import md2bbc from 'markdown-to-bbcode'
import { join } from 'path'
import html2md from 'turndown'
import { USER_DB_FILE } from '../core/constants'
import { createSettingsStore } from '../storage/settings-store'

type UserDbProvider = () => Low<Config.UserData>

interface CreateGlobalServiceOptions {
  getUserDB: UserDbProvider
  settingsStore: ReturnType<typeof createSettingsStore>
}

export function createGlobalService(options: CreateGlobalServiceOptions) {
  const { getUserDB, settingsStore } = options

  function getUserDBOrThrow() {
    const db = getUserDB()
    if (!db) {
      throw new Error('User DB is not initialized')
    }
    return db
  }

  return {
    async setProxyConfig(message: string) {
      const pconf: Message.Global.ProxyConfig = JSON.parse(message)
      await settingsStore.setProxyConfig(pconf)
      app.relaunch()
      app.exit()
    },

    getProxyConfig() {
      const msg: Message.Global.ProxyConfig = settingsStore.getProxyConfig()
      return JSON.stringify(msg)
    },

    async getFilePath(msg: string) {
      const { type }: Message.Global.FileType = JSON.parse(msg)
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: type, extensions: [type] }],
      })
      if (canceled) return '{"path" : ""}'
      const result: Message.Global.Path = { path: filePaths[0] }
      return JSON.stringify(result)
    },

    async getFolderPath() {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      })
      if (canceled) return '{"path" : ""}'
      const result: Message.Global.Path = { path: filePaths[0] }
      return JSON.stringify(result)
    },

    async openFolder(msg: string) {
      const { path }: Message.Global.Path = JSON.parse(msg)
      await shell.openPath(path)
    },

    writeClipboard(msg: string) {
      const { str }: Message.Global.Clipboard = JSON.parse(msg)
      clipboard.writeText(str)
    },

    async readFileContent() {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
      })
      const content = canceled ? '' : fs.readFileSync(filePaths[0], { encoding: 'utf-8' })
      const result: Message.Global.FileContent = { content }
      return JSON.stringify(result)
    },

    html2markdown(msg: string) {
      let { content }: Message.Global.FileContent = JSON.parse(msg)
      const converter = new html2md()
      content = converter.turndown(content)
      const result: Message.Global.FileContent = { content }
      return JSON.stringify(result)
    },

    html2bbcode(msg: string) {
      const { content }: Message.Global.FileContent = JSON.parse(msg)
      const converter = new html2md()
      const md = converter.turndown(content)
      const reader = new commonmark.Parser()
      const writer = new md2bbc.BBCodeRenderer()
      const parsed = reader.parse(md.replaceAll('\n* * *', ''))
      const bbcode = writer.render(parsed).slice(1).replace(/\[img\salt="[\S]*?"\]/g, '[img]')
      const result: Message.Global.FileContent = { content: bbcode }
      return JSON.stringify(result)
    },

    async getConfigName() {
      const name = settingsStore.getConfigName()
      const msg: Message.Global.ConfigName = { name }
      return JSON.stringify(msg)
    },

    async setConfigName(msg: string) {
      const { name }: Message.Global.ConfigName = JSON.parse(msg)
      await settingsStore.setConfigName(name)
    },

    async changeConfig() {
      const userDB = getUserDBOrThrow()
      await userDB.write()
      const configDir = join(app.getPath('userData'), 'configs')
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir)
      }
      fs.copyFileSync(
        join(app.getPath('userData'), USER_DB_FILE),
        join(configDir, `${settingsStore.getConfigName()}.json`),
      )
      fs.rmSync(join(app.getPath('userData'), USER_DB_FILE))
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: configDir,
      })
      if (canceled) return
      fs.copyFileSync(filePaths[0], join(app.getPath('userData'), USER_DB_FILE))
      app.relaunch()
      app.exit()
    },

    async createConfig() {
      const userDB = getUserDBOrThrow()
      await userDB.write()
      const configDir = join(app.getPath('userData'), 'configs')
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir)
      }
      fs.copyFileSync(
        join(app.getPath('userData'), USER_DB_FILE),
        join(configDir, `${settingsStore.getConfigName()}.json`),
      )
      fs.rmSync(join(app.getPath('userData'), USER_DB_FILE))
      app.relaunch()
      app.exit()
    },
  }
}
