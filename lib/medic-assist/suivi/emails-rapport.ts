/**
 * E-mail d'un rapport programme : texte et HTML dans la langue du destinataire.
 * Tout ce qui vient de la base (noms, titre) est echappe avant d'entrer dans le
 * HTML. Meme principe que lib/services/revue-mensuelle/annonce.ts.
 */

import { getDirection, type Locale } from '@/i18n/config'
import { echapper, gabarit } from '@/lib/mail/gabarit'

import type { FormatEnvoi, FrequenceRapport } from '@/lib/medic-assist/contrats'
import { listeFormats, traducteurSuivi, urlAnalysesPartagees } from './emails'

export interface EntreeEmailRapport {
  locale: Locale
  destinataireNom: string
  proprietaireNom: string
  titreArtefact: string
  frequence: FrequenceRapport
  formats: readonly FormatEnvoi[]
  url?: string
}

export interface EmailRapport {
  sujet: string
  texte: string
  html: string
}

export async function composerEmailRapport(entree: EntreeEmailRapport): Promise<EmailRapport> {
  const { locale, destinataireNom, proprietaireNom, titreArtefact, frequence, formats } = entree
  const t = await traducteurSuivi(locale)
  const url = entree.url ?? urlAnalysesPartagees()

  const sujet = t('emailRapport.sujet', { titre: titreArtefact })
  const salutation = t('emailRapport.salutation', { nom: destinataireNom })
  const intro = t('emailRapport.intro', { proprietaire: proprietaireNom, titre: titreArtefact })
  const automatique = t('emailRapport.automatique', {
    proprietaire: proprietaireNom,
    frequence: t(`emailRapport.frequence.${frequence}`),
  })
  const fichiers = t('emailRapport.formats', { formats: listeFormats(locale, formats) })
  const note = t('emailRapport.note')
  const pied = t('emailRapport.pied')
  const lienTexte = t('emailRapport.lienTexte', { url })

  const texte = [
    salutation,
    '',
    intro,
    automatique,
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
    corps: [
      echapper(salutation),
      echapper(intro),
      echapper(automatique),
      echapper(fichiers),
      `<span style="font-size:13px;color:#64748b">${echapper(note)}</span>`,
    ],
    lien: { url, libelle: echapper(t('emailRapport.bouton')) },
    langue: locale,
    direction: getDirection(locale),
    pied: echapper(pied),
  })

  return { sujet, texte, html }
}
