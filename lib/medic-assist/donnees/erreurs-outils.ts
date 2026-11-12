/**
 * Traduction des erreurs de la couche de données vers les codes d'erreur d'outil du contrat
 * (`CodeErreurOutil`), renvoyés au modèle pour qu'il corrige sa demande.
 *
 * CODES STABLES de `ErreurDonnees` (l'interface traduit par code ; `message` n'aide que le modèle) :
 *   jeu_inconnu, mesure_inconnue, dimension_inconnue, filtre_inconnu, filtre_invalide,
 *   periode_invalide, requete_invalide (spécification ou pièce jointe mal formée),
 *   jeu_non_rejouable (source sans rejeu possible), sql_interdit, sql_erreur, sql_delai,
 *   introuvable (jeu absent OU inaccessible, message identique), acces_refuse,
 *   role_lecture_absent (role PostgreSQL medic_assist_lecture absent : configuration serveur),
 *   limite_debit_donnees (trop de requêtes rejouées en base par cet utilisateur).
 * Correspondance avec `CodeErreurOutil` : table CODES ci-dessous.
 *
 * Seule une `ErreurDonnees` est écrite pour le modèle (message court, sans schéma ni
 * identifiant technique). Toute autre erreur devient `interne` avec un message NEUTRE ; la
 * journalisation serveur ne garde ni message ni valeur (ils pourraient contenir des données) :
 * seulement le type d'erreur et son code technique.
 */

import type { CodeErreurOutil, ErreurOutil } from '@/lib/medic-assist/contrats'
import { ErreurDonnees } from './types'

const CODES: Record<ErreurDonnees['code'], CodeErreurOutil> = {
  jeu_inconnu: 'jeu_inconnu',
  mesure_inconnue: 'mesure_inconnue',
  dimension_inconnue: 'mesure_inconnue',
  filtre_inconnu: 'filtre_inconnu',
  filtre_invalide: 'filtre_inconnu',
  periode_invalide: 'entree_invalide',
  requete_invalide: 'entree_invalide',
  sql_interdit: 'sql_refuse',
  sql_erreur: 'sql_erreur',
  sql_delai: 'delai_depasse',
  jeu_non_rejouable: 'entree_invalide',
  introuvable: 'introuvable',
  acces_refuse: 'acces_refuse',
  // Role de lecture absent (migration non appliquee) : defaut du serveur, rien a corriger cote modele.
  role_lecture_absent: 'interne',
  // Trop de rejeux en base pour cet utilisateur : le modèle doit patienter ou changer de voie.
  limite_debit_donnees: 'limite_debit_donnees',
}

export const MESSAGE_ERREUR_INTERNE =
  'Une erreur interne est survenue. Réessaie, ou reformule la demande.'

/** Erreur d'outil du contrat pour n'importe quelle erreur levée par la couche de données. */
export function versErreurOutil(e: unknown): ErreurOutil {
  if (e instanceof ErreurDonnees) {
    return { erreur: { code: CODES[e.code] ?? 'interne', message: e.message } }
  }
  const nom = e instanceof Error ? e.name : typeof e
  const code = (e as { code?: unknown } | null)?.code
  console.error(
    '[medic-assist] erreur interne d’outil :',
    nom,
    typeof code === 'string' ? code : ''
  )
  return { erreur: { code: 'interne', message: MESSAGE_ERREUR_INTERNE } }
}
