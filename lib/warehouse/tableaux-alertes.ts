import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { calculerTuile } from './tableaux'
import { DefinitionTableauSchema } from './tableaux-modeles'

export function listerAlertesTableaux(contexte: ContexteExecution) {
  return prisma.$queryRaw<{ id: string; tableau: string; date: Date; titre: string }[]>`
    SELECT n.id, t.id AS tableau, n."createdAt" AS date, t.definition ->> 'titre' AS titre
    FROM public.notifications AS n JOIN warehouse.tableaux AS t ON t.id::text = n."relatedEntityId"
    WHERE n."userId" = ${contexte.userId} AND n.type = 'tableau_alerte'
      AND t.proprietaire_id = ${contexte.userId}
    ORDER BY n."createdAt" DESC LIMIT 10
  `
}

export async function traiterAlertesTableaux() {
  const tableaux = await prisma.$queryRaw<{ id: string; proprietaire_id: string; version: number; definition: unknown }[]>`
    SELECT id, proprietaire_id, version, definition FROM warehouse.tableaux
    WHERE jsonb_path_exists(definition, '$.tuiles[*].alerte')
    ORDER BY alertes_verifie_a NULLS FIRST, id LIMIT 24
  `
  const bilan = { tableaux: tableaux.length, notifications: 0, erreurs: 0 }
  for (const tableau of tableaux) {
    try {
      const definition = DefinitionTableauSchema.parse(tableau.definition)
      const contexte = await contexteDepuisCompte(tableau.proprietaire_id)
      if (!contexte) continue
      for (const tuile of definition.tuiles) {
        if (tuile.type !== 'mesure' || !tuile.alerte) continue
        try {
          const verification = new Date()
          const { resultat } = await calculerTuile(tuile, contexte)
          const valeur = resultat.lignes[0]?.[tuile.mesure]
          if (typeof valeur !== 'number' && typeof valeur !== 'string') continue
          const quantite = new Prisma.Decimal(valeur)
          if (!quantite.isFinite()) continue
          const active = tuile.alerte.sens === 'au_dessus' ? quantite.gte(tuile.alerte.seuil) : quantite.lte(tuile.alerte.seuil)
          bilan.notifications += await prisma.$transaction(async tx => {
            const [courant] = await tx.$queryRaw<{ version: number }[]>`
              SELECT version FROM warehouse.tableaux WHERE id = ${tableau.id}::uuid FOR UPDATE
            `
            if (courant?.version !== tableau.version) return 0
            const [precedent] = await tx.$queryRaw<{ etat: boolean; verifie_a: Date }[]>`
              SELECT etat, verifie_a FROM warehouse.etat_alertes_tableaux
              WHERE tableau_id = ${tableau.id}::uuid AND tuile_id = ${tuile.id}::uuid
            `
            if (precedent && precedent.verifie_a >= verification) return 0
            await tx.$executeRaw`
              INSERT INTO warehouse.etat_alertes_tableaux (tableau_id, tuile_id, etat, verifie_a)
              VALUES (${tableau.id}::uuid, ${tuile.id}::uuid, ${active}, ${verification})
              ON CONFLICT (tableau_id, tuile_id) DO UPDATE SET etat = EXCLUDED.etat, verifie_a = EXCLUDED.verifie_a
            `
            if (!active || precedent?.etat) return 0
            await tx.notification.create({ data: {
              userId: tableau.proprietaire_id, type: 'tableau_alerte', channel: 'in_app', status: 'sent',
              title: 'Seuil d’un tableau de bord atteint', message: 'Consultez vos tableaux de bord pour voir le résultat.',
              relatedEntityType: 'tableau', relatedEntityId: tableau.id, sentAt: new Date(),
            } })
            return 1
          })
        } catch {
          bilan.erreurs++
        }
      }
    } catch {
      bilan.erreurs++
    } finally {
      await prisma.$executeRaw`
        UPDATE warehouse.tableaux SET alertes_verifie_a = clock_timestamp()
        WHERE id = ${tableau.id}::uuid AND version = ${tableau.version}
      `
    }
  }
  return bilan
}
