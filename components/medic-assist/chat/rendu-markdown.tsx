'use client'

/**
 * Rendu markdown des reponses (react-markdown + remark-gfm, HTML brut ignore).
 * Seul fichier du lot autorise a importer ces deux paquets.
 */

import { isValidElement, useState, type ReactNode } from 'react'
import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** Texte d'un noeud React (pour copier un bloc de code). */
function texteDe(noeud: ReactNode): string {
  if (typeof noeud === 'string' || typeof noeud === 'number') return String(noeud)
  if (Array.isArray(noeud)) return noeud.map(texteDe).join('')
  if (isValidElement(noeud)) return texteDe((noeud.props as { children?: ReactNode }).children)
  return ''
}

/** Pendant le streaming, une barriere de code non fermee ne doit pas avaler la suite. */
function fermerCodeOuvert(markdown: string): string {
  const barrieres = markdown.match(/^\s*```/gm)
  return barrieres && barrieres.length % 2 === 1 ? `${markdown}\n\`\`\`` : markdown
}

function BlocCode({ children }: { children: ReactNode }) {
  const t = useTranslations('medicAssist.message')
  const [copie, setCopie] = useState(false)
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texteDe(children).replace(/\n$/, ''))
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      toast.error(t('erreurCopie'))
    }
  }
  return (
    <div className="group/code relative my-3">
      <pre className="overflow-x-auto rounded-lg border bg-secondary p-3 pe-10 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
      <button
        type="button"
        onClick={copier}
        aria-label={t('copierCode')}
        title={t('copierCode')}
        className="cible-tactile absolute end-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {copie ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

function classeAlignement(props: { style?: { textAlign?: string }; align?: string }): string {
  const alignement = props.style?.textAlign ?? props.align
  if (alignement === 'right') return 'text-end'
  if (alignement === 'center') return 'text-center'
  return 'text-start'
}

const composants: Components = {
  h1: ({ children }) => <h2 dir="auto" className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 dir="auto" className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 dir="auto" className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 dir="auto" className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 dir="auto" className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 dir="auto" className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p dir="auto" className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul dir="auto" className="my-2 list-disc space-y-1 ps-5 leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol dir="auto" className="my-2 list-decimal space-y-1 ps-5 leading-relaxed">{children}</ol>,
  li: ({ children }) => <li dir="auto" className="ps-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  hr: () => <hr className="my-4 border-border" />,
  blockquote: ({ children }) => (
    <blockquote dir="auto" className="my-3 border-s-2 border-border ps-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => <BlocCode>{children}</BlocCode>,
  code: ({ className, children }) => {
    const texte = texteDe(children)
    const bloc = Boolean(className?.includes('language-')) || texte.includes('\n')
    if (bloc) return <code className={cn('font-mono', className)}>{children}</code>
    return (
      <code className="rounded-md bg-secondary px-1 py-0.5 font-mono text-[0.875em]">{children}</code>
    )
  },
  a: ({ href, children }) => {
    // urlTransform n'a laisse passer que les chemins internes et les ancres : tout autre lien
    // arrive ici sans href et se rend comme du texte simple.
    if (!href) return <>{children}</>
    const classe = 'text-primary underline underline-offset-2 hover:no-underline'
    if (href.startsWith('#')) {
      return (
        <a href={href} className={classe}>
          {children}
        </a>
      )
    }
    return (
      <Link href={href} prefetch={false} className={classe}>
        {children}
      </Link>
    )
  },
  img: () => null,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="sticky top-0 bg-secondary">{children}</thead>,
  tr: ({ children }) => <tr className="border-b last:border-b-0">{children}</tr>,
  th: (props) => (
    <th
      className={cn(
        'whitespace-nowrap bg-secondary px-3 py-2 font-semibold tabular-nums',
        classeAlignement(props as { style?: { textAlign?: string }; align?: string }),
      )}
    >
      {props.children}
    </th>
  ),
  td: (props) => (
    <td
      className={cn(
        'px-3 py-2 align-top tabular-nums',
        classeAlignement(props as { style?: { textAlign?: string }; align?: string }),
      )}
    >
      {props.children}
    </td>
  ),
}


/**
 * Defense en profondeur (en plus de skipHtml et de l'absence d'images) : seuls passent les
 * chemins internes (`/chemin`, jamais `//`, `/api`, ni avec antislash) et les ancres (`#...`). Tout le reste
 * (http, mailto, javascript:, data:, relatif...) devient une chaine vide, donc un lien sans
 * href, rendu comme du texte. Les espaces et caracteres de controle sont refuses : le
 * navigateur les retire avant d'analyser l'URL (`/<tab>/evil` deviendrait `//evil`).
 */
export function urlTransformStricte(url: string): string {
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x5c) return ''
  }
  if (url.startsWith('#')) return url
  // Comme CheminInterneSchema : jamais l'API (/api, /api/..., /api?...), sans tenir compte de la casse.
  if (/^\/api(?:\/|$|\?|#)/i.test(url)) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  return ''
}

export function RenduMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="min-w-0 break-words text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={composants}
        urlTransform={urlTransformStricte}
      >
        {fermerCodeOuvert(markdown)}
      </ReactMarkdown>
    </div>
  )
}
