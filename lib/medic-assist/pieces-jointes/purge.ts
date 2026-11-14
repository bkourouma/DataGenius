/**
 * Purge des pieces jointes de Medic Assist (tache planifiee).
 *
 * (a) Pieces NON rattachees (conversationId nul) creees il y a plus de 24 h : ligne ET fichier.
 * (b) Fichiers orphelins du dossier dedie dont aucune ligne n'existe plus. Choix retenu : quand
 *     un utilisateur est supprime, ses lignes partent en cascade et ses fichiers restent sur
 *     disque ; ils sont purges ici, au balayage, sans hook de suppression d'utilisateur.
 *
 * Garde-fous : on ne sort jamais du dossier dedie (cheminStocke), les noms qui ne sont pas des
 * noms stockes valides sont ignores, un fichier de moins d'1 h n'est jamais supprime (envoi en
 * cours : fichier ecrit, ligne pas encore creee), et une erreur sur un fichier n'interrompt pas
 * la purge. Les journaux ne contiennent ni nom de fichier ni chemin.
 */

import { readdir, stat, unlink } from 'fs/promises'

import { depotPrisma, type DepotPiecesJointes } from './depot-prisma'
import { cheminStocke, dossierPiecesJointes } from './stockage'

/** Age au-dela duquel une piece non rattachee est purgee. */
export const AGE_MAX_NON_RATTACHEE_MS = 24 * 60 * 60 * 1000
/** Age minimal d'un fichier sans ligne avant suppression. */
export const AGE_MIN_ORPHELIN_MS = 60 * 60 * 1000

const TAILLE_LOT = 200

export interface DependancesPurge {
  depot?: Pick<DepotPiecesJointes, 'listerNonRattacheesAvant' | 'cheminsExistants' | 'supprimerNonRattacheesParIds'>
  /** Suppression d'un fichier par chemin absolu (remplacable dans les tests). */
  supprimerFichier?: (chemin: string) => Promise<void>
}

function codeErreur(erreur: unknown): string {
  const code = (erreur as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'inconnu'
}

export async function purgerPiecesJointes(
  options: { maintenant?: Date; deps?: DependancesPurge } = {}
): Promise<{ lignesSupprimees: number; fichiersSupprimes: number }> {
  const maintenant = options.maintenant ?? new Date()
  const depot = options.deps?.depot ?? depotPrisma
  const supprimerFichier = options.deps?.supprimerFichier ?? ((chemin: string) => unlink(chemin))

  let lignesSupprimees = 0
  let fichiersSupprimes = 0
  let erreurs = 0

  /** Supprime un fichier stocke ; true s'il a ete supprime. Ne leve jamais. */
  async function retirer(nom: string): Promise<boolean> {
    const chemin = cheminStocke(nom)
    if (!chemin) return false
    try {
      await supprimerFichier(chemin)
      return true
    } catch (erreur) {
      if (codeErreur(erreur) !== 'ENOENT') {
        erreurs++
        console.error('[datagenius] pieces-jointes', { code: codeErreur(erreur) })
      }
      return false
    }
  }

  // (a) Pieces non rattachees de plus de 24 h.
  const limiteA = new Date(maintenant.getTime() - AGE_MAX_NON_RATTACHEE_MS)
  try {
    for (;;) {
      const lot = await depot.listerNonRattacheesAvant(limiteA, TAILLE_LOT)
      if (lot.length === 0) break
      // La ligne d'abord, avec le filtre « toujours non rattachee » : une piece rattachee entre
      // la lecture du lot et ici garde sa ligne ET son fichier. Le fichier n'est retire que pour
      // les lignes reellement supprimees (s'il echoue, le balayage (b) le reprendra).
      const supprimees = new Set(await depot.supprimerNonRattacheesParIds(lot.map(l => l.id)))
      lignesSupprimees += supprimees.size
      for (const ligne of lot) {
        if (supprimees.has(ligne.id) && (await retirer(ligne.chemin))) fichiersSupprimes++
      }
      // Lot entier conserve (tout rattache entre-temps) : rien n'avance, on sort pour ne pas boucler.
      if (supprimees.size === 0) break
      if (lot.length < TAILLE_LOT) break
    }
  } catch (erreur) {
    erreurs++
    console.error('[datagenius] pieces-jointes', { code: codeErreur(erreur) })
  }

  // (b) Fichiers du dossier dedie sans ligne en base.
  try {
    let noms: string[] = []
    try {
      noms = await readdir(dossierPiecesJointes())
    } catch (erreur) {
      if (codeErreur(erreur) !== 'ENOENT') throw erreur
    }
    const seuil = maintenant.getTime() - AGE_MIN_ORPHELIN_MS
    for (let i = 0; i < noms.length; i += TAILLE_LOT) {
      const candidats: string[] = []
      for (const nom of noms.slice(i, i + TAILLE_LOT)) {
        const chemin = cheminStocke(nom)
        if (!chemin) continue
        try {
          const infos = await stat(chemin)
          if (infos.isFile() && infos.mtimeMs < seuil) candidats.push(nom)
        } catch (erreur) {
          if (codeErreur(erreur) !== 'ENOENT') {
            erreurs++
            console.error('[datagenius] pieces-jointes', { code: codeErreur(erreur) })
          }
        }
      }
      if (candidats.length === 0) continue
      const existants = await depot.cheminsExistants(candidats)
      for (const nom of candidats) {
        if (existants.has(nom)) continue
        if (await retirer(nom)) fichiersSupprimes++
      }
    }
  } catch (erreur) {
    erreurs++
    console.error('[datagenius] pieces-jointes', { code: codeErreur(erreur) })
  }

  console.info('[datagenius] pieces-jointes', { lignesSupprimees, fichiersSupprimes, erreurs })
  return { lignesSupprimees, fichiersSupprimes }
}
