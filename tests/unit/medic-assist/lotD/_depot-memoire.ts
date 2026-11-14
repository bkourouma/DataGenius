/**
 * Depot de suivi EN MEMOIRE pour les tests de reprise des rapports programmes (lot D).
 *
 * N'implemente que ce que traiterRapportsEchus utilise (rapports, artefact visible,
 * administrateurs). Les autres methodes de DepotSuivi levent 'non implemente' : le
 * cast final vers DepotSuivi est volontaire et limite a ce fichier.
 * Les methodes sont synchrones sous le capot (pas d'await entre lecture et ecriture) :
 * le compare-and-set est donc atomique, comme l'updateMany de Postgres.
 */

import type { DepotSuivi } from '@/lib/medic-assist/suivi/depot'
import type { ResultatEnvoiRapport, RapportProgrammeRow } from '@/lib/medic-assist/suivi/types'

export interface DepotMemoire extends DepotSuivi {
  rapports: Map<string, RapportProgrammeRow>
  administrateurs: string[]
}

export function rapportDeTest(partiel: Partial<RapportProgrammeRow> = {}): RapportProgrammeRow {
  return {
    id: 'rap-1',
    userId: 'proprio',
    artefactId: 'art-1',
    artefactTitre: 'Ventes du mois',
    frequence: 'quotidien',
    jourSemaine: null,
    jourMois: null,
    heure: '08:00',
    destinataires: ['dest-1'],
    formats: ['pdf'],
    actif: true,
    prochainEnvoiA: new Date('2026-11-13T07:00:00.000Z'),
    dernierEnvoiA: null,
    dernierStatut: null,
    derniereErreur: null,
    essais: 0,
    enCoursJusqua: null,
    creeA: new Date('2026-11-01T00:00:00.000Z'),
    ...partiel,
  }
}

export function creerDepotMemoire(
  rapports: RapportProgrammeRow[],
  administrateurs: string[] = []
): DepotMemoire {
  const table = new Map(rapports.map(r => [r.id, { ...r }]))

  const methodes = {
    rapports: table,
    administrateurs,

    async trouverArtefactVisible(artefactId: string) {
      return { id: artefactId, titre: 'Ventes du mois', proprietaireId: 'proprio' }
    },

    async mettreAJourRapport(
      id: string,
      userId: string,
      modification: Partial<RapportProgrammeRow>
    ) {
      const ligne = table.get(id)
      if (!ligne || ligne.userId !== userId) return null
      Object.assign(ligne, modification)
      if (modification.actif === false || modification.prochainEnvoiA !== undefined) {
        ligne.enCoursJusqua = null
        ligne.essais = 0
      }
      return { ...ligne }
    },

    async listerRapportsEchus(maintenant: Date, limite: number) {
      return [...table.values()]
        .filter(
          r =>
            r.actif &&
            r.prochainEnvoiA !== null &&
            r.prochainEnvoiA <= maintenant &&
            (r.enCoursJusqua === null || r.enCoursJusqua <= maintenant)
        )
        .sort((a, b) => a.prochainEnvoiA!.getTime() - b.prochainEnvoiA!.getTime())
        .slice(0, limite)
        .map(r => ({ ...r }))
    },

    async reserverRapport(
      id: string,
      attendu: { prochainEnvoiA: Date; essais: number },
      maintenant: Date,
      jusqua: Date,
      essaisApres: number
    ) {
      const ligne = table.get(id)
      if (
        !ligne ||
        !ligne.actif ||
        ligne.prochainEnvoiA?.getTime() !== attendu.prochainEnvoiA.getTime() ||
        ligne.essais !== attendu.essais ||
        (ligne.enCoursJusqua !== null && ligne.enCoursJusqua > maintenant)
      ) {
        return false
      }
      ligne.enCoursJusqua = jusqua
      ligne.essais = essaisApres
      return true
    },

    async enregistrerResultatRapport(id: string, resultat: ResultatEnvoiRapport) {
      const ligne = table.get(id)
      if (!ligne) return
      ligne.dernierEnvoiA = resultat.dernierEnvoiA
      ligne.dernierStatut = resultat.statut
      ligne.derniereErreur = resultat.erreur
      ligne.essais = resultat.essais
      if (resultat.prochainEnvoiA) ligne.prochainEnvoiA = resultat.prochainEnvoiA
      ligne.enCoursJusqua = null
    },

    async listerAdministrateursActifs() {
      return [...administrateurs]
    },
  }

  return new Proxy(methodes, {
    get(cible, nom) {
      if (nom in cible) return (cible as Record<string | symbol, unknown>)[nom]
      if (nom === 'then') return undefined
      return () => {
        throw new Error(`non implemente : ${String(nom)}`)
      }
    },
  }) as unknown as DepotMemoire
}
