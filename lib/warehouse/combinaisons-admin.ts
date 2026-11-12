import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { lireEntrepot } from '@/lib/medic-assist/donnees/lecture-seule'
import { citer, empreinte } from './configuration'
import { prisma } from '@/lib/db/client'
import { regleDonneesSchema } from '@/lib/auth/data-access'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import { ErreurJointure, JointureSchema, lireJointures, preparerJointure, compilerJointure, SelectionJointureSchema, INDICATEUR_CORRESPONDANCE, type JointureEnregistree } from './jointures'
import { colonnesUtiliseesParCatalogue, publicationsMetier } from './modele-metier'

async function avecVerrouCombinaisons<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:warehouse:combinaisons', 0))::text`
    return action(tx)
  }, { timeout: 15_000 })
}

export async function creerCombinaison(entree: unknown) {
  const spec = JointureSchema.parse(entree)
  return avecVerrouCombinaisons(async tx => {
    const registre = await registrePostgres(undefined, tx)
    preparerJointure(spec, registre)
    const cle = 'combinaison_' + randomUUID().replaceAll('-', '')
    if (registre.some(e => e.jeu.cle === cle)) throw new ErreurJointure('Réessayez l’enregistrement.')
    await tx.$executeRaw`
      INSERT INTO warehouse.combinaisons (cle, definition)
      VALUES (${cle}, ${JSON.stringify(spec)}::jsonb)
    `
    return cle
  })
}

export async function chargerCombinaison(cle: string) {
  const definition = (await lireJointures()).find(jeu => jeu.cle === cle)
  return definition ? { definition, revision: empreinte(definition) } : null
}

function colonnesUtilisees(dependante: JointureEnregistree, cle: string) {
  const cote = dependante.gauche === cle ? 'gauche' : 'droite'
  return [...dependante.liens.map(lien => lien[cote]),
    ...dependante.colonnes.filter(c => c.cote === cote).map(c => c.nom)]
}

export async function modifierCombinaison(cle: string, revision: string, entree: unknown) {
  const choix = SelectionJointureSchema.parse(entree)
  return avecVerrouCombinaisons(async tx => {
    const jointures = await lireJointures(tx)
    const actuelle = jointures.find(jeu => jeu.cle === cle)
    if (!actuelle) throw new ErreurJointure('Ce jeu combiné est introuvable.')
    if (empreinte(actuelle) !== revision) {
      throw new ErreurJointure('Ce jeu a été modifié depuis son ouverture. Rouvrez-le pour reprendre vos changements.')
    }
    if (choix.gauche !== actuelle.gauche || choix.droite !== actuelle.droite) {
      throw new ErreurJointure('Les deux jeux source sont fixés lors de la création de la combinaison.')
    }
    const spec = { ...choix, titre: actuelle.titre, description: actuelle.description }
    const registreAvant = await registrePostgres(jointures, tx)
    const apres = preparerJointure(spec, registreAvant)
    const dependantes = jointures.filter(j => (j.gauche === cle || j.droite === cle) &&
      registreAvant.some(e => e.jeu.cle === j.cle))
    const publication = (await publicationsMetier(tx)).get(cle)
    const [politique] = await tx.$queryRaw<{ definition: unknown }[]>`
      SELECT definition FROM warehouse.regles_acces WHERE jeu = ${cle}
    `
    const regle = politique && regleDonneesSchema.parse(politique.definition)
    if (dependantes.length || publication || regle) {
      const avant = preparerJointure(actuelle, registreAvant)
      const identiteColonnes = (colonnes: typeof avant.colonnes) => new Map(colonnes.map(c => [
        c.sortie.nom, JSON.stringify([c.cote, c.origine, c.sortie.type]),
      ]))
      const identitesAvant = identiteColonnes(avant.colonnes)
      const identitesApres = identiteColonnes(apres.colonnes)
      const change = (nom: string) => identitesAvant.get(nom) !== identitesApres.get(nom)
      for (const dependante of dependantes) {
        const colonne = colonnesUtilisees(dependante, cle).find(change)
        if (colonne) {
          throw new ErreurJointure('La colonne « ' + colonne + ' » est utilisée par « ' + dependante.titre + ' ». Conservez-la pour enregistrer.')
        }
      }
      const colonnePubliee = publication && colonnesUtiliseesParCatalogue(publication.definition).find(change)
      if (colonnePubliee) {
        throw new ErreurJointure('La colonne « ' + colonnePubliee + ' » est utilisée par le catalogue métier. Mettez le catalogue à jour avant de la remplacer.')
      }
      const colonnePolitique = regle && [...regle.masquer, ...(regle.filtre ? [regle.filtre.colonne] : [])].find(change)
      if (colonnePolitique) {
        throw new ErreurJointure('La colonne « ' + colonnePolitique + ' » est utilisée par les droits d’accès. Mettez ces droits à jour avant de la remplacer.')
      }
    }
    await tx.$executeRaw`
      UPDATE warehouse.combinaisons SET definition = ${JSON.stringify(spec)}::jsonb WHERE cle = ${cle}
    `
  })
}

const MAX_LIGNES_APERCU = 20
const MAX_CARACTERES_CELLULE = 300

export async function previsualiserCombinaison(entree: unknown, contexte: ContexteExecution) {
  const spec = SelectionJointureSchema.parse(entree)
  const { entrees, colonnes, requete, diagnostic, numeriques } = compilerJointure(spec, await registreAutorise(contexte))
  const indicateur = citer(INDICATEUR_CORRESPONDANCE)
  // Borne aussi la taille des cellules avant de transférer le résultat vers le navigateur.
  const champs = colonnes.map(({ nom }) => {
    const colonne = citer(nom)
    return Prisma.sql`CASE WHEN char_length(a.${colonne}::text) > ${MAX_CARACTERES_CELLULE}
      THEN left(a.${colonne}::text, ${MAX_CARACTERES_CELLULE}::int) || '…' ELSE a.${colonne}::text END AS ${colonne}`
  })
  const sql = Prisma.sql`
    SELECT ${Prisma.join(champs)}, a.${indicateur}
    FROM (${requete(contexte, true)}) AS a LIMIT ${MAX_LIGNES_APERCU + 1}
  `
  const { resultats: [lignes, [statistiques]] } = await lireEntrepot(
    [sql, diagnostic(contexte)], [entrees.gauche.vue, entrees.droite.vue],
  )
  const valeur = (cle: string) => typeof statistiques[cle] === 'string' ? statistiques[cle] as string : null
  const statsCote = (cote: 'gauche' | 'droite') => ({
    lignes: valeur(cote + '_lignes') ?? '0',
    correspondances: valeur(cote + '_correspondances') ?? '0',
    sansCorrespondance: valeur(cote + '_sans_correspondance') ?? '0',
    lignesCleNulle: valeur(cote + '_lignes_cle_nulle') ?? '0',
    clesDupliquees: valeur(cote + '_cles_dupliquees') ?? '0',
    lignesMultipliees: valeur(cote + '_lignes_multipliees') ?? '0',
  })
  return {
    colonnes,
    lignes: lignes.slice(0, MAX_LIGNES_APERCU).map(ligne => ({
      cellules: colonnes.map(c => typeof ligne[c.nom] === 'string' ? ligne[c.nom] as string : null),
      correspondance: ligne[INDICATEUR_CORRESPONDANCE] === true,
    })),
    tronque: lignes.length > MAX_LIGNES_APERCU,
    diagnostic: {
      resultat: valeur('resultat') ?? '0',
      gauche: statsCote('gauche'),
      droite: statsCote('droite'),
      totaux: numeriques.map(({ cote, sortie }, index) => ({
        cote, colonne: sortie, avant: valeur('avant' + index), apres: valeur('apres' + index),
      })),
    },
  }
}

export async function jeuxPourCombinaison() {
  const registre = await registrePostgres()
  return registre.map(({ jeu, vue }) => ({
    cle: jeu.cle,
    titre: jeu.libelle.fr,
    sources: [...new Set(vue.snapshots?.map(copie => copie.source) ?? [])],
    colonnes: vue.colonnes.map(({ nom, type, description }) => ({ nom, type, description })),
  }))
}

export async function listerCombinaisons() {
  const combinaisons = await lireJointures()
  if (!combinaisons.length) return []
  const registre = await registrePostgres(combinaisons)
  const titres = new Map(registre.map(e => [e.jeu.cle, e.jeu.libelle.fr]))
  return combinaisons.map(({ cle, titre, type, gauche, droite, liens, colonnes }) => ({
    cle, titre, type, gauche: titres.get(gauche) ?? gauche, droite: titres.get(droite) ?? droite,
    liens: liens.length, colonnes: colonnes.length, disponible: titres.has(cle),
  }))
}
