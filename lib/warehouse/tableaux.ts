import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { lireArtefact } from '@/lib/medic-assist/artefacts/stockage'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import type { Registre } from '@/lib/medic-assist/donnees/catalogue/types'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { chargerComptesAvecAcces } from '@/lib/medic-assist/suivi/comptes'
import { DefinitionTableauSchema, type DefinitionTableau, type FiltreTableau, type TuileMesure } from './tableaux-modeles'

export class ErreurTableau extends Error {}

type LigneTableau = { id: string; proprietaire_id: string; definition: unknown; version: number }

export async function listerTableaux(contexte: ContexteExecution) {
  const tableaux = await prisma.$queryRaw<(LigneTableau & { titre: string })[]>`
    SELECT t.id, t.proprietaire_id, t.definition ->> 'titre' AS titre
    FROM warehouse.tableaux AS t
    WHERE t.proprietaire_id = ${contexte.userId} OR EXISTS (
      SELECT 1 FROM warehouse.lecteurs_tableaux AS l
      WHERE l.tableau_id = t.id AND l.utilisateur_id = ${contexte.userId}
    ) ORDER BY t.modifie_a DESC LIMIT 100
  `
  return tableaux.map(t => ({ id: t.id, titre: t.titre, editable: t.proprietaire_id === contexte.userId }))
}

export async function chargerTableau(id: string, contexte: ContexteExecution) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return null
  const [tableau] = await prisma.$queryRaw<LigneTableau[]>`
    SELECT t.id, t.proprietaire_id, t.definition, t.version FROM warehouse.tableaux AS t
    WHERE t.id = ${id}::uuid AND (t.proprietaire_id = ${contexte.userId} OR EXISTS (
      SELECT 1 FROM warehouse.lecteurs_tableaux AS l
      WHERE l.tableau_id = t.id AND l.utilisateur_id = ${contexte.userId}
    ))
  `
  if (!tableau) return null
  const editable = tableau.proprietaire_id === contexte.userId
  const definition = DefinitionTableauSchema.parse(tableau.definition)
  return { id, version: tableau.version, editable, definition: editable ? definition : { ...definition, lecteurs: [] } }
}

export async function optionsTableau(contexte: ContexteExecution) {
  const registre = await registreAutorise(contexte)
  return registre.filter(e => e.jeu.mesures.length).map(({ jeu }) => ({
    cle: jeu.cle, libelle: jeu.libelle[contexte.locale],
    mesures: jeu.mesures.map(m => ({ cle: m.cle, libelle: m.libelle[contexte.locale] })),
    dimensions: jeu.dimensions.map(d => ({ cle: d.cle, libelle: d.libelle[contexte.locale] })),
  }))
}

export async function enregistrerTableau(contexte: ContexteExecution, entree: unknown, edition?: { id: string; version: number }) {
  const validation = DefinitionTableauSchema.safeParse(entree)
  if (!validation.success) throw new ErreurTableau('Vérifiez le titre, les lecteurs et les paramètres des tuiles.')
  const definition = validation.data
  const registre = await registreAutorise(contexte)
  for (const tuile of definition.tuiles) {
    if (tuile.type === 'artefact') {
      try { await lireArtefact(contexte, tuile.artefact) } catch { throw new ErreurTableau('Un artefact est indisponible.') }
    } else {
      const jeu = registre.find(e => e.jeu.cle === tuile.jeu)?.jeu
      if (!jeu?.mesures.some(m => m.cle === tuile.mesure) || tuile.dimensions.some(cle => !jeu.dimensions.some(d => d.cle === cle))) {
        throw new ErreurTableau('Un indicateur ou une dimension de détail est indisponible.')
      }
    }
  }
  const lecteurs = definition.lecteurs.filter(id => id !== contexte.userId)
  if (lecteurs.length && (await chargerComptesAvecAcces({ ids: lecteurs, limite: lecteurs.length })).length !== lecteurs.length) {
    throw new ErreurTableau('Un compte sélectionné est indisponible.')
  }
  const ancienne = edition ? await chargerTableau(edition.id, contexte) : null
  if (edition && !ancienne?.editable) throw new ErreurTableau('Tableau indisponible.')
  const id = edition?.id ?? randomUUID()
  const stockee = JSON.stringify({ ...definition, lecteurs })
  await prisma.$transaction(async tx => {
    if (edition) {
      const nombre = await tx.$executeRaw`
        UPDATE warehouse.tableaux SET definition = ${stockee}::jsonb, version = version + 1, modifie_a = clock_timestamp()
        WHERE id = ${id}::uuid AND proprietaire_id = ${contexte.userId} AND version = ${edition.version}
      `
      if (!nombre) throw new ErreurTableau('Ce tableau a été modifié depuis son ouverture. Rechargez-le.')
      await tx.$executeRaw`DELETE FROM warehouse.lecteurs_tableaux WHERE tableau_id = ${id}::uuid`
    } else {
      await tx.$executeRaw`
        INSERT INTO warehouse.tableaux (id, proprietaire_id, definition) VALUES (${id}::uuid, ${contexte.userId}, ${stockee}::jsonb)
      `
    }
    if (lecteurs.length) await tx.$executeRaw`
      INSERT INTO warehouse.lecteurs_tableaux (tableau_id, utilisateur_id)
      VALUES ${Prisma.join(lecteurs.map(lecteur => Prisma.sql`(${id}::uuid, ${lecteur})`))}
    `
    const nouvelles = new Map(definition.tuiles.filter(t => t.type === 'mesure').map(t => [t.id, t]))
    for (const tuile of ancienne?.definition.tuiles ?? []) {
      if (tuile.type !== 'mesure' || !tuile.alerte) continue
      const actuelle = nouvelles.get(tuile.id)
      if (actuelle?.jeu === tuile.jeu && actuelle.mesure === tuile.mesure &&
        actuelle.alerte?.sens === tuile.alerte.sens && actuelle.alerte.seuil === tuile.alerte.seuil) continue
      await tx.$executeRaw`DELETE FROM warehouse.etat_alertes_tableaux WHERE tableau_id = ${id}::uuid AND tuile_id = ${tuile.id}::uuid`
    }
  })
  return id
}

export async function calculerTuile(tuile: TuileMesure, contexte: ContexteExecution, filtre?: FiltreTableau, detail = false, registreBrut?: Registre) {
  const jeu = (await registreAutorise(contexte, registreBrut)).find(e => e.jeu.cle === tuile.jeu)?.jeu
  const mesure = jeu?.mesures.find(m => m.cle === tuile.mesure)
  if (!jeu || !mesure) throw new ErreurTableau('Indicateur indisponible.')
  const appliquerFiltre = filtre && jeu.filtres.some(f => f.cle === filtre.cle && f.type === 'texte')
  const resultat = await calculerSemantique({
    jeu: tuile.jeu, mesures: [tuile.mesure], dimensions: detail ? tuile.dimensions : [],
    ...(appliquerFiltre ? { filtres: { [filtre.cle]: filtre.valeur } } : {}),
  }, contexte, { limiteLignes: 40 }, registreBrut)
  return { libelle: mesure.libelle[contexte.locale], unite: mesure.unite, filtreApplique: Boolean(appliquerFiltre), resultat }
}

export async function lireTableau(id: string, contexte: ContexteExecution, filtre?: FiltreTableau, detail?: string) {
  const tableau = await chargerTableau(id, contexte)
  if (!tableau) return null
  const registreBrut = await registrePostgres()
  const registre = await registreAutorise(contexte, registreBrut)
  const jeux = new Set(tableau.definition.tuiles.flatMap(t => t.type === 'mesure' ? [t.jeu] : []))
  const filtres = [...new Set(registre.filter(e => jeux.has(e.jeu.cle)).flatMap(e =>
    e.jeu.filtres.filter(f => f.type === 'texte').map(f => f.cle)))].sort()
  const tuiles = await Promise.all(tableau.definition.tuiles.map(async tuile => {
    try {
      if (tuile.type === 'artefact') {
        const artefact = await lireArtefact(contexte, tuile.artefact)
        return { id: tuile.id, type: 'artefact' as const, artefact: {
          id: artefact.id, titre: artefact.titre, version: artefact.version,
          jeux: artefact.jeux.map(j => ({ calculeA: j.calculeA, regles: j.provenance.regles })), droits: artefact.droits,
        } }
      }
      const mesure = await calculerTuile(tuile, contexte, filtre, detail === tuile.id, registreBrut)
      const valeur = mesure.resultat.totaux?.[tuile.mesure] ??
        (detail !== tuile.id ? mesure.resultat.lignes[0]?.[tuile.mesure] : null)
      const objectifAtteint = tuile.objectif && (typeof valeur === 'number' || typeof valeur === 'string')
        ? new Prisma.Decimal(valeur).gte(tuile.objectif) : undefined
      return { id: tuile.id, type: 'mesure' as const, objectif: tuile.objectif, dimensions: tuile.dimensions,
        objectifAtteint, ...mesure }
    } catch {
      return { id: tuile.id, type: 'indisponible' as const }
    }
  }))
  return { id, titre: tableau.definition.titre, editable: tableau.editable, filtres, tuiles }
}
