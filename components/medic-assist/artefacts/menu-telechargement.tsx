'use client'

import { ChevronDown, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import type { TypeArtefact } from '@/lib/medic-assist/contrats'
import type { FormatExport } from '@/lib/medic-assist/artefacts/exports/types'
import {
  ErreurTelechargement,
  telechargerDepuisUrl,
  urlExport,
  type CodeErreurTelechargement,
} from '@/lib/medic-assist/artefacts/telecharger'

type FormatMenu = FormatExport | 'png'

interface MenuTelechargementProps {
  artefactId: string
  titre: string
  type: TypeArtefact
  /** Version AFFICHÉE de l'artefact : l'export porte sur elle (`?version=n`). */
  version?: number
  /**
   * Présent seulement quand une image du graphique affiché peut être créée (côté navigateur,
   * via le rendu). Sans lui, l'entrée PNG n'apparaît pas.
   */
  onTelechargerPng?: (nomBase: string) => Promise<void>
}

const CLE_ERREUR: Record<CodeErreurTelechargement | 'png', string> = {
  reseau: 'reseau',
  refuse: 'refuse',
  introuvable: 'introuvable',
  format: 'format',
  trop_de_lignes: 'tropDeLignes',
  echec: 'echec',
  png: 'png',
}

/** Nom de fichier lisible : retire les caractères interdits sous Windows. */
export function nomBaseFichier(titre: string): string {
  // eslint-disable-next-line no-control-regex
  const propre = titre.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return propre.slice(0, 80).trim() || 'Data Genius'
}

/**
 * Menu « Télécharger ». Les formats viennent du serveur (le serveur refuse ceux qui ne
 * conviennent pas à l'artefact) ; seuls sont masqués le CSV d'un document (sans table) et
 * le PNG hors graphique. Le bouton est désactivé et occupé pendant le téléchargement.
 */
export function MenuTelechargement({
  artefactId,
  titre,
  type,
  version,
  onTelechargerPng,
}: MenuTelechargementProps) {
  const t = useTranslations('medicAssistArtefacts')
  const { toast } = useToast()
  const [enCours, setEnCours] = useState<FormatMenu | null>(null)
  const monte = useRef(true)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  const formats: FormatMenu[] = (['xlsx', 'csv', 'pdf', 'png', 'pptx'] as const).filter(f => {
    if (f === 'csv') return type !== 'document'
    if (f === 'png') return Boolean(onTelechargerPng)
    return true
  })

  const telecharger = async (format: FormatMenu) => {
    if (enCours) return
    setEnCours(format)
    const nomBase = nomBaseFichier(titre)
    try {
      if (format === 'png') {
        if (!onTelechargerPng) throw new ErreurTelechargement('echec')
        try {
          await onTelechargerPng(nomBase)
        } catch {
          throw Object.assign(new Error('png'), { codePng: true })
        }
      } else {
        await telechargerDepuisUrl(urlExport(artefactId, format, version), `${nomBase}.${format}`)
      }
      toast({ title: t('telechargement.reussi', { format: t(`telechargement.formats.${format}` as never) }) })
    } catch (e) {
      const code: CodeErreurTelechargement | 'png' =
        e instanceof ErreurTelechargement ? e.code : (e as { codePng?: boolean }).codePng ? 'png' : 'echec'
      toast({
        variant: 'destructive',
        title: t('telechargement.echec'),
        description: t(`erreurs.telechargement.${CLE_ERREUR[code]}` as never),
      })
    } finally {
      if (monte.current) setEnCours(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cible-tactile" loading={enCours !== null}>
          {enCours === null ? <Download aria-hidden /> : null}
          {enCours === null ? t('telechargement.bouton') : t('telechargement.enCours')}
          <ChevronDown aria-hidden className="ms-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={t('telechargement.menu')}>
        {formats.map(format => (
          <DropdownMenuItem key={format} onSelect={() => void telecharger(format)}>
            {t(`telechargement.formats.${format}` as never)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
