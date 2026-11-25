import { Fragment, type ReactNode } from 'react'

// Small, dependency-free Markdown renderer (headings, lists, code, bold/italic/inline code, links).
// Everything is rendered as React nodes, so model output can never inject HTML.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`
    if (tok.startsWith('`')) out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      out.push(<a key={key} href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">{label}</a>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(<pre key={k++} className="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>{code.join('\n')}</code></pre>)
    } else if (/^#{1,4}\s/.test(line)) {
      const level = /^#+/.exec(line)![0].length
      const cls = level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
      blocks.push(<p key={k++} className={cls}>{inline(line.replace(/^#+\s*/, ''), `h${k}`)}</p>)
      i++
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={k++} className={ordered ? 'list-decimal pl-5 space-y-1' : 'list-disc pl-5 space-y-1'}>
          {items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}
        </Tag>
      )
    } else if (!line.trim()) {
      i++
    } else {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++])
      blocks.push(
        <p key={k++}>
          {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}-${j}`)}</Fragment>)}
        </p>
      )
    }
  }
  return <div className="space-y-2 text-sm leading-relaxed break-words">{blocks}</div>
}
