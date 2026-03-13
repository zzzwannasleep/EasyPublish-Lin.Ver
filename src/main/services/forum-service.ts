import fs from 'fs'
import axios from 'axios'
import log from 'electron-log'
import { basename } from 'path'
import type { PublishResult } from '../../shared/types/publish'
import { getNowFormatDate } from '../core/utils'
import { createCredentialStore } from '../storage/credential-store'
import { createProjectStore } from '../storage/project-store'

type LoginWindowOpener = (type: string) => Promise<void> | void

interface CreateForumServiceOptions {
  credentialStore: ReturnType<typeof createCredentialStore>
  projectStore: ReturnType<typeof createProjectStore>
  openSiteLoginWindow: LoginWindowOpener
}

export function createForumService(options: CreateForumServiceOptions) {
  const { credentialStore, projectStore, openSiteLoginWindow } = options

  async function persistForumResult(id: number, result: PublishResult) {
    projectStore.recordPublishResult(id, result)
    await projectStore.write()
  }

  function getAccountInfo() {
    const info = credentialStore.getForumCredentials()
    const msg: Message.Forum.AccountInfo = {
      username: info.username,
      password: info.password,
    }
    return JSON.stringify(msg)
  }

  async function saveAccountInfo(msg: string) {
    const info: Message.Forum.AccountInfo = JSON.parse(msg)
    await credentialStore.saveForumCredentials(info)
  }

  async function searchPosts(msg: string) {
    const { title }: Message.Forum.Title = JSON.parse(msg)
    const result: Message.Forum.Posts = { posts: [] }
    const response = await axios.get(`https://vcb-s.com/wp-json/wp/v2/posts?context=edit&search=${title}`, {
      responseType: 'json',
    })
    if (response.status == 403) {
      void openSiteLoginWindow('vcb')
      throw new Error('forum_forbidden')
    }
    if (response.data.status == 401) {
      throw new Error('forum_unauthorized')
    }
    response.data.forEach(item => {
      result.posts.push({
        id: item.id,
        title: item.title.rendered,
        content: item.content.rendered.split('<!--more-->')[0],
        raw: item.content.raw,
      })
    })
    return JSON.stringify(result)
  }

  async function publish(msg: string) {
    const message: Message.Task.Result = { result: '' }
    try {
      const config: Message.Forum.PublishConfig = JSON.parse(msg)
      if (!fs.existsSync(config.imagePath)) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Featured image file does not exist',
        })
        message.result = 'noSuchFile_webp'
        return JSON.stringify(message)
      }
      const img = fs.readFileSync(config.imagePath)
      const imageData = new FormData()
      imageData.append('file', new Blob([img]), basename(config.imagePath))
      const mediaResult = await axios.post('https://vcb-s.com/wp-json/wp/v2/media', imageData, { responseType: 'json' })
      if (mediaResult.status == 403) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site media upload is forbidden',
          rawResponse: mediaResult.data,
        })
        message.result = 'forbidden'
        void openSiteLoginWindow('vcb')
        return JSON.stringify(message)
      }
      if (mediaResult.status == 401) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site media upload is unauthorized',
          rawResponse: mediaResult.data,
        })
        message.result = 'unauthorized'
        return JSON.stringify(message)
      }
      if (mediaResult.status != 201) throw mediaResult

      const data = {
        title: config.title,
        content: config.content,
        status: 'publish',
        format: 'standard',
        categories: JSON.parse(config.categories),
        featured_media: mediaResult.data.id,
      }
      const response = await axios.post('https://vcb-s.com/wp-json/wp/v2/posts', data, { responseType: 'json' })
      if (response.status == 201) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'published',
          remoteId: `${response.data.id}`,
          remoteUrl: response.data.link,
          message: 'Main site post published',
          rawResponse: response.data,
        })
        message.result = 'success'
        return JSON.stringify(message)
      }
      if (response.status == 400) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site post publish rejected with invalid content',
          rawResponse: response.data,
        })
        message.result = 'empty'
        return JSON.stringify(message)
      }
      throw response
    } catch (err) {
      log.error(err)
      const config: Message.Forum.PublishConfig = JSON.parse(msg)
      await persistForumResult(config.id, {
        siteId: 'forum',
        status: 'failed',
        message: (err as Error).message,
      })
      message.result = 'failed'
      return JSON.stringify(message)
    }
  }

  async function rsPublish(msg: string) {
    const message: Message.Task.Result = { result: '' }
    try {
      const config: Message.Forum.RSConfig = JSON.parse(msg)
      const data = {
        date: getNowFormatDate(),
        title: config.title,
        content: config.content,
      }
      const response = await axios.patch(`https://vcb-s.com/wp-json/wp/v2/posts/${config.rsID}`, data, {
        responseType: 'json',
      })
      if (response.status == 403) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site update is forbidden',
          rawResponse: response.data,
        })
        message.result = 'forbidden'
        void openSiteLoginWindow('vcb')
        return JSON.stringify(message)
      }
      if (response.status == 200) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'published',
          remoteId: `${response.data.id}`,
          remoteUrl: response.data.link,
          message: 'Main site post updated',
          rawResponse: response.data,
        })
        message.result = 'success'
        return JSON.stringify(message)
      }
      if (response.status == 400) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site update rejected with invalid content',
          rawResponse: response.data,
        })
        message.result = 'empty'
        return JSON.stringify(message)
      }
      if (response.status == 401) {
        await persistForumResult(config.id, {
          siteId: 'forum',
          status: 'failed',
          message: 'Main site update is unauthorized',
          rawResponse: response.data,
        })
        message.result = 'unauthorized'
        return JSON.stringify(message)
      }
      throw response
    } catch (err) {
      log.error(err)
      const config: Message.Forum.RSConfig = JSON.parse(msg)
      await persistForumResult(config.id, {
        siteId: 'forum',
        status: 'failed',
        message: (err as Error).message,
      })
      message.result = 'failed'
      return JSON.stringify(message)
    }
  }

  return {
    getAccountInfo,
    saveAccountInfo,
    searchPosts,
    publish,
    rsPublish,
  }
}
