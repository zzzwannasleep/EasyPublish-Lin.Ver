async function parseMessage<T>(promise: Promise<string>): Promise<T> {
  return JSON.parse(await promise) as T
}

export const taskBridge = {
  getContent(id: number) {
    return parseMessage<Message.Task.TaskContents>(window.taskAPI.getContent(JSON.stringify({ id })))
  },

  getPublishConfig(id: number) {
    return parseMessage<Config.PublishConfig>(window.taskAPI.getPublishConfig(JSON.stringify({ id })))
  },
}
