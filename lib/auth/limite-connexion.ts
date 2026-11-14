import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'

export const FENETRE_MINUTES = 15
export const SEUIL_EMAIL = 5
export const SEUIL_IP = 30
const INTERVALLE_PURGE_MS = 10 * 60_000
const SAUTS_MAX = 10

/**
 * `echecs` compte les tentatives RÉSERVÉES dans la fenêtre. Une tentative est autorisée tant que
 * `echecs <= seuil` ; la suivante pose le blocage et est refusée, ainsi que toutes celles qui
 * arrivent pendant le blocage (le compteur n'avance plus et le blocage n'est pas prolongé).
 */
export type EtatTentative = { echecs: number, bloqueJusqua: Date | null }

/** Stockage des compteurs : PostgreSQL en production, un faux stockage en mémoire dans les tests. */
export interface MagasinTentatives {
  /** Réserve atomiquement une tentative (incrément) et renvoie l'état après incrément. */
  enregistrer(cle: string, seuil: number): Promise<EtatTentative>
  /** Rend une tentative réservée (succès de connexion : le compteur IP ne compte que les échecs). */
  liberer(cle: string): Promise<void>
  supprimer(cle: string): Promise<void>
  /** Supprime les lignes dont la fenêtre a expiré et sans blocage actif. */
  purger(): Promise<void>
}

type EnTetes = Headers | Record<string, string | string[] | undefined> | null | undefined

const hacher = (valeur: string) => createHash('sha256').update(valeur).digest('hex')
export const cleEmail = (email: string) => hacher('email:' + email.trim().toLowerCase())
export const cleIp = (ip: string) => hacher('ip:' + ip.trim())

/**
 * Nombre de sauts de proxy de confiance (DATAGENIUS_PROXY_DE_CONFIANCE). Absent, invalide ou 0 :
 * les en-têtes d'IP sont ignorés (un client peut les forger) et seule la limite par e-mail s'applique.
 */
export function sautsProxyDeConfiance(): number {
  const valeur = Number(process.env.DATAGENIUS_PROXY_DE_CONFIANCE ?? '0')
  return Number.isInteger(valeur) && valeur >= 1 ? Math.min(valeur, SAUTS_MAX) : 0
}

function ipValide(candidat: string | undefined): string | undefined {
  const ip = candidat?.trim()
  return ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : undefined
}

/**
 * IP du client vue par le N-ième proxy de confiance : N-ième élément de x-forwarded-for en partant
 * de la DROITE (les éléments de gauche sont fournis par le client). x-real-ip n'est lu que dans ce
 * mode. Sans proxy de confiance (`sauts` < 1) : undefined.
 */
export function extraireIp(enTetes: EnTetes, sauts: number): string | undefined {
  if (!enTetes || !Number.isInteger(sauts) || sauts < 1) return undefined
  const lire = (nom: string): string | undefined => {
    const brut = typeof (enTetes as Headers).get === 'function'
      ? (enTetes as Headers).get(nom)
      : (enTetes as Record<string, string | string[] | undefined>)[nom]
    return (Array.isArray(brut) ? brut.join(',') : brut) ?? undefined
  }
  const chaine = lire('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  if (chaine.length >= sauts) return ipValide(chaine[chaine.length - sauts])
  if (chaine.length === 0) return ipValide(lire('x-real-ip'))
  return undefined
}

export const magasinPrisma: MagasinTentatives = {
  async enregistrer(cle, seuil) {
    // Un seul upsert atomique. Horodatages en UTC (colonnes timestamp(3) sans fuseau).
    // Pendant un blocage actif la ligne n'est pas modifiée ; fenêtre expirée sans blocage : retour à 1.
    const lignes = await prisma.$queryRaw<{ echecs: number, bloqueJusqua: Date | null }[]>`
      INSERT INTO auth_tentatives AS t (cle, echecs, "fenetreDebut", "bloqueJusqua", "updatedAt")
      VALUES (${cle}, 1, now() AT TIME ZONE 'UTC', NULL, now() AT TIME ZONE 'UTC')
      ON CONFLICT (cle) DO UPDATE SET
        echecs = CASE
          WHEN t."bloqueJusqua" > now() AT TIME ZONE 'UTC' THEN t.echecs
          WHEN t."fenetreDebut" + ${FENETRE_MINUTES}::int * interval '1 minute' <= now() AT TIME ZONE 'UTC' THEN 1
          ELSE t.echecs + 1 END,
        "fenetreDebut" = CASE
          WHEN t."bloqueJusqua" > now() AT TIME ZONE 'UTC' THEN t."fenetreDebut"
          WHEN t."fenetreDebut" + ${FENETRE_MINUTES}::int * interval '1 minute' <= now() AT TIME ZONE 'UTC'
            THEN now() AT TIME ZONE 'UTC'
          ELSE t."fenetreDebut" END,
        "bloqueJusqua" = CASE
          WHEN t."bloqueJusqua" > now() AT TIME ZONE 'UTC' THEN t."bloqueJusqua"
          WHEN t."fenetreDebut" + ${FENETRE_MINUTES}::int * interval '1 minute' <= now() AT TIME ZONE 'UTC' THEN NULL
          WHEN t.echecs + 1 > ${seuil}::int
            THEN (now() AT TIME ZONE 'UTC') + ${FENETRE_MINUTES}::int * interval '1 minute'
          ELSE NULL END,
        "updatedAt" = now() AT TIME ZONE 'UTC'
      RETURNING echecs, "bloqueJusqua"`
    return lignes[0] ?? { echecs: 0, bloqueJusqua: null }
  },
  async liberer(cle) {
    await prisma.$executeRaw`
      UPDATE auth_tentatives SET echecs = GREATEST(echecs - 1, 0)
      WHERE cle = ${cle} AND ("bloqueJusqua" IS NULL OR "bloqueJusqua" <= now() AT TIME ZONE 'UTC')`
  },
  async supprimer(cle) {
    await prisma.$executeRaw`DELETE FROM auth_tentatives WHERE cle = ${cle}`
  },
  async purger() {
    await prisma.$executeRaw`
      DELETE FROM auth_tentatives
      WHERE "fenetreDebut" + ${FENETRE_MINUTES}::int * interval '1 minute' <= now() AT TIME ZONE 'UTC'
        AND ("bloqueJusqua" IS NULL OR "bloqueJusqua" <= now() AT TIME ZONE 'UTC')`
  },
}

function journaliser(evenement: string, cle?: string, erreur?: unknown) {
  journal.avertissement('Événement du limiteur de connexion', {
    domaine: 'auth',
    evenement,
    empreinte: cle?.slice(0, 12),
    erreur: erreur instanceof Error ? erreur.name : undefined,
  })
}

type Cible = { email?: string, ip?: string }

function cles({ email, ip }: Cible) {
  return [
    ...(email ? [{ cle: cleEmail(email), seuil: SEUIL_EMAIL }] : []),
    ...(ip ? [{ cle: cleIp(ip), seuil: SEUIL_IP }] : []),
  ]
}

// Dernière purge par stockage (au plus une toutes les 10 minutes et par processus).
const dernieresPurges = new WeakMap<MagasinTentatives, number>()

async function purgerSiNecessaire(magasin: MagasinTentatives) {
  const maintenant = Date.now()
  if (maintenant - (dernieresPurges.get(magasin) ?? 0) < INTERVALLE_PURGE_MS) return
  dernieresPurges.set(magasin, maintenant)
  try {
    await magasin.purger()
  } catch (erreur) {
    journaliser('purge_impossible', undefined, erreur)
  }
}

/**
 * Réserve une tentative de connexion AVANT tout calcul de hachage, par un incrément atomique
 * (la tentative compte comme un échec provisoire ; `reinitialiser` l'annule sur succès). Renvoie
 * false quand la limite est dépassée : l'appelant refuse sans hacher. Des requêtes simultanées ne
 * peuvent donc pas dépasser le seuil (au plus SEUIL_EMAIL hachages par e-mail et par fenêtre).
 *
 * Si la base est indisponible (table absente comprise : appliquer `prisma migrate deploy`), le
 * limiteur échoue ouvert : événement `limiteur_indisponible` journalisé, tentative autorisée.
 * Échouer fermé bloquerait tous les comptes pour une panne qui n'est pas une attaque.
 */
export async function reserverTentative(cible: Cible, magasin: MagasinTentatives = magasinPrisma): Promise<boolean> {
  const liste = cles(cible)
  if (liste.length === 0) return true
  await purgerSiNecessaire(magasin)
  try {
    const etats = await Promise.all(liste.map(async ({ cle, seuil }) => ({ cle, seuil, etat: await magasin.enregistrer(cle, seuil) })))
    const depasse = etats.find(({ etat, seuil }) => etat.echecs > seuil)
    if (depasse) journaliser('connexion_bloquee', depasse.cle)
    return !depasse
  } catch (erreur) {
    journaliser('limiteur_indisponible', undefined, erreur)
    return true
  }
}

/** Succès : efface le compteur e-mail et rend la tentative réservée sur l'IP (qui ne compte que les échecs). */
export async function reinitialiser({ email, ip }: Cible, magasin: MagasinTentatives = magasinPrisma): Promise<void> {
  try {
    if (email) await magasin.supprimer(cleEmail(email))
    if (ip) await magasin.liberer(cleIp(ip))
  } catch (erreur) {
    journaliser('limiteur_indisponible', undefined, erreur)
  }
}
