'use client'

import { ChevronDown, Copy } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { Provenance } from '@/lib/medic-assist/contrats'
import { cn } from '@/lib/utils'

export interface VoletProvenanceProps {
  provenance: Provenance
  /** Vrai pour SuperAdmin et TenantAdmin : seuls à voir la requête SQL. */
  estAdmin: boolean
  /** Section dépliée à l'ouverture (repliée par défaut). */
  ouvertParDefaut?: boolean
  className?: string
}

/**
 * Lien interne seulement : un seul `/` au début (ni `//`, ni `/\`), jamais l'API.
 * Tout le reste (URL absolue, `javascript:`, chemin relatif) est ignoré.
 */
export function estLienInterne(href: unknown): href is string {
  if (typeof href !== 'string') return false
  if (!href.startsWith('/') || href.startsWith('//')) return false
  if (href.startsWith('/api')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(href)) return false
  return true
}

function Ligne({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs font-semibold text-muted-foreground">{titre}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * Volet « Comment j'ai calculé » : d'où viennent les chiffres, sur quelle période et quel
 * périmètre, avec quels filtres et quelles règles. Ne lit que les champs de `Provenance`
 * ci-dessous ; le texte de la requête n'est jamais interprété comme du HTML.
 */
export function VoletProvenance({
  provenance,
  estAdmin,
  ouvertParDefaut = false,
  className,
}: VoletProvenanceProps) {
  const t = useTranslations('medicAssistArtefacts')
  const format = useFormatter()
  const { toast } = useToast()
  const [ouvert, setOuvert] = useState(ouvertParDefaut)
  const idContenu = useId()

  const date = new Date(provenance.calculeA)
  const calculeLe = Number.isNaN(date.getTime())
    ? null
    : format.dateTime(date, { dateStyle: 'long', timeStyle: 'short' })
  const lien =
    provenance.lienEcran && estLienInterne(provenance.lienEcran.href) ? provenance.lienEcran : null
  const sql = estAdmin && provenance.sql ? provenance.sql : null

  const copierSql = async () => {
    try {
      await navigator.clipboard.writeText(sql ?? '')
      toast({ title: t('provenance.sqlCopiee') })
    } catch {
      toast({ variant: 'destructive', title: t('provenance.copieEchec') })
    }
  }

  return (
    <section className={cn('rounded-lg border border-border bg-card shadow-sm', className)}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={ouvert}
          aria-controls={idContenu}
          onClick={() => setOuvert(v => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-start text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [@media(pointer:coarse)]:min-h-11"
        >
          {t('provenance.titre')}
          <ChevronDown
            aria-hidden
            className={cn('size-4 shrink-0 transition-transform', ouvert && 'rotate-180')}
          />
        </button>
      </h3>
      <div id={idContenu} hidden={!ouvert} className="border-t border-border px-4 py-3">
        {ouvert ? (
          <dl className="grid gap-3">
            <Ligne titre={t('provenance.source')}>{provenance.libelleSource}</Ligne>
            {provenance.periode ? (
              <Ligne titre={t('provenance.periode')}>{provenance.periode.libelle}</Ligne>
            ) : null}
            <Ligne titre={t('provenance.perimetre')}>{provenance.perimetre.libelle}</Ligne>
            <Ligne titre={t('provenance.filtres')}>
              {provenance.filtres.length > 0 ? (
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {provenance.filtres.map((f, i) => (
                    <li key={`${f.libelle}-${i}`}>
                      {t('provenance.filtre', { libelle: f.libelle, valeur: f.valeur })}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">{t('provenance.aucunFiltre')}</span>
              )}
            </Ligne>
            {provenance.regles.length > 0 ? (
              <Ligne titre={t('provenance.regles')}>
                <ul className="m-0 list-disc space-y-0.5 ps-5">
                  {provenance.regles.map((regle, i) => (
                    <li key={`${i}-${regle}`}>{regle}</li>
                  ))}
                </ul>
              </Ligne>
            ) : null}
            {lien ? (
              <Ligne titre={t('provenance.lienEcran')}>
                <Link href={lien.href} prefetch={false} className="text-primary underline-offset-4 hover:underline">
                  {lien.libelle}
                </Link>
              </Ligne>
            ) : null}
            {sql ? (
              <Ligne titre={t('provenance.sql')}>
                <div className="space-y-2">
                  <pre
                    dir="ltr"
                    tabIndex={0}
                    className="m-0 max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs"
                  >
                    <code>{sql}</code>
                  </pre>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copierSql()}>
                    <Copy aria-hidden />
                    {t('provenance.copierSql')}
                  </Button>
                </div>
              </Ligne>
            ) : null}
          </dl>
        ) : null}
        {ouvert && calculeLe ? (
          <p className="mb-0 mt-3 text-xs text-muted-foreground">
            {t('provenance.calculeLe', { date: calculeLe })}
          </p>
        ) : null}
      </div>
    </section>
  )
}
