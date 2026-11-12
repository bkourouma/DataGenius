/**
 * Moteur semantique : valide une `RequeteSemantique`, construit son SQL a partir du
 * catalogue, l'execute en lecture seule (READ ONLY, 15 s) et assemble lignes, totaux et
 * provenance.
 *
 * Le perimetre du lecteur est applique DANS la vue (`vue.cte(ctx)`), nulle part ailleurs.
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import type { RequeteSemantique } from '@/lib/medic-assist/donnees/requete-interne'
import { empreinteEntrees, registrePostgres } from '../catalogue/registre'
import type { Registre } from '../catalogue/types'
import { validerRequete } from '../catalogue/validation'
import { lireEntrepot, normaliserLigne, reglesPublication } from '../lecture-seule'
import { extraireErreurPostgres } from '../sql/erreurs'
import { ErreurDonnees, type OptionsCalcul, type ResultatCalcule } from '../types'
import { construireSql } from './construire'
import { construireProvenance, trimestreGeneriqueRendu } from './provenance'
import { trierLignes } from './tri'

export { trierLignes }

/** Traduit une erreur d'execution en message court pour le modele, sans detail de schema. */
function erreurExecution(erreur: unknown, jeu: string): ErreurDonnees {
  // Deja destinee au modele (role de lecture absent...) : transmise telle quelle.
  if (erreur instanceof ErreurDonnees) return erreur
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  const code = (erreur as { code?: unknown } | null)?.code
  if (/statement timeout|57014/i.test(message) || code === 'P2028') {
    return new ErreurDonnees(
      'Le calcul a dépassé le délai de 15 s : réduisez la période, les dimensions ou les filtres.',
      'sql_delai'
    )
  }
  // Les expressions viennent du catalogue : une erreur ici est un defaut du catalogue, a
  // corriger cote serveur. Le journal ne garde que le nom de l'erreur et son code SQLSTATE
  // (jamais le message ni l'objet, qui peuvent citer des donnees) ; le modele recoit un
  // message neutre.
  const { sqlstate, codePrisma } = extraireErreurPostgres(erreur)
  console.error(
    `[medic-assist] calcul semantique du jeu ${jeu} en echec :`,
    erreur instanceof Error ? erreur.name : typeof erreur,
    sqlstate ?? codePrisma ?? ''
  )
  return new ErreurDonnees(
    `Le calcul du jeu ${jeu} a échoué. Essayez d'autres mesures ou dimensions, ou requete_sql.`,
    'sql_erreur'
  )
}

/**
 * Calcule une requete semantique pour le lecteur `ctx`. Leve `ErreurDonnees` (message
 * exploitable par le modele) si la requete est invalide ou si le calcul echoue.
 */
export async function calculerSemantique(
  requete: RequeteSemantique,
  ctx: ContexteExecution,
  options: OptionsCalcul = {},
  registre?: Registre
): Promise<ResultatCalcule> {
  const { entree, normalisee } = validerRequete(requete, ctx, registre ?? await registrePostgres())
  const construit = construireSql(normalisee, entree, ctx, { limiteLignes: options.limiteLignes })

  let lecture: Awaited<ReturnType<typeof lireEntrepot>>
  try {
    const requetes = [construit.principal, ...(construit.totaux ? [construit.totaux] : [])]
    lecture = await lireEntrepot(requetes, [entree.vue])
  } catch (erreur) {
    throw erreurExecution(erreur, entree.jeu.cle)
  }
  const [principal, total] = lecture.resultats
  let lignes = principal.map(normaliserLigne)
  const tronque = construit.dimensions.length > 0 && lignes.length > construit.limite
  if (tronque) lignes = lignes.slice(0, construit.limite)
  lignes = trierLignes(lignes, construit.tri, ctx.locale)

  let totaux: Record<string, number> | undefined
  if (construit.mesuresTotalisees.length > 0) {
    // Sans dimension, la ligne unique est deja le total : pas de seconde requete.
    const ligneTotaux = construit.totaux
      ? (total?.[0] ? normaliserLigne(total[0]) : {})
      : (lignes[0] ?? {})
    totaux = {}
    for (const cle of construit.mesuresTotalisees) {
      const valeur = ligneTotaux[cle]
      // Un total NULL (taux sans denominateur, aucune ligne) n'est pas un zero : on l'omet.
      if (typeof valeur === 'number' && Number.isFinite(valeur)) totaux[cle] = valeur
    }
  }

  const provenance = await construireProvenance({
    entree,
    normalisee,
    ctx,
    tronque,
    avecTotaux: totaux !== undefined && construit.dimensions.length > 0,
    trimestreCivil: trimestreGeneriqueRendu(construit.dimensions),
  })

  provenance.regles.push(...reglesPublication([entree.vue], lecture.publications))

  // Classement par valeur : tri explicite ou limite, et premiere cle = une mesure. Sans cela
  // (ordre par defaut, dimensions), l'affichage garde sa regle de tri par libelle.
  const classement =
    (normalisee.tri?.length ?? 0) > 0 || normalisee.limite !== undefined
      ? construit.mesures.some(m => m.cle === construit.tri[0]?.cle)
      : false
  // Borne du contrat (`ordre` : au plus 10). Le tri effectif ajoute les dimensions restantes
  // au tri demande : il peut donc depasser 10 entrees.
  const ordre = classement
    ? construit.tri.map(({ cle, sens }) => ({ cle, sens })).slice(0, 10)
    : undefined

  return {
    empreinteSource: empreinteEntrees([entree]),
    colonnes: construit.colonnes,
    lignes,
    tronque,
    ...(totaux ? { totaux } : {}),
    provenance: ordre ? { ...provenance, ordre } : provenance,
  }
}
