import { z } from 'zod'
import { dernierMoisComplet } from '@/lib/donnees/periodes'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { analyserSerie, indiceMois, libelleMois } from './tendances-modele'

const demande = z.object({
  jeu: z.string().min(1).max(63),
  mesure: z.string().min(1).max(63),
  debut: z.string().refine(mois => Number.isFinite(indiceMois(mois))),
  fin: z.string().refine(mois => Number.isFinite(indiceMois(mois))),
  horizon: z.number().int().min(1).max(6),
})

export class ErreurTendances extends Error {}

export function bornesTendances(contexte: ContexteExecution) {
  const fin = dernierMoisComplet(contexte.maintenant)
  return { debut: libelleMois(indiceMois(fin) - 23), fin }
}

export async function optionsTendances(contexte: ContexteExecution) {
  return (await registreAutorise(contexte)).filter(({ jeu }) => jeu.temps && jeu.mesures.length).map(({ jeu }) => ({
    cle: jeu.cle, titre: jeu.libelle[contexte.locale],
    mesures: jeu.mesures.map(m => ({ cle: m.cle, libelle: m.libelle[contexte.locale], unite: m.unite })),
  }))
}

export async function analyserTendance(entree: unknown, contexte: ContexteExecution) {
  const validation = demande.safeParse(entree)
  if (!validation.success) throw new ErreurTendances('Vérifiez l’indicateur, les mois et l’horizon de 1 à 6 mois.')
  const selection = validation.data
  const debut = indiceMois(selection.debut)
  const fin = indiceMois(selection.fin)
  if (fin < debut || fin - debut >= 36 || selection.fin > bornesTendances(contexte).fin) {
    throw new ErreurTendances('Sélectionnez au plus 36 mois, jusqu’au dernier mois complet.')
  }
  const registre = await registreAutorise(contexte)
  const jeu = registre.find(e => e.jeu.cle === selection.jeu)?.jeu
  const mesure = jeu?.mesures.find(m => m.cle === selection.mesure)
  if (!jeu?.temps || !mesure) throw new ErreurTendances('Cet indicateur mensuel est indisponible.')
  const calcul = await calculerSemantique({ jeu: jeu.cle, mesures: [mesure.cle], granularite: 'mois',
    filtres: { periode: { debut: selection.debut, fin: selection.fin } },
  }, contexte, { limiteLignes: 36 })
  const erreurSerie = 'Le calcul doit fournir une seule observation par mois.'
  if (calcul.tronque) throw new ErreurTendances(erreurSerie)
  const valeurs = new Map<string, number | string | null>()
  for (const ligne of calcul.lignes) {
    const valeur = ligne[mesure.cle]
    if (typeof ligne.periode !== 'string' || !Number.isFinite(indiceMois(ligne.periode)) || valeurs.has(ligne.periode)) {
      throw new ErreurTendances(erreurSerie)
    }
    valeurs.set(ligne.periode, typeof valeur === 'number' || typeof valeur === 'string' ? valeur : null)
  }
  return { jeu: jeu.libelle[contexte.locale], mesure: mesure.libelle[contexte.locale], unite: mesure.unite,
    provenance: calcul.provenance, analyse: analyserSerie(valeurs, debut, fin, selection.horizon) }
}
