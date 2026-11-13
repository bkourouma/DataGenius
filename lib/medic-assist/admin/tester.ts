/**
 * Test d'un modele depuis l'administration : un appel MINIMAL (prompt d'un mot, 16 jetons
 * au plus, 20 s), latence mesuree, AUCUNE ecriture d'usage. L'erreur du fournisseur est
 * reduite a un CODE stable (`CodeErreurTest`) traduit cote interface : jamais la cle, jamais
 * le corps ni le message de la reponse.
 */

import { decrireErreurPourJournal, estErreurCertificat, lireCodeReseauCause } from '../agent/erreurs'
import { chargerSdkIa, type SdkIa } from '../transcription/sdk-ia'
import { creerModele, type Fournisseur } from './dependances'
import type { CodeErreurTest } from './types'

export const DELAI_TEST_MS = 20_000
export const PROMPT_TEST = 'Reply with one word: ok'

export interface DependancesTest {
  sdk?: () => Promise<SdkIa>
  delaiMs?: number
  maintenant?: () => number
}

export interface ResultatTest {
  ok: boolean
  latenceMs: number
  erreurCode?: CodeErreurTest
}

/** Code stable pour une erreur du SDK ou du fournisseur (aucun texte de l'erreur n'en sort). */
export function codeErreurTest(erreur: unknown): CodeErreurTest {
  const e = erreur as { name?: unknown; statusCode?: unknown; status?: unknown } | null
  const statut =
    typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : 0
  const nom = typeof e?.name === 'string' ? e.name : ''
  // Aucune réponse HTTP : coupure, refus de connexion ou résolution DNS en échec.
  if (estErreurCertificat(erreur)) return 'certificat'
  const sansReponse =
    statut === 0 && (/APICallError/.test(nom) || lireCodeReseauCause(erreur) !== '')
  if (nom === 'AbortError' || nom === 'TimeoutError') return 'delai'
  if (sansReponse) return 'reseau'
  if (statut === 401 || statut === 403 || /LoadAPIKey/i.test(nom) || nom === 'ErreurFournisseurAbsent') return 'clefRefusee'
  if (statut === 404) return 'modeleIntrouvable'
  if (statut === 429) return 'limite'
  if (statut >= 500) return 'indisponible'
  return 'inconnue'
}

export async function testerModele(
  fournisseur: Fournisseur,
  modele: string,
  deps: DependancesTest = {}
): Promise<ResultatTest> {
  const maintenant = deps.maintenant ?? Date.now
  const debut = maintenant()
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), deps.delaiMs ?? DELAI_TEST_MS)
  try {
    const sdk = await (deps.sdk ?? chargerSdkIa)()
    await sdk.generateText({
      model: creerModele(fournisseur, modele),
      prompt: PROMPT_TEST,
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: controleur.signal,
    })
    return { ok: true, latenceMs: Math.max(0, maintenant() - debut) }
  } catch (erreur) {
    console.error(
      `[medic-assist] test de modele en echec fournisseur=${fournisseur} ${decrireErreurPourJournal(erreur)}`
    )
    return {
      ok: false,
      latenceMs: Math.max(0, maintenant() - debut),
      erreurCode: codeErreurTest(erreur),
    }
  } finally {
    clearTimeout(minuteur)
  }
}
