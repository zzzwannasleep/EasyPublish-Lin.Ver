export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getNowFormatDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  const m = month < 10 ? `0${month}` : month.toString()
  const d = day < 10 ? `0${day}` : day.toString()
  const h = hour < 10 ? `0${hour}` : hour.toString()
  const mi = minute < 10 ? `0${minute}` : minute.toString()
  const s = second < 10 ? `0${second}` : second.toString()

  return `${year}-${m}-${d}T${h}:${mi}:${s}`
}

export function getCurrentTime() {
  const stamp = new Date().getTime() + 8 * 60 * 60 * 1000
  return new Date(stamp).toISOString().replace(/T/, ' ').replace(/\..+/, '').substring(0, 19)
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function unescapeHtml(str: string) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
