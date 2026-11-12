'use client'

/**
 * Rendu sûr d'un markdown produit par l'assistant (blocs « texte » d'un document).
 *
 * Sécurité : HTML brut ignoré (`skipHtml`), aucune image, et `urlTransform` STRICT : seuls les
 * chemins internes (un seul « / » en tête, hors `/api`) et les ancres `#` survivent ; tout autre
 * lien (externe, `javascript:`, `data:`, relatif, protocole relatif) devient une cible vide et
 * est rendu en texte simple, sans `href` : un lien externe n'existe donc jamais dans la page
 * (ni `target` ni `rel` à poser).
 *
 * Typographie calme : pas de grand titre, `#` et `##` donnent un h2, les niveaux plus
 * profonds un h3. Les titres portent l'id d'ancre calculé par `planDocument` (clé : ligne
 * du titre dans le markdown) pour la table des matières.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export interface MarkdownRenduProps {
  markdown: string
  /** Ids d'ancre des titres de ce bloc, par numéro de ligne (`PlanDocument.idsParBloc[i]`). */
  idsTitres?: Record<number, string>
  className?: string
}

interface NoeudMarkdown {
  position?: { start?: { line?: number } }
}

type AvecNoeud<T> = T & { node?: NoeudMarkdown; children?: ReactNode }

/** Caractère de contrôle ou espace : jamais dans une cible acceptée. */
const CARACTERES_REFUSES = /[\p{Cc}\s]/u

/** Caractère de contrôle encodé en pourcentage (`%00`-`%1F`, `%7F`). */
const CONTROLE_ENCODE = /%(?:[01][\da-fA-F]|7[fF])/

/** `&` suivi d'une référence d'entité HTML (nommée, décimale ou hexadécimale). */
const REFERENCE_ENTITE = /&(?:#\d+|#[xX][\da-fA-F]+|[a-zA-Z][a-zA-Z\d]*);/

/**
 * Cible acceptée par `urlTransform` : un chemin interne (un seul « / » en tête, ni `//hote`,
 * ni `/\hote`, ni `/api`) ou une ancre `#…`. Tout le reste (http, mailto, javascript, data,
 * chemin relatif, espace, caractère de contrôle) est refusé.
 */
export function cibleAutorisee(cible: string | undefined | null): cible is string {
  if (!cible || CARACTERES_REFUSES.test(cible)) return false
  // Défense en profondeur : une référence d'entité (`&#47;`, `&sol;`, `&colon;`...) n'a rien à
  // faire dans une cible déjà décodée par le parseur ; on la refuse plutôt que de la décoder.
  if (REFERENCE_ENTITE.test(cible)) return false
  // Le parseur ré-encode un caractère de contrôle décodé (`&Tab;` → `%09`) : on le refuse aussi.
  if (CONTROLE_ENCODE.test(cible)) return false
  if (cible.startsWith('#')) return true
  if (!cible.startsWith('/')) return false
  if (cible.startsWith('//') || cible.startsWith('/\\')) return false
  return !/^\/api(?:[/?#]|$)/i.test(cible)
}

/**
 * `urlTransform` de react-markdown 10 : `(url, key, node) => string | null | undefined`. Une
 * cible refusée devient une chaîne vide ; le lien est alors rendu en texte, sans `href`.
 */
export function transformerUrl(url: string): string {
  return cibleAutorisee(url) ? url : ''
}

/** Lien interne (chemin) : cliquable via `next/link`. */
export function estLienInterne(href: string | undefined): href is string {
  return cibleAutorisee(href) && href.startsWith('/')
}

function creerTitre(niveau: 2 | 3, idsTitres: Record<number, string> | undefined) {
  const Balise = niveau === 2 ? 'h2' : 'h3'
  return function Titre({ node, children }: AvecNoeud<ComponentPropsWithoutRef<'h2'>>) {
    const ligne = node?.position?.start?.line
    const id = ligne !== undefined ? idsTitres?.[ligne] : undefined
    return (
      <Balise
        id={id}
        tabIndex={id ? -1 : undefined}
        dir="auto"
        className={cn(
          'scroll-mt-24 font-semibold text-foreground focus:outline-none',
          niveau === 2 ? 'mt-6 text-base first:mt-0' : 'mt-4 text-sm first:mt-0'
        )}
      >
        {children}
      </Balise>
    )
  }
}

export function MarkdownRendu({ markdown, idsTitres, className }: MarkdownRenduProps) {
  // Mémorisés : de nouveaux composants à chaque rendu remonteraient tout l'arbre.
  const composants = useMemo(() => ({
    h1: creerTitre(2, idsTitres),
    h2: creerTitre(2, idsTitres),
    h3: creerTitre(3, idsTitres),
    h4: creerTitre(3, idsTitres),
    h5: creerTitre(3, idsTitres),
    h6: creerTitre(3, idsTitres),
    p: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'p'>>) => (
      <p dir="auto" className="my-3 text-sm leading-6 first:mt-0 last:mb-0">
        {children}
      </p>
    ),
    ul: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'ul'>>) => (
      <ul className="my-3 list-disc ps-6 text-sm leading-6 marker:text-muted-foreground">{children}</ul>
    ),
    ol: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'ol'>>) => (
      <ol className="my-3 list-decimal ps-6 text-sm leading-6 marker:text-muted-foreground tabular-nums">
        {children}
      </ol>
    ),
    li: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'li'>>) => (
      <li dir="auto" className="my-1">
        {children}
      </li>
    ),
    blockquote: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'blockquote'>>) => (
      <blockquote dir="auto" className="my-3 border-s-2 border-border ps-4 text-sm text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-border" />,
    a: ({ href, children }: AvecNoeud<ComponentPropsWithoutRef<'a'>>) =>
      estLienInterne(href) ? (
        <Link
          prefetch={false}
          href={href}
          className="font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </Link>
      ) : cibleAutorisee(href) ? (
        <a
          href={href}
          className="font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
    img: () => null,
    code: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'code'>>) => (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    pre: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'pre'>>) => (
      <pre
        dir="ltr"
        className="my-3 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0"
      >
        {children}
      </pre>
    ),
    table: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'table'>>) => (
      <div className="my-3 overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region">
        <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
      </div>
    ),
    thead: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'thead'>>) => (
      <thead className="bg-muted/60">{children}</thead>
    ),
    tr: ({ children }: AvecNoeud<ComponentPropsWithoutRef<'tr'>>) => (
      <tr className="border-b last:border-b-0">{children}</tr>
    ),
    th: ({ children, style }: AvecNoeud<ComponentPropsWithoutRef<'th'>>) => (
      <th scope="col" style={style} className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
        {children}
      </th>
    ),
    td: ({ children, style }: AvecNoeud<ComponentPropsWithoutRef<'td'>>) => (
      <td style={style} className="px-3 py-2 align-top">
        {children}
      </td>
    ),
  }), [idsTitres])

  return (
    <div className={cn('min-w-0 break-words', className)} data-testid="markdown-rendu">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={transformerUrl}
        components={composants}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
