import commonmark from 'commonmark'
import md2bbc from 'markdown-to-bbcode'
import bbobHTML from '@bbob/html'
import presetHTML5 from '@bbob/preset-html5'
import { marked } from 'marked'
import html2md from 'turndown'
import type { MarkupFormat } from '../../shared/types/project'

const BBCodeImageAltPattern = /\[img\salt="[\s\S]*?"\]/g

export function markdownToHtml(markdown: string) {
  return marked.parse(markdown, { async: false }) as string
}

export function markdownToBbcode(markdown: string) {
  const reader = new commonmark.Parser()
  const writer = new md2bbc.BBCodeRenderer()
  const parsed = reader.parse(markdown.replaceAll('\n* * *', ''))
  return writer.render(parsed).slice(1).replace(BBCodeImageAltPattern, '[img]')
}

export function htmlToMarkdown(html: string) {
  const converter = new html2md()
  converter.addRule('alignedBlocks', {
    filter(node) {
      const tagName = node.nodeName.toLowerCase()
      if (!['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        return false
      }

      const style = typeof node.getAttribute === 'function' ? node.getAttribute('style') ?? '' : ''
      return /text-align\s*:\s*(left|center|right|justify)/i.test(style)
    },
    replacement(_content, node) {
      const tagName = node.nodeName.toLowerCase()
      const style = typeof node.getAttribute === 'function' ? node.getAttribute('style') ?? '' : ''
      const alignMatch = style.match(/text-align\s*:\s*(left|center|right|justify)/i)
      const innerHtml = typeof node.innerHTML === 'string' ? node.innerHTML.trim() : ''

      if (!alignMatch || !innerHtml) {
        return ''
      }

      return `\n<${tagName} style="text-align: ${alignMatch[1].toLowerCase()}">${innerHtml}</${tagName}>\n`
    },
  })
  converter.addRule('underlinedText', {
    filter(node) {
      return node.nodeName.toLowerCase() === 'u'
    },
    replacement(content) {
      return `<u>${content}</u>`
    },
  })
  return converter.turndown(html)
}

export function htmlToBbcode(html: string) {
  return markdownToBbcode(htmlToMarkdown(html))
}

export function bbcodeToHtml(bbcode: string) {
  return bbobHTML(bbcode.replace(/\n/g, '<br/>'), presetHTML5())
}

export function buildDerivedMarkupFromHtml(html: string) {
  const md = htmlToMarkdown(html)
  return {
    html,
    md,
    bbcode: markdownToBbcode(md),
  }
}

export function buildDerivedMarkupFromMarkdown(md: string) {
  return {
    html: markdownToHtml(md),
    md,
    bbcode: markdownToBbcode(md),
  }
}

export function buildDerivedMarkupFromContent(content: string, format: MarkupFormat) {
  if (format === 'md') {
    return buildDerivedMarkupFromMarkdown(content)
  }

  if (format === 'bbcode') {
    return buildDerivedMarkupFromHtml(bbcodeToHtml(content))
  }

  return buildDerivedMarkupFromHtml(content)
}
