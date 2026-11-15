export type ResultatSynchro = { statut: string; code?: string | null }
export type RetourSynchro = { erreur?: string; succes?: string }

const LIBELLES_ECHEC: Record<string, string> = {
  source: 'la source est injoignable ou a refusé la lecture.',
  schema: 'la table ou les colonnes sont introuvables dans la source.',
  volume: 'la source dépasse le volume maximal importable.',
  plage: 'des valeurs sont hors des limites autorisées.',
  unique: 'une règle d’unicité de la qualité des données n’est pas respectée.',
  non_nul: 'une règle de valeurs obligatoires de la qualité des données n’est pas respectée.',
  configuration: 'la configuration de l’import ou de sa qualité est invalide.',
  incremental_cle: 'la clé de l’import incrémental est invalide ou introuvable dans la source.',
  incremental_date: 'la colonne de date de l’import incrémental est invalide ou introuvable dans la source.',
  interne: 'erreur interne de Data Genius. Réessayez ou contactez un administrateur.',
  delai: 'la source a mis trop de temps à répondre.',
  bail_perdu: 'la synchronisation a été interrompue par un autre traitement. Réessayez.',
  configuration_modifiee: 'la configuration de l’import a changé pendant la synchronisation. Relancez-la.',
  enregistrement_impossible: 'les données lues n’ont pas pu être enregistrées. Réessayez.',
  backoff: 'des échecs répétés ont suspendu la synchronisation. Une nouvelle tentative aura lieu automatiquement.',
}

export const LIBELLE_ECHEC_GENERIQUE = 'la synchronisation a échoué. Réessayez plus tard.'

export function libelleEchec(code?: string | null) {
  return code && Object.hasOwn(LIBELLES_ECHEC, code) ? LIBELLES_ECHEC[code] : LIBELLE_ECHEC_GENERIQUE
}

/** Message affiché à l'administrateur après une synchronisation manuelle. */
export function retourSynchro({ statut, code }: ResultatSynchro): RetourSynchro {
  switch (statut) {
    case 'en_cours': return { succes: 'Synchronisation déjà en cours.' }
    case 'publie': return { succes: 'Données publiées.' }
    case 'identique': return { succes: 'Aucun changement : les données sont identiques.' }
    case 'pas_echu': return { succes: code === 'backoff' ? 'Nouvel essai automatique prévu après plusieurs échecs.' : 'Aucune synchronisation nécessaire pour l’instant.' }
    case 'echec': return { erreur: 'Échec : ' + libelleEchec(code) }
    default: return { erreur: 'Synchronisation impossible. Réessayez dans un instant.' }
  }
}
