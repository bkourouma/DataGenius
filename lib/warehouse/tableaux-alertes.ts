import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { urlApplication } from '@/lib/mail/gabarit'
import { envoyerMail } from '@/lib/mail/transport'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { composerEmailAlerte, composerNotificationAlerte } from '@/lib/notifications/email-alerte'
import { envoyerWebhook } from '@/lib/notifications/webhook'
import { ErreurTableau, calculerTuile } from './tableaux'
import { DefinitionTableauSchema, type DefinitionTableau, type TuileMesure } from './tableaux-modeles'

const DOMAINE = 'alertes_tableaux'

export class ErreurAlerte extends Error {}

/**
 * Garde de l’enregistrement : seul un TenantAdmin peut configurer un webhook d’alerte.
 * Un autre propriétaire peut re-enregistrer un tableau dont le webhook est inchangé (même tuile, même adresse) :
 * passer l’ancienne définition en 3e argument.
 */
export function verifierAlertesDefinition(contexte: ContexteExecution, definition: DefinitionTableau, ancienne?: DefinitionTableau): void {
  if (contexte.roleName === 'TenantAdmin') return
  const anciens = new Map<string, string>()
  for (const tuile of ancienne?.tuiles ?? []) {
    if (tuile.type === 'mesure' && tuile.alerte?.webhook) anciens.set(tuile.id, tuile.alerte.webhook)
  }
  for (const tuile of definition.tuiles) {
    if (tuile.type === 'mesure' && tuile.alerte?.webhook && anciens.get(tuile.id) !== tuile.alerte.webhook) {
      throw new ErreurAlerte('Seul un administrateur peut configurer un webhook d’alerte.')
    }
  }
}

export function listerAlertesTableaux(contexte: ContexteExecution) {
  return prisma.$queryRaw<{ id: string; tableau: string; date: Date; titre: string }[]>`
    SELECT n.id, t.id AS tableau, n."createdAt" AS date, t.definition ->> 'titre' AS titre
    FROM public.notifications AS n JOIN warehouse.tableaux AS t ON t.id::text = n."relatedEntityId"
    WHERE n."userId" = ${contexte.userId} AND n.type = 'tableau_alerte'
      AND (t.proprietaire_id = ${contexte.userId} OR EXISTS (
        SELECT 1 FROM warehouse.lecteurs_tableaux AS l WHERE l.tableau_id = t.id AND l.utilisateur_id = ${contexte.userId}))
    ORDER BY n."createdAt" DESC LIMIT 10
  `
}

type LigneTableau = { id: string; proprietaire_id: string; version: number; definition: unknown }
type Bilan = { tableaux: number; notifications: number; erreurs: number; emails: number; webhooks: number }

/** Destinataires : propriétaire, puis les destinataires désignés qui sont encore lecteurs (dédoublonnés). */
function destinataires(proprietaire: string, tuile: TuileMesure, lecteurs: Set<string>) {
  const ids = [proprietaire]
  for (const id of tuile.alerte?.destinataires ?? []) {
    if (id !== proprietaire && lecteurs.has(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}

async function envoyerEmail(tableau: LigneTableau, titre: string, tuile: TuileMesure, utilisateurId: string, contexte: ContexteExecution,
  calcul: { libelle: string; unite?: string | null; valeur: number | string }, bilan: Bilan) {
  try {
    const compte = await prisma.user.findUnique({ where: { id: utilisateurId }, select: { email: true, firstName: true, lastName: true } })
    if (!compte?.email) return
    const message = await composerEmailAlerte({
      locale: contexte.locale, tableau: titre, mesure: calcul.libelle, unite: calcul.unite, valeur: calcul.valeur,
      seuil: tuile.alerte!.seuil, sens: tuile.alerte!.sens,
      destinataireNom: `${compte.firstName} ${compte.lastName}`.trim(), url: `${urlApplication()}/tableaux/${tableau.id}`,
    })
    if (await envoyerMail({ to: compte.email, subject: message.sujet, html: message.html, text: message.texte })) bilan.emails++
  } catch {
    journal.avertissement('E-mail d’alerte non envoyé', { domaine: DOMAINE, raison: 'erreur' })
  }
}

async function envoyerAlerteWebhook(tableau: LigneTableau, titre: string, tuile: TuileMesure, proprietaire: ContexteExecution, declencheA: Date, bilan: Bilan) {
  const adresse = tuile.alerte?.webhook
  if (!adresse) return
  if (proprietaire.roleName !== 'TenantAdmin') {
    journal.avertissement('Webhook d’alerte ignoré', { domaine: DOMAINE, raison: 'proprietaire_non_administrateur' })
    return
  }
  try {
    const resultat = await envoyerWebhook(adresse, {
      evenement: 'tableau_alerte', tableau: { id: tableau.id, titre }, tuile: { id: tuile.id, mesure: tuile.mesure },
      sens: tuile.alerte!.sens, seuil: tuile.alerte!.seuil, declencheA: declencheA.toISOString(),
      lien: `${urlApplication()}/tableaux/${tableau.id}`,
    })
    if (resultat.ok) bilan.webhooks++
  } catch {
    journal.avertissement('Webhook d’alerte non envoyé', { domaine: DOMAINE, raison: 'erreur' })
  }
}

export async function traiterAlertesTableaux() {
  const tableaux = await prisma.$queryRaw<LigneTableau[]>`
    SELECT id, proprietaire_id, version, definition FROM warehouse.tableaux
    WHERE jsonb_path_exists(definition, '$.tuiles[*].alerte')
    ORDER BY alertes_verifie_a NULLS FIRST, id LIMIT 24
  `
  const bilan: Bilan = { tableaux: tableaux.length, notifications: 0, erreurs: 0, emails: 0, webhooks: 0 }
  for (const tableau of tableaux) {
    try {
      const definition = DefinitionTableauSchema.parse(tableau.definition)
      const lecteurs = new Set((await prisma.$queryRaw<{ utilisateur_id: string }[]>`
        SELECT utilisateur_id FROM warehouse.lecteurs_tableaux WHERE tableau_id = ${tableau.id}::uuid
      `).map(l => l.utilisateur_id))
      const registreBrut = await registrePostgres()
      const contextes = new Map<string, Promise<ContexteExecution | null>>()
      const contexteDe = (id: string) => {
        if (!contextes.has(id)) contextes.set(id, contexteDepuisCompte(id))
        return contextes.get(id)!
      }
      for (const tuile of definition.tuiles) {
        if (tuile.type !== 'mesure' || !tuile.alerte) continue
        const ids = destinataires(tableau.proprietaire_id, tuile, lecteurs)
        for (const utilisateurId of ids) {
          try {
            const contexte = await contexteDe(utilisateurId)
            if (!contexte) continue
            const verification = new Date()
            let calcul
            try {
              // Chaque destinataire est calculé avec son propre contexte : masques et filtres de lignes compris.
              calcul = await calculerTuile(tuile, contexte, undefined, false, registreBrut)
            } catch (erreur) {
              if (erreur instanceof ErreurTableau) continue
              throw erreur
            }
            const valeur = calcul.resultat.lignes[0]?.[tuile.mesure]
            if (typeof valeur !== 'number' && typeof valeur !== 'string') continue
            const quantite = new Prisma.Decimal(valeur)
            if (!quantite.isFinite()) continue
            const active = tuile.alerte.sens === 'au_dessus' ? quantite.gte(tuile.alerte.seuil) : quantite.lte(tuile.alerte.seuil)
            const texte = active ? await composerNotificationAlerte({
              locale: contexte.locale, tableau: definition.titre, mesure: calcul.libelle, unite: calcul.unite, valeur,
              seuil: tuile.alerte.seuil, sens: tuile.alerte.sens,
            }) : null
            const declenche = await prisma.$transaction(async tx => {
              const [courant] = await tx.$queryRaw<{ version: number }[]>`
                SELECT version FROM warehouse.tableaux WHERE id = ${tableau.id}::uuid FOR UPDATE
              `
              if (courant?.version !== tableau.version) return false
              const [precedent] = await tx.$queryRaw<{ etat: boolean; verifie_a: Date }[]>`
                SELECT etat, verifie_a FROM warehouse.etat_alertes_tableaux
                WHERE tableau_id = ${tableau.id}::uuid AND tuile_id = ${tuile.id}::uuid AND utilisateur_id = ${utilisateurId}
              `
              if (precedent && precedent.verifie_a >= verification) return false
              await tx.$executeRaw`
                INSERT INTO warehouse.etat_alertes_tableaux (tableau_id, tuile_id, utilisateur_id, etat, verifie_a)
                VALUES (${tableau.id}::uuid, ${tuile.id}::uuid, ${utilisateurId}, ${active}, ${verification})
                ON CONFLICT (tableau_id, tuile_id, utilisateur_id) DO UPDATE SET etat = EXCLUDED.etat, verifie_a = EXCLUDED.verifie_a
              `
              if (!active || precedent?.etat || !texte) return false
              await tx.notification.create({ data: {
                userId: utilisateurId, type: 'tableau_alerte', channel: 'in_app', status: 'sent',
                title: texte.titre, message: texte.message,
                relatedEntityType: 'tableau', relatedEntityId: tableau.id, sentAt: new Date(),
              } })
              return true
            })
            if (!declenche) continue
            bilan.notifications++
            if (tuile.alerte.email) {
              await envoyerEmail(tableau, definition.titre, tuile, utilisateurId, contexte,
                { libelle: calcul.libelle, unite: calcul.unite, valeur }, bilan)
            }
            if (utilisateurId === tableau.proprietaire_id) {
              await envoyerAlerteWebhook(tableau, definition.titre, tuile, contexte, verification, bilan)
            }
          } catch {
            bilan.erreurs++
            journal.erreur('Alerte de tableau en erreur', { domaine: DOMAINE, etape: 'destinataire' })
          }
        }
        // Retire l’état des utilisateurs qui ne sont plus destinataires de cette tuile.
        try {
          await prisma.$transaction(async tx => {
            const [courant] = await tx.$queryRaw<{ version: number }[]>`
              SELECT version FROM warehouse.tableaux WHERE id = ${tableau.id}::uuid FOR UPDATE
            `
            if (courant?.version !== tableau.version) return
            await tx.$executeRaw`
              DELETE FROM warehouse.etat_alertes_tableaux
              WHERE tableau_id = ${tableau.id}::uuid AND tuile_id = ${tuile.id}::uuid AND utilisateur_id <> ALL(${ids})
            `
          })
        } catch {
          bilan.erreurs++
          journal.erreur('Alerte de tableau en erreur', { domaine: DOMAINE, etape: 'nettoyage' })
        }
      }
    } catch {
      bilan.erreurs++
      journal.erreur('Alerte de tableau en erreur', { domaine: DOMAINE, etape: 'tableau' })
    } finally {
      await prisma.$executeRaw`
        UPDATE warehouse.tableaux SET alertes_verifie_a = clock_timestamp()
        WHERE id = ${tableau.id}::uuid AND version = ${tableau.version}
      `
    }
  }
  return bilan
}
