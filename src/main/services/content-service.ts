import { dialog } from 'electron'
import fs from 'fs'
import { Low } from 'lowdb'
import log from 'electron-log'
import commonmark from 'commonmark'
import md2bbc from 'markdown-to-bbcode'
import { basename, join } from 'path'
import html2md from 'turndown'

type TaskDbProvider = () => Low<Config.TaskData>

interface CreateContentServiceOptions {
  getTaskDB: TaskDbProvider
}

export function createContentService(options: CreateContentServiceOptions) {
  const { getTaskDB } = options

  function getTaskDBOrThrow() {
    const taskDB = getTaskDB()
    if (!taskDB) {
      throw new Error('Task DB is not initialized')
    }
    return taskDB
  }

  async function getContent(msg: string) {
    const taskDB = getTaskDBOrThrow()
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = taskDB.data.tasks.find(item => item.id == id)!
    const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
    const md = fs.readFileSync(join(task.path, 'nyaa.md'), { encoding: 'utf-8' })
    const bbcode = fs.readFileSync(join(task.path, 'acgrip.bbcode'), { encoding: 'utf-8' })
    const content: Config.PublishConfig = JSON.parse(
      fs.readFileSync(join(task.path, 'config.json'), { encoding: 'utf-8' }),
    )
    const result: Message.Task.TaskContents = { html, md, bbcode, title: content.title }
    return JSON.stringify(result)
  }

  async function saveContent(msg: string) {
    const taskDB = getTaskDBOrThrow()
    const { id, content, type }: Message.Task.ModifiedContent = JSON.parse(msg)
    const task = taskDB.data.tasks.find(item => item.id == id)!
    if (type == 'html') fs.writeFileSync(join(task.path, 'bangumi.html'), content, { encoding: 'utf-8' })
    if (type == 'md') fs.writeFileSync(join(task.path, 'nyaa.md'), content, { encoding: 'utf-8' })
    if (type == 'bbcode') fs.writeFileSync(join(task.path, 'acgrip.bbcode'), content, { encoding: 'utf-8' })
  }

  async function saveTitle(msg: string) {
    const taskDB = getTaskDBOrThrow()
    const { id, title }: Message.Task.ModifiedTitle = JSON.parse(msg)
    const task = taskDB.data.tasks.find(item => item.id == id)!
    const path = join(task.path, 'config.json')
    const config: Config.PublishConfig = JSON.parse(fs.readFileSync(path, { encoding: 'utf-8' }))
    config.title = title
    fs.writeFileSync(path, JSON.stringify(config), { encoding: 'utf-8' })
  }

  async function exportContent(msg: string) {
    const taskDB = getTaskDBOrThrow()
    const { id, type }: Message.Task.ContentType = JSON.parse(msg)
    const task = taskDB.data.tasks.find(item => item.id == id)!
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: task.name,
      filters: [{ name: type, extensions: [type] }],
    })
    if (canceled) return
    let filename = ''
    if (type == 'html') filename = 'bangumi.html'
    if (type == 'md') filename = 'nyaa.md'
    if (type == 'bbcode') filename = 'acgrip.bbcode'
    fs.copyFileSync(join(task.path, filename), filePath)
  }

  async function loadComparisons() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'txt', extensions: ['txt'] }],
    })
    if (canceled) return

    const content = fs.readFileSync(filePaths[0], { encoding: 'utf-8' })
    let html = content.match(/<p>[\s\S]*<\/p>/)![0]
    let md = content.match(/\[!\[\]\([\s\S]*\)\s\s/)![0]
    let bbcode = content.match(/\[URL=[\s\S]*\[\/URL\]/)![0]
    const title =
      'Comparison (right click on the image and open it in a new tab to see the full-size one)\n' +
      content.match(/<br\/>[\s\S]*?<br\/>/)![0].slice(5).slice(0, -5).trim() +
      '\n\n'

    html += '\n'
    md = title + md
    bbcode = title + bbcode + '\n'
    bbcode = bbcode.replace(/IMG/g, 'img')
    bbcode = bbcode.replace(/URL/g, 'url')

    const message: Message.Task.Comparisons = { html, md, bbcode }
    return JSON.stringify(message)
  }

  async function createConfig(msg: string) {
    const { id, config, type }: Message.Task.ModifiedConfig = JSON.parse(msg)
    let result = ''
    if (type == 'template') result = await createWithTemplate(id, config)
    else result = await createWithFile(id, config)
    const response: Message.Task.Result = { result }
    return JSON.stringify(response)
  }

  async function createWithFile(id: number, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const task = taskDB.data.tasks.find(item => item.id == id)
      const info = config.content as Config.Content_file
      if (!task) return 'taskNotFound'
      fs.writeFileSync(join(task.path, 'config.json'), JSON.stringify(config))
      if (!fs.existsSync(config.torrentPath)) return 'noSuchFile_torrent'
      if (!fs.existsSync(info.path_html)) return 'noSuchFile_html'
      else fs.copyFileSync(info.path_html, join(task.path, 'bangumi.html'))
      if (!fs.existsSync(info.path_md)) {
        if (info.path_md != '') return 'noSuchFile_md'
        const content = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
        const converter = new html2md()
        const md = converter.turndown(content)
        fs.writeFileSync(join(task.path, 'nyaa.md'), md)
      } else {
        fs.copyFileSync(info.path_md, join(task.path, 'nyaa.md'))
      }
      if (!fs.existsSync(info.path_bbcode)) {
        if (info.path_bbcode != '') return 'noSuchFile_bbcode'
        const content = fs.readFileSync(join(task.path, 'nyaa.md'), { encoding: 'utf-8' })
        const reader = new commonmark.Parser()
        const writer = new md2bbc.BBCodeRenderer()
        const parsed = reader.parse((content as string).replaceAll('\n* * *', ''))
        const bbcode = writer.render(parsed).slice(1).replace(/\[img\salt="[\S]*?"\]/, '[img]')
        fs.writeFileSync(join(task.path, 'acgrip.bbcode'), bbcode)
      } else {
        fs.copyFileSync(info.path_bbcode, join(task.path, 'acgrip.bbcode'))
      }
      fs.copyFileSync(config.torrentPath, join(task.path, basename(config.torrentPath)))
      return 'success'
    } catch (err) {
      dialog.showErrorBox('错误', (err as Error).message)
      return 'failed'
    }
  }

  async function createWithTemplate(id: number, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const task = taskDB.data.tasks.find(item => item.id == id)
      const info = config.content as Config.Content_template
      if (!task) return 'taskNotFound'
      fs.writeFileSync(join(task.path, 'config.json'), JSON.stringify(config))
      if (!fs.existsSync(config.torrentPath)) return 'noSuchFile_torrent'
      let content = '<p>\n'
      content += `<img src="${info.posterUrl}" alt="${basename(info.posterUrl)}" /><br />\n<br />\n`
      let note = ''
      if (info.note)
        info.note.forEach(item => {
          if (item != 'MOVIE') note += item + ' + '
        })
      if (note != '') note = note.slice(0, -2)
      const reseed = info.reseed ? ` Reseed${info.rsVersion > 1 ? ` v${info.rsVersion}` : ''}` : ''
      if (config.title.includes(info.title_JP)) {
        if (info.title_CN != '') content += info.title_CN + ' / '
        content += info.title_EN
        if (info.title_JP != '') content += ` / ${info.title_JP} `
        content += ` ${note} ${info.contentType}${reseed} <br />\n`
      } else {
        if (info.title_CN != '') content += `${info.title_CN} ${note} ${info.contentType}${reseed} <br />\n`
        content += `${info.title_EN} ${note} ${info.contentType}${reseed} <br />\n`
        if (info.title_JP != '') content += `${info.title_JP} ${note} ${info.contentType}${reseed} <br />\n`
      }
      content += '<br />\n'
      if (info.sub_CN && info.sub_CN != '') {
        content += `${info.sub_CN}<br />\n${info.sub_EN}<br />\n`
      }
      if (info.audio_CN && info.audio_CN != '') {
        content += `${info.audio_CN}<br />\n${info.audio_EN}<br />\n`
      }
      if (content.slice(-14) != '<br />\n<br />\n') content += '<br />\n'
      if (info.nomination) {
        content += '本番由 <strong>组员提名</strong>，应要求制作。感谢他们为 VCB-Studio 发展做出的无私奉献。<br />\n'
        content +=
          'This project was <strong>nominated by our members</strong> and produced upon request. Thanks to them for their selfless dedication to the development of VCB-Studio.<br />\n<br />\n'
      }
      let team_CN = ''
      let team_EN = ''
      if (info.subTeam_CN && info.subTeam_EN) {
        info.subTeam_CN.forEach(item => {
          team_CN += `<strong>${item}</strong> 和 `
        })
        info.subTeam_EN.forEach(item => {
          team_EN += `<strong>${item}</strong> & `
        })
      }
      if (team_CN != '') {
        team_CN = team_CN.slice(0, -3)
        team_EN = team_EN.slice(0, -3)
        content += `这个项目与 ${team_CN} 合作，感谢他们精心制作的字幕。<br />\n`
        content += `This project is in collaboration with ${team_EN}. Thanks to them for crafting Chinese subtitles.<br />\n<br />\n`
      }
      const comment_CN = info.comment_CN.split('\n')
      const comment_EN = info.comment_EN.split('\n')
      for (let i = 0; i < comment_CN.length; i++) {
        content += comment_CN[i] + '<br />\n'
        content += comment_EN[i] + '<br />\n<br />\n'
      }
      if (content.slice(-14) != '<br />\n<br />\n') content += '<br />\n'
      if (info.nonsense) {
        const nonsense = info.nonsense.split('\n')
        nonsense.forEach(item => {
          content += item + '<br />\n'
        })
      }
      if (content.slice(-14) != '<br />\n<br />\n') content += '<br />\n'
      content += '</p>\n<hr />\n<p>\n'
      if (info.reseed) {
        const rsComment_CN = info.rsComment_CN!.split('\n')
        const rsComment_EN = info.rsComment_EN!.split('\n')
        content += '重发修正：<br />\n'
        rsComment_CN.forEach(item => {
          content += item + '<br />\n'
        })
        content += '<br />\nReseed comment:<br />\n'
        rsComment_EN.forEach(item => {
          content += item + '<br />\n'
        })
        content += '<br />\n</p>\n<hr />\n<p>\n'
      }
      content += '感谢所有参与制作者 / Thanks to our participating members:<br />\n'
      content += '总监 / Script: ' + info.members.script + '<br />\n'
      content += '压制 / Encode: ' + info.members.encode + '<br />\n'
      content += '整理 / Collate: ' + info.members.collate + '<br />\n'
      content += '发布 / Upload: ' + info.members.upload + '<br />\n'
      content += '分流 / Seed: VCB-Studio CDN 分流成员<br />\n'
      if (info.providers && info.providers != '') {
        const providers = info.providers.split('\n')
        content += '<br />\n感谢所有资源提供者 / Thanks to all resource providers:<br />\n'
        providers.forEach(item => {
          content += item + '<br />\n'
        })
      }
      content += '<br />\n</p>\n<hr />\n<p>\n'
      if (info.reseed) {
        content += '本次发布来自 VCB-Studio 旧作重发计划。我们会不定期重发过去发布过的合集，或为补充做种，或为修正制作错漏，或为整合系列合集。<br />\n'
        content +=
          'This is a release of VCB-Studio Reseed Project. We would re-upload previous torrents from time to time, to resurrect old torrents with few seeders, to correct errors/omissions, or to batch separate releases that belong to a same series.<br />\n'
        content += '<br />\n</p>\n<hr />\n<p>\n'
      }
      if (!info.reseed) {
        content += ' VCB-Studio 已不再保证收集作品相关 CD 和扫图资源，详情请参见 <a href="https://vcb-s.com/archives/14331">https://vcb-s.com/archives/14331</a>。<br />\n'
        content +=
          'Please refer to <a href="https://vcb-s.com/archives/14331">https://vcb-s.com/archives/14331</a> on VCB-Studio no longer guaranteeing the inclusion of relevant CDs and scans.<br />\n<br />\n'
        content += '本组（不）定期招募新成员。详情请参见 <a href="https://vcb-s.com/archives/16986">https://vcb-s.com/archives/16986</a>。<br />\n'
        content +=
          'Please refer to <a href="https://vcb-s.com/archives/16986">https://vcb-s.com/archives/16986</a> for information on our (un)scheduled recruitment.<br />\n<br />\n'
      }
      content += '播放器教程索引： <a href="https://vcb-s.com/archives/16639" target="_blank">VCB-Studio 播放器推荐</a><br />\n'
      content += '中文字幕分享区： <a href="https://bbs.acgrip.com/" target="_blank">Anime 分享论坛</a><br />\n'
      content += '项目计划与列表： <a href="https://vcb-s.com/archives/138" target="_blank">VCB-Studio 项目列表</a><br />\n'
      content += '特殊格式与说明： <a href="https://vcb-s.com/archives/7949" target="_blank">WebP 扫图说明</a><br />\n<br />\n</p>\n'
      if (!info.reseed) {
        content += '<hr />\n'
        content += info.comparisons_html
      }
      const converter = new html2md()
      const md = converter.turndown(content)
      const reader = new commonmark.Parser()
      const bbcodeWriter = new md2bbc.BBCodeRenderer()
      const parsed_bbcode = reader.parse((md as string).replaceAll('\n* * *', ''))
      const bbcode = bbcodeWriter.render(parsed_bbcode).slice(1).replace(/\[img\salt="[\s\S]*?"\]/g, '[img]')
      const html = content
      fs.writeFileSync(join(task.path, 'bangumi.html'), html)
      fs.writeFileSync(join(task.path, 'nyaa.md'), md)
      fs.writeFileSync(join(task.path, 'acgrip.bbcode'), bbcode)
      fs.copyFileSync(config.torrentPath, join(task.path, basename(config.torrentPath)))
      return 'success'
    } catch (err) {
      dialog.showErrorBox('错误', (err as Error).message)
      return 'failed'
    }
  }

  async function getForumConfig(msg: string) {
    try {
      const taskDB = getTaskDBOrThrow()
      const { id }: Message.Task.TaskID = JSON.parse(msg)
      const task = taskDB.data.tasks.find(item => item.id == id)!
      const result: Message.Forum.Contents = {}
      if (task.type == 'template') {
        const config: Config.PublishConfig = JSON.parse(
          fs.readFileSync(join(task.path, 'config.json'), { encoding: 'utf-8' }),
        )
        const info = config.content as Config.Content_template
        let note = ''
        if (info.note) info.note.forEach(item => { note += item + ' + ' })
        if (note != '') note = note.slice(0, -2)
        if (info.reseed) note += `Reseed${info.rsVersion > 1 ? ` v${info.rsVersion}` : ''} Fin`
        else note += 'Fin'
        let title = `${info.title_EN}${info.title_CN == '' ? '' : ' / ' + info.title_CN} ${info.depth} ${info.resolution} `
        title += `${info.encoding} ${info.contentType} [${note}]`
        result.title = title
        let team_CN = ''
        let content = ''
        if (info.nomination) content += '本番由 <strong>组员提名</strong>，应要求制作。感谢他们为 VCB-Studio 发展做出的无私奉献。\n\n'
        if (info.subTeam_CN) {
          info.subTeam_CN.forEach(item => {
            team_CN += `<strong>${item}</strong> 和 `
          })
        }
        if (team_CN != '') {
          team_CN = team_CN.slice(0, -3)
          content += `这个项目与 ${team_CN} 合作，感谢他们精心制作的字幕。\n\n`
        }
        content += info.comment_CN + '\n\n'
        if (info.sub_CN && info.sub_CN != '') {
          content += info.sub_CN + '\n'
        }
        if (info.audio_CN && info.audio_CN != '') {
          content += info.audio_CN + '\n'
        }
        if (content.slice(-2) != '\n\n') content += '\n'
        if (info.nonsense && info.nonsense != '') {
          content += info.nonsense + '\n\n'
        }
        content += '<!--more-->\n\n感谢所有参与制作者：\n'
        content += `总监：${info.members.script}\n`
        content += `压制：${info.members.encode}\n`
        content += `整理：${info.members.collate}\n`
        content += `发布：${info.members.upload}\n`
        content += '分流：VCB-Studio CDN 分流成员\n\n'
        if (info.reseed) {
          content += '[box style="info"]\n重发修正：\n\n'
          content += info.rsComment_CN + '\n[/box]\n\n'
        }
        content += '[box style="download"]\n'
        content += `${info.depth} ${info.resolution} ${info.encoding}${info.reseed ? ' (Reseed)' : ''}`
        content += '\n\n链接加载中[/box]\n\n'
        if (info.reseed) content += '<hr />\n\n请将旧链放于此\n\n'
        if (info.imageCredit != '') {
          content += `Image Credit: <a href="${info.imageSource}" rel="noopener" target="_blank">${info.imageCredit}</a>\n\n`
        }
        content += '<label for="medie-info-switch" class="btn btn-inverse-primary" title="展开MediaInfo">MediaInfo</label>\n\n'
        content += '<pre class="js-medie-info-detail medie-info-detail" style="display: none">\n'
        if (info.mediaInfo == '') content += '请将MediaInfo放置于此'
        else content += info.mediaInfo
        content += '\n</pre>'
        result.content = content
        result.imagePath = info.imagePath
      }
      return JSON.stringify(result)
    } catch (err) {
      log.error(err)
      dialog.showErrorBox('错误', (err as Error).message)
      return
    }
  }

  return {
    getContent,
    saveContent,
    saveTitle,
    exportContent,
    loadComparisons,
    createConfig,
    getForumConfig,
  }
}
