/**
 * Lecture d'un jeu de données par id (GET /api/medic-assist/jeux/[id]) et recalcul pour un export.
 *
 * Cache ou rejeu. Le cache stocké est celui du PROPRIÉTAIRE, dans SON périmètre ; il n'est servi
 * que si les trois conditions suivantes sont réunies : le lecteur est le propriétaire, son
 * empreinte de périmètre est celle enregistrée au calcul, et `recalculer` est faux. Dans tous
 * les autres cas (partage, épingle d'un autre, périmètre changé, recalcul demandé) la
 * spécification est REJOUÉE avec le `scope` du lecteur. Un destinataire n'écrit jamais dans le
 * jeu d'un autre ; seul le propriétaire met à jour son cache. Une pièce jointe n'est pas
 * rejouable : elle est toujours servie depuis le cache.
 *
 * Chaque rejeu réel en base consomme un crédit de la limite de débit (voir `rejouerPourLecteur`) ;
 * une lecture servie par l'instantané, ou un jeu absent ou inaccessible, n'en consomme aucun.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import {
  LIMITES,
  type ColonneJeu,
  type ContexteExecution,
  type JeuPagineDto,
  type LigneJeu,
  type Provenance,
} from '@/lib/medic-assist/contrats'
import { chargerJeuAccessible, chargerJeuDuProprietaire, type LigneJeuStockee } from './acces-jeu'
import { CODE_LIMITE_DEBIT_DONNEES, limiteurs, minutesAvantReessai } from '../limite-debit'
import { ErreurDonnees } from '../types'
import { cacheRejeu } from './cache-rejeu'
import { empreintePerimetre } from './empreinte'
import { dateDeCalcul, preparerContenu, provenanceAStocker, type ContenuJeu } from './enregistrer'
import { provenanceVisible, totauxStockes } from './provenance'
import { estRejouable, rejouerSpec } from './rejouer'
import type { JeuCompletPourExport, OptionsLireJeu, OptionsViaArtefact } from './types'

function entierBorne(valeur: unknown, defaut: number, min: number, max: number): number {
  const n = typeof valeur === 'number' ? Math.trunc(valeur) : Number.NaN
  if (!Number.isFinite(n)) return defaut
  return Math.min(max, Math.max(min, n))
}

/** Contenu du cache d'une ligne stockée. */
function contenuDuCache(ligne: LigneJeuStockee): ContenuJeu {
  return {
    colonnes: (Array.isArray(ligne.colonnes) ? ligne.colonnes : []) as ColonneJeu[],
    lignes: (Array.isArray(ligne.lignes) ? ligne.lignes : []) as LigneJeu[],
    tronque: ligne.tronque === true,
    totaux: totauxStockes(ligne.provenance),
    provenance: {
      ...((ligne.provenance ?? {}) as Provenance),
      calculeA: ligne.calculeA.toISOString(),
    },
  }
}

/** Rejeux qui n'ont pas touché la base (rien d'exécuté) : le crédit est rendu. */
const CODES_REJEU_SANS_BASE: ReadonlySet<string> = new Set([
  'jeu_inconnu',
  'mesure_inconnue',
  'dimension_inconnue',
  'filtre_inconnu',
  'filtre_invalide',
  'periode_invalide',
  'requete_invalide',
  'sql_interdit',
  'jeu_non_rejouable',
  'role_lecture_absent',
])

/**
 * Rejoue la spécification dans le périmètre du lecteur, sous la limite de débit.
 *
 * Un crédit (`limiteurs().recalculJeu`) n'est consommé que lorsqu'une requête est RÉELLEMENT
 * rejouée en base, quel que soit le déclencheur (recalcul demandé, lecteur non propriétaire,
 * périmètre changé, export). Un rejeu déjà fait dans les 5 dernières minutes pour le même
 * lecteur, le même périmètre et le même plafond est servi par le cache mémoire, sans crédit :
 * un défilement page par page ne rejoue donc la requête qu'une fois. `forcer` (recalcul demandé
 * par l'utilisateur) ignore ce cache en lecture. Un rejeu refusé avant d'avoir touché la base
 * (spécification périmée, SQL refusé) rend son crédit.
 */
async function rejouerPourLecteur(
  ligne: LigneJeuStockee,
  contexte: ContexteExecution,
  limiteLignes: number,
  forcer = false
): Promise<ContenuJeu> {
  const cleCache = {
    userId: contexte.userId,
    jeuId: ligne.id,
    empreinte: empreintePerimetre(contexte),
    limiteLignes,
    locale: contexte.locale,
  }
  if (!forcer) {
    const enCache = cacheRejeu().lire(cleCache)
    if (enCache) return enCache
  }

  const limiteur = limiteurs().recalculJeu
  const verdict = limiteur.consommer(contexte.userId)
  if (!verdict.accepte) {
    const { max, fenetreMs } = limiteur.reglage
    throw new ErreurDonnees(
      `Limite atteinte : ${max} rejeux de jeux de données par ${Math.round(fenetreMs / 60_000)} minutes. ` +
        `Réessaie dans ${minutesAvantReessai(verdict.reessayerDansMs)} min.`,
      CODE_LIMITE_DEBIT_DONNEES,
      verdict.reessayerDansMs
    )
  }

  let calcule
  try {
    calcule = await rejouerSpec(ligne.source, ligne.requete, contexte, limiteLignes)
  } catch (e) {
    if (e instanceof ErreurDonnees && CODES_REJEU_SANS_BASE.has(e.code)) {
      limiteur.rembourser(contexte.userId)
    }
    throw e
  }
  const contenu = preparerContenu({
    source: ligne.source as 'semantique' | 'sql',
    colonnes: calcule.colonnes,
    lignes: calcule.lignes,
    tronque: calcule.tronque,
    totaux: calcule.totaux ?? (ligne.source === 'semantique' ? null : undefined),
    provenance: calcule.provenance,
    colonnesNonAdditives: calcule.colonnesNonAdditives,
    plafond: limiteLignes,
  })
  cacheRejeu().ecrire(cleCache, contenu)
  return contenu
}

/** Met à jour le cache du propriétaire (jamais celui d'un autre : `userId` dans le même WHERE). */
async function majCacheProprietaire(
  ligne: LigneJeuStockee,
  contexte: ContexteExecution,
  contenu: ContenuJeu
): Promise<void> {
  await prisma.assistantJeuDeDonnees.updateMany({
    where: { id: ligne.id, userId: contexte.userId },
    data: {
      colonnes: contenu.colonnes as unknown as Prisma.InputJsonValue,
      lignes: contenu.lignes as unknown as Prisma.InputJsonValue,
      nbLignes: contenu.lignes.length,
      tronque: contenu.tronque,
      provenance: provenanceAStocker(contenu),
      empreintePerimetre: empreintePerimetre(contexte),
      calculeA: dateDeCalcul(contenu.provenance),
    },
  })
}

/**
 * Charge la ligne : par les quatre cas d'accès, ou (via un artefact vérifié en amont) par
 * { id, propriétaire } dans le même where. Dans les deux cas, un lecteur qui n'est pas le
 * propriétaire obtient un REJEU dans son périmètre (jamais les lignes du propriétaire), sauf
 * pour une pièce jointe, indépendante du périmètre.
 */
function charger(
  id: string,
  contexte: ContexteExecution,
  options: OptionsViaArtefact
): Promise<LigneJeuStockee> {
  const via = options.viaArtefact
  return via ? chargerJeuDuProprietaire(id, via.proprietaireId) : chargerJeuAccessible(id, contexte)
}

/**
 * Lit un jeu, paginé. Lève `ErreurDonnees('introuvable')` (même message) si le jeu n'existe pas
 * ou n'est pas accessible au lecteur.
 */
export async function lireJeu(
  id: string,
  contexte: ContexteExecution,
  options: OptionsLireJeu = {}
): Promise<JeuPagineDto> {
  const ligne = await charger(id, contexte, options)

  const proprietaire = ligne.userId === contexte.userId
  const cacheValable =
    !estRejouable(ligne.source) ||
    (proprietaire &&
      ligne.empreintePerimetre === empreintePerimetre(contexte) &&
      options.recalculer !== true)

  let contenu: ContenuJeu
  let recalcule = false
  if (cacheValable) {
    contenu = contenuDuCache(ligne)
  } else {
    contenu = await rejouerPourLecteur(
      ligne,
      contexte,
      LIMITES.lignesMaxStockees,
      proprietaire && options.recalculer === true
    )
    recalcule = true
    if (proprietaire) await majCacheProprietaire(ligne, contexte, contenu)
  }

  const taille = entierBorne(
    options.taille,
    LIMITES.taillePageJeuDefaut,
    1,
    LIMITES.taillePageJeuMax
  )
  const page = entierBorne(options.page, 1, 1, 100_000)
  const debut = (page - 1) * taille

  return {
    jeuDeDonneesId: ligne.id,
    colonnes: contenu.colonnes,
    lignes: contenu.lignes.slice(debut, debut + taille),
    page,
    taille,
    total: contenu.lignes.length,
    tronque: contenu.tronque,
    ...(contenu.totaux ? { totaux: contenu.totaux } : {}),
    provenance: provenanceVisible(contenu.provenance, contexte),
    calculeA: contenu.provenance.calculeA,
    recalcule,
  }
}

/**
 * Contenu complet d'un jeu pour un export : mêmes contrôles d'accès, REJEU dans le périmètre
 * du lecteur jusqu'à LIMITES.lignesMaxExport lignes (une pièce jointe : le cache).
 */
export async function lignesCompletesPourExport(
  id: string,
  contexte: ContexteExecution,
  options: OptionsViaArtefact = {}
): Promise<JeuCompletPourExport> {
  const ligne = await charger(id, contexte, options)

  const contenu = estRejouable(ligne.source)
    ? await rejouerPourLecteur(ligne, contexte, LIMITES.lignesMaxExport)
    : contenuDuCache(ligne)

  return {
    colonnes: contenu.colonnes,
    lignes: contenu.lignes,
    ...(contenu.totaux ? { totaux: contenu.totaux } : {}),
    provenance: provenanceVisible(contenu.provenance, contexte),
  }
}
