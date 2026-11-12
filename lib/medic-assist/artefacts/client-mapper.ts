/**
 * Passage de la forme HTTP réelle (`ArtefactReponse` = `ArtefactDto` du contrat + `donnees`
 * + `artefactsLies`) à la forme consommée par les composants (`ArtefactClient`), et des
 * résumés de `GET /api/medic-assist/artefacts?conversationId=` (`ArtefactResumeReponse`) à
 * ceux des onglets du panneau.
 *
 * Fonctions pures : importables côté client comme côté serveur.
 */

import type { JeuLieDto } from '@/lib/medic-assist/contrats'

import type {
  ArtefactReponse,
  ArtefactResumeReponse,
  DonneesJeuReponse,
  JeuLimiteReponse,
} from './reponse'
import type { ArtefactClient, JeuClient } from './types-rendu'

/** Résumé d'un artefact pour les onglets du panneau (dernière version de chaque artefact). */
export interface ResumeArtefactClient {
  id: string
  racineId: string
  version: number
  type: ArtefactResumeReponse['type']
  titre: string
  sousTitre?: string
  /** ISO 8601 : date de la dernière version. */
  majA: string
}

export interface OptionsMapper {
  /**
   * Racine connue par l'appelant (ex. celle de la version précédente après un PATCH) : sert
   * quand la réponse n'en porte pas. Le DTO du contrat n'a pas de `racineId` ; une
   * `ArtefactReponse` qui en porte un (champ optionnel) a toujours la priorité.
   */
  racineId?: string
}

/** Lecture tolérante du `racineId` facultatif d'une réponse (absent du DTO du contrat). */
function racineDeReponse(reponse: ArtefactReponse): string | undefined {
  const racine = (reponse as { racineId?: unknown }).racineId
  return typeof racine === 'string' && racine.length > 0 ? racine : undefined
}

function jeuVersClient(
  jeu: JeuLieDto,
  donnees: DonneesJeuReponse | undefined,
  limite?: JeuLimiteReponse
): JeuClient {
  return {
    jeuDeDonneesId: jeu.jeuDeDonneesId,
    colonnes: jeu.colonnes,
    lignes: donnees?.lignes ?? [],
    nbLignes: jeu.nbLignes,
    tronque: jeu.tronque,
    ...(donnees?.totaux ? { totaux: donnees.totaux } : {}),
    provenance: jeu.provenance,
    ...(!donnees && limite ? { limiteDebit: { reessayerDansSecondes: limite.reessayerDansSecondes } } : {}),
  }
}

function sousTitreDe(spec: ArtefactReponse['spec']): string | undefined {
  const sousTitre = (spec as { sousTitre?: unknown }).sousTitre
  return typeof sousTitre === 'string' && sousTitre.trim() !== '' ? sousTitre : undefined
}

function convertir(
  reponse: ArtefactReponse,
  options: OptionsMapper,
  profondeur: number
): ArtefactClient {
  const jeux: Record<string, JeuClient> = {}
  for (const jeu of reponse.jeux) {
    jeux[jeu.jeuDeDonneesId] = jeuVersClient(
      jeu,
      reponse.donnees?.[jeu.jeuDeDonneesId],
      reponse.jeuxLimites?.[jeu.jeuDeDonneesId]
    )
  }

  let artefactsLies: Record<string, ArtefactClient> | undefined
  if (profondeur < 1 && reponse.artefactsLies) {
    artefactsLies = {}
    for (const [id, lie] of Object.entries(reponse.artefactsLies)) {
      artefactsLies[id] = convertir(lie, {}, profondeur + 1)
    }
  }

  const sousTitre = sousTitreDe(reponse.spec)
  return {
    id: reponse.id,
    racineId: racineDeReponse(reponse) ?? options.racineId ?? reponse.id,
    version: reponse.version,
    versions: reponse.versions.map(v => ({ version: v.version, creeLe: v.creeA })),
    type: reponse.type,
    titre: reponse.titre,
    ...(sousTitre ? { sousTitre } : {}),
    spec: reponse.spec,
    jeux,
    ...(artefactsLies ? { artefactsLies } : {}),
    conversationId: reponse.conversationId ?? null,
    creeLe: reponse.creeA,
    modifiable: reponse.droits.modification,
  }
}

/**
 * `ArtefactReponse` → `ArtefactClient`. Les artefacts liés (blocs `artefact` d'un document)
 * sont convertis sur UN niveau ; leurs propres liés sont ignorés.
 */
export function reponseVersClient(
  reponse: ArtefactReponse,
  options: OptionsMapper = {}
): ArtefactClient {
  return convertir(reponse, options, 0)
}

/** Élément de `GET /api/medic-assist/artefacts?conversationId=` → onglet du panneau. */
export function resumeVersClient(resume: ArtefactResumeReponse): ResumeArtefactClient {
  return {
    id: resume.id,
    racineId: resume.racineId,
    version: resume.version,
    type: resume.type,
    titre: resume.titre,
    ...(resume.sousTitre ? { sousTitre: resume.sousTitre } : {}),
    majA: resume.majA,
  }
}
