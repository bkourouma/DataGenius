import type { ResultatSynchro, RetourSynchro } from '@/lib/warehouse/libelles-synchro'

/** Traducteur du namespace `sources.synchro` (côté serveur ou client). */
export type TraducteurSynchro = (cle: string, valeurs?: Record<string, string | number>) => string

/** Code d'échec de synchronisation -> clé `sources.synchro.echec.<clé>`. */
export const CLES_ECHEC_SYNCHRO: Record<string, string> = {
  source: 'source',
  schema: 'schema',
  volume: 'volume',
  plage: 'plage',
  unique: 'unique',
  non_nul: 'nonNul',
  configuration: 'configuration',
  incremental_cle: 'incrementalCle',
  incremental_date: 'incrementalDate',
  interne: 'interne',
  delai: 'delai',
  bail_perdu: 'bailPerdu',
  configuration_modifiee: 'configurationModifiee',
  enregistrement_impossible: 'enregistrementImpossible',
  backoff: 'backoff',
}

function libelleEchecTraduit(t: TraducteurSynchro, code?: string | null) {
  const cle = code && Object.hasOwn(CLES_ECHEC_SYNCHRO, code) ? CLES_ECHEC_SYNCHRO[code] : 'generique'
  return t('echec.' + cle)
}

/** Message affiché à l'administrateur après une synchronisation manuelle (version traduite de lib/warehouse/libelles-synchro). */
export function retourSynchroTraduit(t: TraducteurSynchro, { statut, code }: ResultatSynchro): RetourSynchro {
  switch (statut) {
    case 'en_cours': return { succes: t('enCours') }
    case 'publie': return { succes: t('publie') }
    case 'identique': return { succes: t('identique') }
    case 'pas_echu': return { succes: code === 'backoff' ? t('pasEchuBackoff') : t('pasEchu') }
    case 'echec': return { erreur: t('echecPrefixe', { motif: libelleEchecTraduit(t, code) }) }
    default: return { erreur: t('defaut') }
  }
}
