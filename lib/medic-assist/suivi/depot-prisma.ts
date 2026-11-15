/**
 * Implementation Prisma de DepotSuivi : SEULE couche du lot 5 qui parle aux tables
 * Assistant*.
 *
 * Conventions du schema (lot 0) :
 * - AssistantArtefact a UNE LIGNE PAR VERSION ; l'identifiant public d'un artefact
 *   (artefactId partout dans le lot 5) est son `racineId`, commun a toutes les
 *   versions. « Derniere version » = ligne de `version` maximale pour la racine.
 * - « Mes analyses » = colonnes `enregistre` / `enregistreA` du seul proprietaire
 *   (pas de table dediee).
 * - AssistantAction n'a ni colonne `resume` ni `erreur` : `parametres` porte
 *   l'enveloppe { valeurs, resume } et `resultat.erreur` porte l'erreur.
 *
 * REGLE DE SECURITE : chaque lecture ou ecriture par id met le proprietaire (ou le
 * partage) dans le MEME `where`.
 */

import { Prisma, type PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/db/client'

import type { DepotSuivi, Pagination } from './depot'
import { ErreurSuivi } from './erreurs'
import type {
  ActionRow,
  AnalyseResume,
  ArtefactVisible,
  EpingleResume,
  ModificationRapportProgramme,
  NouveauPartage,
  NouveauRapportProgramme,
  NouvelleAction,
  PartageEnvoye,
  PartageRecu,
  RapportProgrammeRow,
  ResultatEnvoiRapport,
  TypeCiblePartage,
} from './types'

type Objet = Record<string, Prisma.JsonValue>

function enObjet(valeur: Prisma.JsonValue | null | undefined): Objet | null {
  if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) return valeur as Objet
  return null
}

function enTableauDeChaines(valeur: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(valeur)) return []
  return valeur.filter((v): v is string => typeof v === 'string')
}

function entree(valeur: unknown): Prisma.InputJsonValue {
  return valeur as Prisma.InputJsonValue
}

/** 'HH:mm' a partir d'une chaine ou (ancien format) d'une heure entiere. */
function heureEnChaine(heure: string | number): string {
  if (typeof heure === 'number') return `${String(heure).padStart(2, '0')}:00`
  return heure
}

function sousTitreDe(spec: Prisma.JsonValue): string | null {
  const objet = enObjet(spec)
  const valeur = objet?.sousTitre
  return typeof valeur === 'string' && valeur.trim() ? valeur : null
}

type LigneArtefact = Prisma.AssistantArtefactGetPayload<object>

function enArtefactVisible(ligne: LigneArtefact): ArtefactVisible {
  return {
    id: ligne.racineId,
    titre: ligne.titre,
    type: ligne.type,
    sousTitre: sousTitreDe(ligne.spec),
    conversationId: ligne.conversationId ?? '',
    proprietaireId: ligne.userId,
  }
}

// ---------------------------------------------------------------------------- actions

type LigneAction = Prisma.AssistantActionGetPayload<object>

function enActionRow(ligne: LigneAction): ActionRow {
  const enveloppe = enObjet(ligne.parametres)
  const aEnveloppe = enveloppe !== null && 'valeurs' in enveloppe
  const resume = aEnveloppe && typeof enveloppe.resume === 'string' ? enveloppe.resume : ''
  return {
    id: ligne.id,
    userId: ligne.userId,
    conversationId: ligne.conversationId,
    type: ligne.type as ActionRow['type'],
    statut: ligne.statut as ActionRow['statut'],
    parametres: aEnveloppe ? enveloppe.valeurs : ligne.parametres,
    resume,
    resultat: (ligne.resultat as ActionRow['resultat']) ?? null,
    creeA: ligne.createdAt,
    executeeA: ligne.executeeA,
  }
}

function entiteDuResultat(resultat: Prisma.JsonValue | null): string | null {
  const objet = enObjet(resultat)
  const id = objet?.entiteId ?? objet?.tacheId
  return typeof id === 'string' ? id : null
}

// ---------------------------------------------------------------------------- rapports

type LigneRapport = Prisma.AssistantRapportProgrammeGetPayload<object>

function enRapportRow(ligne: LigneRapport): RapportProgrammeRow {
  let statut: RapportProgrammeRow['dernierStatut'] = null
  if (ligne.dernierStatut === 'echec') statut = 'echec'
  else if (ligne.dernierStatut === 'succes') statut = ligne.dernierErreur ? 'partiel' : 'ok'
  return {
    id: ligne.id,
    userId: ligne.userId,
    artefactId: ligne.artefactRacineId,
    artefactTitre: ligne.titre,
    frequence: ligne.frequence as RapportProgrammeRow['frequence'],
    jourSemaine: ligne.jourSemaine,
    jourMois: ligne.jourMois,
    heure: ligne.heure,
    destinataires: enTableauDeChaines(ligne.destinataires),
    formats: enTableauDeChaines(ligne.formats) as RapportProgrammeRow['formats'],
    actif: ligne.actif,
    prochainEnvoiA: ligne.prochainEnvoiA,
    dernierEnvoiA: ligne.dernierEnvoiA,
    dernierStatut: statut,
    derniereErreur: ligne.dernierErreur,
    essais: ligne.essais,
    enCoursJusqua: ligne.enCoursJusqua,
    creeA: ligne.createdAt,
  } as RapportProgrammeRow
}

function statutEnBase(resultat: ResultatEnvoiRapport): {
  dernierStatut: string
  dernierErreur: string | null
} {
  if (resultat.statut === 'echec') {
    return { dernierStatut: 'echec', dernierErreur: resultat.erreur }
  }
  if (resultat.statut === 'partiel') {
    return { dernierStatut: 'succes', dernierErreur: resultat.erreur ?? 'partiel' }
  }
  return { dernierStatut: 'succes', dernierErreur: null }
}

// ---------------------------------------------------------------------------- depot

export function creerDepotPrisma(client: PrismaClient = prisma): DepotSuivi {
  /** Derniere version de chaque racine demandee (racineId -> ligne). */
  async function dernieresVersions(
    racineIds: string[],
    userId?: string
  ): Promise<Map<string, LigneArtefact>> {
    const resultat = new Map<string, LigneArtefact>()
    if (racineIds.length === 0) return resultat
    const lignes = await client.assistantArtefact.findMany({
      where: { racineId: { in: racineIds }, ...(userId ? { userId } : {}) },
      orderBy: { version: 'desc' },
    })
    for (const ligne of lignes) {
      if (!resultat.has(ligne.racineId)) resultat.set(ligne.racineId, ligne)
    }
    return resultat
  }

  /** Racines (parmi `versions`) que `userId` possede ou qu'on a partagees avec lui. */
  async function racinesVisibles(
    userId: string,
    versions: Map<string, LigneArtefact>
  ): Promise<Set<string>> {
    const visibles = new Set<string>()
    const autres: LigneArtefact[] = []
    for (const [racineId, ligne] of versions) {
      if (ligne.userId === userId) visibles.add(racineId)
      else autres.push(ligne)
    }
    if (autres.length === 0) return visibles
    const conversationIds = autres.flatMap((l) => (l.conversationId ? [l.conversationId] : []))
    const partages = await client.assistantPartage.findMany({
      where: {
        aUserId: userId,
        OR: [
          { ressourceType: 'artefact', ressourceId: { in: autres.map((l) => l.racineId) } },
          { ressourceType: 'conversation', ressourceId: { in: conversationIds } },
        ],
      },
      select: { ressourceType: true, ressourceId: true },
    })
    const artefactsPartages = new Set(
      partages.filter((p) => p.ressourceType === 'artefact').map((p) => p.ressourceId)
    )
    const conversationsPartagees = new Set(
      partages.filter((p) => p.ressourceType === 'conversation').map((p) => p.ressourceId)
    )
    for (const ligne of autres) {
      if (
        artefactsPartages.has(ligne.racineId) ||
        (ligne.conversationId && conversationsPartagees.has(ligne.conversationId))
      ) {
        visibles.add(ligne.racineId)
      }
    }
    return visibles
  }

  async function nomsDesUtilisateurs(ids: string[]): Promise<Map<string, string>> {
    const noms = new Map<string, string>()
    if (ids.length === 0) return noms
    const utilisateurs = await client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    })
    for (const u of utilisateurs) noms.set(u.id, `${u.firstName} ${u.lastName}`.trim())
    return noms
  }

  /** Titre (et conversation d'un artefact) des cibles de partage. */
  async function ciblesDePartages(
    partages: { ressourceType: string; ressourceId: string }[]
  ): Promise<Map<string, { titre: string; conversationId: string | null }>> {
    const cibles = new Map<string, { titre: string; conversationId: string | null }>()
    const conversationIds = partages
      .filter((p) => p.ressourceType === 'conversation')
      .map((p) => p.ressourceId)
    const artefactIds = partages
      .filter((p) => p.ressourceType === 'artefact')
      .map((p) => p.ressourceId)
    if (conversationIds.length > 0) {
      const conversations = await client.assistantConversation.findMany({
        where: { id: { in: conversationIds } },
        select: { id: true, titre: true },
      })
      for (const c of conversations) {
        cibles.set(`conversation:${c.id}`, { titre: c.titre, conversationId: c.id })
      }
    }
    const versions = await dernieresVersions(artefactIds)
    for (const [racineId, ligne] of versions) {
      cibles.set(`artefact:${racineId}`, { titre: ligne.titre, conversationId: ligne.conversationId })
    }
    return cibles
  }

  const depot: DepotSuivi = {
    // ----------------------------------------------------------- artefacts, conversations
    async trouverArtefactVisible(artefactId, userId) {
      const proprietaire = await client.assistantArtefact.findFirst({
        where: { racineId: artefactId, userId },
        orderBy: { version: 'desc' },
      })
      if (proprietaire) return enArtefactVisible(proprietaire)

      const derniere = await client.assistantArtefact.findFirst({
        where: { racineId: artefactId },
        orderBy: { version: 'desc' },
      })
      if (!derniere) return null
      const partage = await client.assistantPartage.findFirst({
        where: {
          aUserId: userId,
          OR: [
            { ressourceType: 'artefact', ressourceId: artefactId },
            ...(derniere.conversationId
              ? [{ ressourceType: 'conversation', ressourceId: derniere.conversationId }]
              : []),
          ],
        },
        select: { id: true },
      })
      return partage ? enArtefactVisible(derniere) : null
    },

    async trouverArtefactProprietaire(artefactId, userId) {
      const ligne = await client.assistantArtefact.findFirst({
        where: { racineId: artefactId, userId },
        orderBy: { version: 'desc' },
      })
      return ligne ? enArtefactVisible(ligne) : null
    },

    async trouverConversationProprietaire(conversationId, userId) {
      const ligne = await client.assistantConversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true, titre: true },
      })
      return ligne ? { id: ligne.id, titre: ligne.titre } : null
    },

    // ----------------------------------------------------------- actions
    async creerAction(donnees: NouvelleAction) {
      if (!donnees.conversationId) {
        throw new ErreurSuivi('invalide', 'Une action est rattachee a une conversation')
      }
      const conversation = await client.assistantConversation.findFirst({
        where: { id: donnees.conversationId, userId: donnees.userId },
        select: { id: true },
      })
      if (!conversation) throw new ErreurSuivi('introuvable')
      const ligne = await client.assistantAction.create({
        data: {
          userId: donnees.userId,
          conversationId: donnees.conversationId,
          type: donnees.type,
          statut: 'proposee',
          parametres: entree({ valeurs: donnees.parametres, resume: donnees.resume }),
        },
      })
      return enActionRow(ligne)
    },

    async trouverAction(id, userId) {
      const ligne = await client.assistantAction.findFirst({ where: { id, userId } })
      return ligne ? enActionRow(ligne) : null
    },

    async mettreAJourActionProposee(id, userId, donnees) {
      const { count } = await client.assistantAction.updateMany({
        where: { id, userId, statut: 'proposee' },
        data: { parametres: entree({ valeurs: donnees.parametres, resume: donnees.resume }) },
      })
      return count === 1
    },

    async reserverAction(id, userId) {
      const { count } = await client.assistantAction.updateMany({
        where: { id, userId, statut: 'proposee' },
        data: { statut: 'executee', executeeA: new Date() },
      })
      return count === 1
    },

    async terminerAction(id, userId, donnees) {
      await client.assistantAction.updateMany({
        where: { id, userId },
        data: { statut: donnees.statut, resultat: entree(donnees.resultat) },
      })
    },

    async annulerAction(id, userId) {
      const { count } = await client.assistantAction.updateMany({
        where: { id, userId, statut: 'proposee' },
        data: { statut: 'annulee', executeeA: new Date() },
      })
      return count === 1
    },

    async idsTachesCreeesPar(userId) {
      const lignes = await client.assistantAction.findMany({
        where: { userId, type: 'creer_tache', statut: 'executee' },
        select: { resultat: true },
      })
      return lignes.flatMap((l) => {
        const id = entiteDuResultat(l.resultat)
        return id ? [id] : []
      })
    },

    async createursDesTaches(tacheIds) {
      const createurs = new Map<string, string>()
      if (tacheIds.length === 0) return createurs
      const lignes = await client.assistantAction.findMany({
        where: {
          type: 'creer_tache',
          statut: 'executee',
          OR: tacheIds.flatMap((id) => [
            { resultat: { path: ['entiteId'], equals: id } },
            { resultat: { path: ['tacheId'], equals: id } },
          ]),
        },
        select: { userId: true, resultat: true },
      })
      for (const ligne of lignes) {
        const id = entiteDuResultat(ligne.resultat)
        if (id && tacheIds.includes(id)) createurs.set(id, ligne.userId)
      }
      return createurs
    },

    // ----------------------------------------------------------- Mes analyses
    async enregistrerAnalyse(userId, artefactId) {
      const { count } = await client.assistantArtefact.updateMany({
        where: { racineId: artefactId, userId, enregistre: false },
        data: { enregistre: true, enregistreA: new Date() },
      })
      return count > 0
    },

    async retirerAnalyse(userId, artefactId) {
      const { count } = await client.assistantArtefact.updateMany({
        where: { racineId: artefactId, userId, enregistre: true },
        data: { enregistre: false, enregistreA: null },
      })
      return count > 0
    },

    async listerAnalyses(userId, options: { recherche?: string; artefactId?: string } & Pagination) {
      const enregistrees = await client.assistantArtefact.findMany({
        where: {
          userId,
          enregistre: true,
          ...(options.artefactId ? { racineId: options.artefactId } : {}),
        },
        select: { racineId: true, enregistreA: true },
      })
      // Date d'enregistrement d'une racine = la plus recente de ses versions enregistrees.
      const dates = new Map<string, Date>()
      for (const l of enregistrees) {
        const date = l.enregistreA ?? new Date(0)
        const actuelle = dates.get(l.racineId)
        if (!actuelle || date > actuelle) dates.set(l.racineId, date)
      }
      const versions = await dernieresVersions([...dates.keys()], userId)
      const q = options.recherche?.trim().toLowerCase()
      const toutes: AnalyseResume[] = [...versions.values()]
        .filter(
          (l) =>
            !q ||
            l.titre.toLowerCase().includes(q) ||
            (l.description ?? '').toLowerCase().includes(q)
        )
        .map((l) => ({
          artefactId: l.racineId,
          titre: l.titre,
          type: l.type,
          sousTitre: sousTitreDe(l.spec),
          conversationId: l.conversationId ?? '',
          enregistreeA: dates.get(l.racineId) ?? l.createdAt,
          partage: false,
        }))
        .sort((a, b) => b.enregistreeA.getTime() - a.enregistreeA.getTime())
      const debut = (options.page - 1) * options.taille
      return { lignes: toutes.slice(debut, debut + options.taille), total: toutes.length }
    },

    // ----------------------------------------------------------- epingles
    async epingler(userId, artefactId) {
      const ordre = await client.assistantEpingle.count({ where: { userId } })
      const { count } = await client.assistantEpingle.createMany({
        data: [{ userId, artefactRacineId: artefactId, ordre }],
        skipDuplicates: true,
      })
      return count === 1
    },

    async desepingler(userId, artefactId) {
      const { count } = await client.assistantEpingle.deleteMany({
        where: { userId, artefactRacineId: artefactId },
      })
      return count > 0
    },

    async listerEpingles(userId, options) {
      const epingles = await client.assistantEpingle.findMany({
        where: {
          userId,
          ...(options?.artefactId ? { artefactRacineId: options.artefactId } : {}),
        },
        orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }],
      })
      const versions = await dernieresVersions(epingles.map((e) => e.artefactRacineId))
      const visibles = await racinesVisibles(userId, versions)
      return epingles.flatMap((e): EpingleResume[] => {
        const ligne = versions.get(e.artefactRacineId)
        if (!ligne || !visibles.has(e.artefactRacineId)) return []
        return [
          {
            artefactId: e.artefactRacineId,
            titre: ligne.titre,
            type: ligne.type,
            conversationId: ligne.conversationId ?? '',
            ordre: e.ordre,
            epingleeA: e.createdAt,
          },
        ]
      })
    },

    // ----------------------------------------------------------- partages
    async creerPartages(partages: NouveauPartage[]) {
      const crees: NouveauPartage[] = []
      for (const partage of partages) {
        // Un createMany par partage : la contrainte d'unicite tranche, meme si deux
        // demandes simultanees visent le meme destinataire (count = 1 pour une seule).
        const { count } = await client.assistantPartage.createMany({
          data: [
            {
              ressourceType: partage.cibleType,
              ressourceId: partage.cibleId,
              deUserId: partage.expediteurId,
              aUserId: partage.destinataireId,
              message: partage.message,
            },
          ],
          skipDuplicates: true,
        })
        if (count === 1) crees.push(partage)
      }
      return crees
    },

    async retirerPartage(partageId, userId) {
      return client.$transaction(async (tx) => {
        const filtre = {
          id: partageId,
          OR: [{ deUserId: userId }, { aUserId: userId }],
        }
        const partage = await tx.assistantPartage.findFirst({ where: filtre })
        if (!partage) return false
        const { count } = await tx.assistantPartage.deleteMany({ where: filtre })
        if (count === 0) return false

        const destinataireId = partage.aUserId
        let racines: string[]
        if (partage.ressourceType === 'artefact') {
          racines = [partage.ressourceId]
        } else {
          const artefacts = await tx.assistantArtefact.findMany({
            where: { conversationId: partage.ressourceId },
            select: { racineId: true },
            distinct: ['racineId'],
          })
          racines = artefacts.map((a) => a.racineId)
        }
        if (racines.length === 0) return true

        // Racines que le destinataire garde : il en est proprietaire, ou un autre
        // partage (artefact direct, ou conversation contenant l'artefact) subsiste.
        const gardees = new Set<string>()
        const possedes = await tx.assistantArtefact.findMany({
          where: { racineId: { in: racines }, userId: destinataireId },
          select: { racineId: true },
        })
        for (const a of possedes) gardees.add(a.racineId)

        const restants = await tx.assistantPartage.findMany({
          where: { aUserId: destinataireId },
          select: { ressourceType: true, ressourceId: true },
        })
        const artefactsRestants = new Set(
          restants.filter((p) => p.ressourceType === 'artefact').map((p) => p.ressourceId)
        )
        const conversationsRestantes = new Set(
          restants.filter((p) => p.ressourceType === 'conversation').map((p) => p.ressourceId)
        )
        for (const racineId of racines) {
          if (artefactsRestants.has(racineId)) gardees.add(racineId)
        }
        if (conversationsRestantes.size > 0) {
          const liens = await tx.assistantArtefact.findMany({
            where: { racineId: { in: racines }, conversationId: { in: [...conversationsRestantes] } },
            select: { racineId: true },
          })
          for (const l of liens) gardees.add(l.racineId)
        }

        const aSupprimer = racines.filter((r) => !gardees.has(r))
        if (aSupprimer.length > 0) {
          await tx.assistantEpingle.deleteMany({
            where: { userId: destinataireId, artefactRacineId: { in: aSupprimer } },
          })
        }
        return true
      })
    },

    async listerPartagesRecus(userId, pagination) {
      const where = { aUserId: userId }
      const [total, lignes] = await Promise.all([
        client.assistantPartage.count({ where }),
        client.assistantPartage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pagination.page - 1) * pagination.taille,
          take: pagination.taille,
        }),
      ])
      const [noms, cibles] = await Promise.all([
        nomsDesUtilisateurs([...new Set(lignes.map((l) => l.deUserId))]),
        ciblesDePartages(lignes),
      ])
      return {
        total,
        lignes: lignes.map((l): PartageRecu => {
          const cible = cibles.get(`${l.ressourceType}:${l.ressourceId}`)
          return {
            id: l.id,
            cibleType: l.ressourceType as TypeCiblePartage,
            cibleId: l.ressourceId,
            titre: cible?.titre ?? '',
            conversationId: cible?.conversationId ?? null,
            expediteurNom: noms.get(l.deUserId) ?? '',
            message: l.message,
            creeA: l.createdAt,
          }
        }),
      }
    },

    async listerPartagesEnvoyes(userId, pagination) {
      const where = { deUserId: userId }
      const [total, lignes] = await Promise.all([
        client.assistantPartage.count({ where }),
        client.assistantPartage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pagination.page - 1) * pagination.taille,
          take: pagination.taille,
        }),
      ])
      const [noms, cibles] = await Promise.all([
        nomsDesUtilisateurs([...new Set(lignes.map((l) => l.aUserId))]),
        ciblesDePartages(lignes),
      ])
      return {
        total,
        lignes: lignes.map((l): PartageEnvoye => {
          const cible = cibles.get(`${l.ressourceType}:${l.ressourceId}`)
          return {
            id: l.id,
            cibleType: l.ressourceType as TypeCiblePartage,
            cibleId: l.ressourceId,
            titre: cible?.titre ?? '',
            destinataireNom: noms.get(l.aUserId) ?? '',
            creeA: l.createdAt,
          }
        }),
      }
    },

    // ----------------------------------------------------------- rapports programmes
    async creerRapport(donnees: NouveauRapportProgramme) {
      const artefact = await client.assistantArtefact.findFirst({
        where: { racineId: donnees.artefactId, userId: donnees.userId },
        orderBy: { version: 'desc' },
        select: { titre: true },
      })
      if (!artefact) throw new ErreurSuivi('introuvable')
      const ligne = await client.assistantRapportProgramme.create({
        data: {
          userId: donnees.userId,
          titre: artefact.titre,
          artefactRacineId: donnees.artefactId,
          frequence: donnees.frequence,
          jourSemaine: donnees.jourSemaine,
          jourMois: donnees.jourMois,
          heure: heureEnChaine(donnees.heure),
          destinataires: entree(donnees.destinataires),
          formats: entree(donnees.formats),
          prochainEnvoiA: donnees.prochainEnvoiA,
        },
      })
      return enRapportRow(ligne)
    },

    async trouverRapport(id, userId) {
      const ligne = await client.assistantRapportProgramme.findFirst({ where: { id, userId } })
      return ligne ? enRapportRow(ligne) : null
    },

    async listerRapports(userId) {
      const lignes = await client.assistantRapportProgramme.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      })
      return lignes.map(enRapportRow)
    },

    async mettreAJourRapport(id, userId, modification: ModificationRapportProgramme) {
      const donnees: Prisma.AssistantRapportProgrammeUpdateManyMutationInput = {}
      if (modification.frequence !== undefined) donnees.frequence = modification.frequence
      if (modification.jourSemaine !== undefined) donnees.jourSemaine = modification.jourSemaine
      if (modification.jourMois !== undefined) donnees.jourMois = modification.jourMois
      if (modification.heure !== undefined) donnees.heure = heureEnChaine(modification.heure)
      if (modification.destinataires !== undefined) {
        donnees.destinataires = entree(modification.destinataires)
      }
      if (modification.formats !== undefined) donnees.formats = entree(modification.formats)
      if (modification.actif !== undefined) donnees.actif = modification.actif
      if (modification.prochainEnvoiA !== undefined && modification.prochainEnvoiA !== null) {
        donnees.prochainEnvoiA = modification.prochainEnvoiA
      }
      // Desactivation ou nouvelle echeance : le bail est leve et le compteur d'essais repart de zero.
      if (modification.actif === false || donnees.prochainEnvoiA !== undefined) {
        donnees.enCoursJusqua = null
        donnees.essais = 0
      }
      const { count } = await client.assistantRapportProgramme.updateMany({
        where: { id, userId },
        data: donnees,
      })
      if (count === 0) return null
      const ligne = await client.assistantRapportProgramme.findFirst({ where: { id, userId } })
      return ligne ? enRapportRow(ligne) : null
    },

    async supprimerRapport(id, userId) {
      const { count } = await client.assistantRapportProgramme.deleteMany({ where: { id, userId } })
      return count === 1
    },

    async listerRapportsEchus(maintenant, limite) {
      const lignes = await client.assistantRapportProgramme.findMany({
        where: {
          actif: true,
          prochainEnvoiA: { lte: maintenant },
          OR: [{ enCoursJusqua: null }, { enCoursJusqua: { lte: maintenant } }],
        },
        orderBy: { prochainEnvoiA: 'asc' },
        take: limite,
      })
      return lignes.map(enRapportRow)
    },

    async reserverRapport(id, attendu, maintenant, jusqua, essaisApres) {
      const { count } = await client.assistantRapportProgramme.updateMany({
        where: {
          id,
          actif: true,
          prochainEnvoiA: attendu.prochainEnvoiA,
          essais: attendu.essais,
          OR: [{ enCoursJusqua: null }, { enCoursJusqua: { lte: maintenant } }],
        },
        data: { enCoursJusqua: jusqua, essais: essaisApres },
      })
      return count === 1
    },

    async enregistrerResultatRapport(id, resultat) {
      await client.assistantRapportProgramme.updateMany({
        where: { id },
        data: {
          dernierEnvoiA: resultat.dernierEnvoiA,
          ...statutEnBase(resultat),
          essais: resultat.essais,
          ...(resultat.prochainEnvoiA ? { prochainEnvoiA: resultat.prochainEnvoiA } : {}),
          enCoursJusqua: null,
        },
      })
    },

    async listerAdministrateursActifs() {
      const lignes = await client.user.findMany({
        where: { roleName: 'TenantAdmin', status: 'active', deletedAt: null },
        select: { id: true },
      })
      return lignes.map(l => l.id)
    },
  }

  return depot
}

let depotCourant: DepotSuivi | undefined

/** Depot de production : singleton paresseux branche sur le client Prisma partage. */
export function obtenirDepot(): DepotSuivi {
  if (!depotCourant) depotCourant = creerDepotPrisma()
  return depotCourant
}
