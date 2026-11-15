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
import { ARCHIVES_CONSERVEES, resumerChangements, type ResumeChangements } from './tableaux-historique'
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
      const [precedente] = await tx.$queryRaw<{ version: number; definition: unknown; modifie_a: Date; proprietaire_id: string }[]>`
        SELECT version, definition, modifie_a, proprietaire_id FROM warehouse.tableaux
        WHERE id = ${id}::uuid AND proprietaire_id = ${contexte.userId} AND version = ${edition.version}
        FOR UPDATE
      `
      if (!precedente) throw new ErreurTableau('Ce tableau a été modifié depuis son ouverture. Rechargez-le.')
      await tx.$executeRaw`
        INSERT INTO warehouse.tableaux_versions (tableau_id, version, definition, auteur_id, cree_a)
        VALUES (${id}::uuid, ${precedente.version}, ${JSON.stringify(precedente.definition)}::jsonb,
          ${precedente.proprietaire_id}, ${precedente.modifie_a})
      `
      const nombre = await tx.$executeRaw`
        UPDATE warehouse.tableaux SET definition = ${stockee}::jsonb, version = version + 1, modifie_a = clock_timestamp()
        WHERE id = ${id}::uuid AND proprietaire_id = ${contexte.userId} AND version = ${edition.version}
      `
      if (!nombre) throw new ErreurTableau('Ce tableau a été modifié depuis son ouverture. Rechargez-le.')
      // La nouvelle courante est edition.version + 1 : on garde les ARCHIVES_CONSERVEES archives les plus récentes.
      await tx.$executeRaw`
        DELETE FROM warehouse.tableaux_versions
        WHERE tableau_id = ${id}::uuid AND version <= ${edition.version - ARCHIVES_CONSERVEES}
      `
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

const FormatUuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

export async function supprimerTableau(contexte: ContexteExecution, id: string) {
  if (!FormatUuid.test(id)) throw new ErreurTableau('Tableau indisponible.')
  const supprime = contexte.roleName === 'TenantAdmin'
    ? await prisma.$executeRaw`DELETE FROM warehouse.tableaux WHERE id = ${id}::uuid`
    : await prisma.$executeRaw`DELETE FROM warehouse.tableaux WHERE id = ${id}::uuid AND proprietaire_id = ${contexte.userId}`
  if (!supprime) throw new ErreurTableau('Tableau indisponible.')
}

export async function dupliquerTableau(contexte: ContexteExecution, id: string) {
  const source = await chargerTableau(id, contexte)
  if (!source?.editable) throw new ErreurTableau('Tableau indisponible.')
  const { titre, tuiles } = source.definition
  return enregistrerTableau(contexte, {
    titre: ('Copie de ' + titre).slice(0, 120).trim(),
    lecteurs: [],
    tuiles: tuiles.map(tuile => ({ ...tuile, id: randomUUID() })),
  })
}

export class ErreurVersionIncompatible extends ErreurTableau {}

export type VersionTableau = { version: number; datee: Date; auteur: string; courante: boolean; resume: ResumeChangements | null }

type LigneVersion = { version: number; definition: unknown; datee: Date; auteur: string | null }

const ResumeVide: ResumeChangements = { ajoutees: 0, retirees: 0, modifiees: 0, titreModifie: false, lecteursModifies: false }

// Lecture tolérante d'une définition JSON brute (peut ne plus valider le schéma courant).
function definitionTolerante(brut: unknown): DefinitionTableau {
  const valide = DefinitionTableauSchema.safeParse(brut)
  if (valide.success) return valide.data
  const b = (brut ?? {}) as { titre?: unknown; lecteurs?: unknown; tuiles?: unknown }
  const tuiles = Array.isArray(b.tuiles) ? b.tuiles : []
  return {
    titre: typeof b.titre === 'string' ? b.titre : '',
    lecteurs: Array.isArray(b.lecteurs) ? b.lecteurs.filter((l): l is string => typeof l === 'string') : [],
    tuiles: tuiles.map((t, i) => {
      const id = (t as { id?: unknown } | null)?.id
      return typeof t === 'object' && t && typeof id === 'string' ? t : { id: `?${i}` }
    }) as unknown as DefinitionTableau['tuiles'],
  }
}

// Contrat : `null` = résumé non calculable (version > 1 dont la précédente n'est plus en archive) ; `avant = null` seulement pour la version 1.
function resumeVersion(toutes: LigneVersion[], ligne: LigneVersion): ResumeChangements | null {
  if (ligne.version === 1) return resumeSur(null, ligne.definition)
  const precedente = toutes.find(l => l.version === ligne.version - 1)
  return precedente ? resumeSur(precedente.definition, ligne.definition) : null
}

function resumeSur(avant: unknown, apres: unknown): ResumeChangements {
  try {
    return resumerChangements(avant === null ? null : definitionTolerante(avant), definitionTolerante(apres))
  } catch { return ResumeVide }
}

const nomAuteur = (ligne: { auteur: string | null }) => ligne.auteur?.trim() || 'Compte supprimé'

async function lireVersions(contexte: ContexteExecution, id: string) {
  if (!FormatUuid.test(id)) return null
  const [courante] = await prisma.$queryRaw<LigneVersion[]>`
    SELECT t.version, t.definition, t.modifie_a AS datee,
      COALESCE(NULLIF(btrim(concat_ws(' ', u."firstName", u."lastName")), ''), u.email) AS auteur
    FROM warehouse.tableaux AS t LEFT JOIN public.users AS u ON u.id = t.proprietaire_id
    WHERE t.id = ${id}::uuid AND t.proprietaire_id = ${contexte.userId}
  `
  if (!courante) return null
  const archivees = await prisma.$queryRaw<LigneVersion[]>`
    SELECT v.version, v.definition, v.cree_a AS datee,
      COALESCE(NULLIF(btrim(concat_ws(' ', u."firstName", u."lastName")), ''), u.email) AS auteur
    FROM warehouse.tableaux_versions AS v LEFT JOIN public.users AS u ON u.id = v.auteur_id
    WHERE v.tableau_id = ${id}::uuid ORDER BY v.version DESC
  `
  return { courante, archivees }
}

export async function listerVersions(contexte: ContexteExecution, id: string): Promise<{ courante: number; versions: VersionTableau[] } | null> {
  const lecture = await lireVersions(contexte, id)
  if (!lecture) return null
  const toutes = [lecture.courante, ...lecture.archivees]
  const versions = toutes.map((ligne, i) => ({
    version: ligne.version, datee: ligne.datee, auteur: nomAuteur(ligne), courante: i === 0,
    resume: resumeVersion(toutes, ligne),
  }))
  return { courante: lecture.courante.version, versions }
}

export async function chargerVersion(contexte: ContexteExecution, id: string, version: number) {
  if (!Number.isInteger(version) || version < 1) return null
  const lecture = await lireVersions(contexte, id)
  if (!lecture) return null
  const toutes = [lecture.courante, ...lecture.archivees]
  const ligne = toutes.find(l => l.version === version)
  if (!ligne) return null
  const valide = DefinitionTableauSchema.safeParse(ligne.definition)
  return {
    version: ligne.version, datee: ligne.datee, auteur: nomAuteur(ligne), courante: ligne === lecture.courante,
    versionCourante: lecture.courante.version,
    resume: resumeVersion(toutes, ligne),
    definition: valide.success ? valide.data : null,
  }
}

export async function restaurerVersion(contexte: ContexteExecution, id: string, version: number, versionCourante: number) {
  if (!FormatUuid.test(id) || !Number.isInteger(version) || version < 1 || !Number.isInteger(versionCourante) || versionCourante < 1) {
    throw new ErreurTableau('Tableau indisponible.')
  }
  const lecture = await lireVersions(contexte, id)
  if (!lecture) throw new ErreurTableau('Tableau indisponible.')
  if (version === lecture.courante.version) throw new ErreurTableau('Cette version est déjà la version actuelle.')
  const cible = lecture.archivees.find(l => l.version === version)
  if (!cible) throw new ErreurTableau('Version introuvable.')
  const valide = DefinitionTableauSchema.safeParse(cible.definition)
  if (!valide.success) {
    throw new ErreurVersionIncompatible('Cette version n’est plus compatible avec le tableau actuel : elle ne peut pas être restaurée.')
  }
  // Le contenu est restauré, mais les lecteurs restent ceux de la version courante (pas de réouverture d'accès).
  const lecteurs = definitionTolerante(lecture.courante.definition).lecteurs
  return enregistrerTableau(contexte, { ...valide.data, lecteurs }, { id, version: versionCourante })
}
