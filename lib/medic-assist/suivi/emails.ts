/**
 * E-mail « on vous envoie une analyse » : texte et HTML dans la langue du
 * destinataire. Tout ce qui vient de la base ou du message libre est echappe
 * avant d'entrer dans le HTML.
 */

import { createTranslator } from 'next-intl'

import { getDirection, toIntlTag, type Locale } from '@/i18n/config'
import { loadMessages } from '@/i18n/messages'
import { echapper, gabarit, urlApplication } from '@/lib/mail/gabarit'

import type { FormatEnvoi } from '@/lib/medic-assist/contrats'

export type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

/** Traducteur du namespace medicAssistSuivi (non encore type : lot 0 non fusionne). */
export async function traducteurSuivi(locale: Locale): Promise<Traducteur> {
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: 'medicAssistSuivi' as never,
  }) as unknown as Traducteur
  return t
}

/** Noms techniques des formats joints (identiques dans toutes les langues). */
export const LIBELLES_FORMATS: Record<FormatEnvoi, string> = {
  xlsx: 'Excel (.xlsx)',
  pdf: 'PDF',
  csv: 'CSV',
}

export function listeFormats(locale: Locale, formats: readonly FormatEnvoi[]): string {
  return new Intl.ListFormat(toIntlTag(locale), { type: 'conjunction' }).format(
    formats.map((f) => LIBELLES_FORMATS[f])
  )
}

export interface EntreeEmailArtefact {
  locale: Locale
  destinataireNom: string
  expediteurNom: string
  titreArtefact: string
  message?: string
  formats: readonly FormatEnvoi[]
  url?: string
}

export interface EmailArtefact {
  sujet: string
  texte: string
  html: string
}

/** Lien de l'e-mail : l'onglet « partages » de Mes analyses. */
export function urlAnalysesPartagees(): string {
  return `${urlApplication()}/medic-assist/analyses?onglet=partages`
}

export async function composerEmailArtefact(entree: EntreeEmailArtefact): Promise<EmailArtefact> {
  const { locale, destinataireNom, expediteurNom, titreArtefact, formats } = entree
  const t = await traducteurSuivi(locale)
  const url = entree.url ?? urlAnalysesPartagees()
  const message = entree.message?.trim() || undefined

  const sujet = t('emailArtefact.sujet', { expediteur: expediteurNom, titre: titreArtefact })
  const salutation = t('emailArtefact.salutation', { nom: destinataireNom })
  const intro = t('emailArtefact.intro', { expediteur: expediteurNom, titre: titreArtefact })
  const messageDe = t('emailArtefact.messageDe', { expediteur: expediteurNom })
  const fichiers = t('emailArtefact.formats', { formats: listeFormats(locale, formats) })
  const note = t('emailArtefact.note')
  const pied = t('emailArtefact.pied')
  const lienTexte = t('emailArtefact.lienTexte', { url })

  const corps = [echapper(salutation), echapper(intro)]
  if (message) {
    corps.push(
      `${echapper(messageDe)}<br>${echapper(message).replace(/\r?\n/g, '<br>')}`
    )
  }
  corps.push(echapper(fichiers))
  corps.push(`<span style="font-size:13px;color:#64748b">${echapper(note)}</span>`)

  const texte = [
    salutation,
    '',
    intro,
    ...(message ? ['', messageDe, message] : []),
    '',
    fichiers,
    note,
    '',
    lienTexte,
    '',
    pied,
  ].join('\n')

  const html = gabarit({
    titre: echapper(sujet),
    corps,
    lien: { url, libelle: echapper(t('emailArtefact.bouton')) },
    langue: locale,
    direction: getDirection(locale),
    pied: echapper(pied),
  })

  return { sujet, texte, html }
}
