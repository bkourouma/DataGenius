import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ROLES_SIEGE_MEDIC_ASSIST } from '@/lib/medic-assist/contrats/droits'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { jsonPrive } from './http'

const autorisation = /^Bearer (dg_read_[a-f0-9]{64})$/i
const libelleSchema = z.string().trim().min(1).max(100)
const dureeSchema = z.number().int().min(1).max(90)
const idSchema = z.string().uuid()

const empreinte = (secret: string) => createHash('sha256').update(secret).digest('hex')

async function insererCle(tx: Prisma.TransactionClient, utilisateur: string, libelle: string, jours: number) {
  const id = randomUUID()
  const secret = 'dg_read_' + randomBytes(32).toString('hex')
  const [resultat] = await tx.$queryRaw<{ expireA: Date }[]>`
    INSERT INTO warehouse.cles_api (id, empreinte, utilisateur_id, libelle, expire_a)
    VALUES (${id}::uuid, ${empreinte(secret)}, ${utilisateur}, ${libelle}, clock_timestamp() + make_interval(days => ${jours}::integer))
    RETURNING expire_a AS "expireA"
  `
  return { id, secret, expireA: resultat.expireA }
}

export async function creerCleApi(utilisateur: string, libelle: string, jours = 30) {
  const nom = libelleSchema.parse(libelle)
  const duree = dureeSchema.parse(jours)
  if (!await contexteDepuisCompte(utilisateur)) throw new Error('Compte Data Genius indisponible.')
  return prisma.$transaction(tx => insererCle(tx, utilisateur, nom, duree))
}

export async function revoquerCleApi(cle: string) {
  const id = idSchema.parse(cle)
  return Boolean(await prisma.$executeRaw`
    UPDATE warehouse.cles_api SET revoque_a = clock_timestamp() WHERE id = ${id}::uuid AND revoque_a IS NULL
  `)
}

export async function tournerCleApi(cle: string, jours = 30) {
  const id = idSchema.parse(cle)
  const duree = dureeSchema.parse(jours)
  return prisma.$transaction(async tx => {
    const [precedente] = await tx.$queryRaw<{ utilisateur: string; libelle: string }[]>`
      UPDATE warehouse.cles_api SET revoque_a = clock_timestamp()
      WHERE id = ${id}::uuid AND revoque_a IS NULL
        AND EXISTS (SELECT 1 FROM public.users WHERE id = utilisateur_id AND status = 'active'
          AND "deletedAt" IS NULL AND "roleName" IN (${Prisma.join([...ROLES_SIEGE_MEDIC_ASSIST])}))
      RETURNING utilisateur_id AS utilisateur, libelle
    `
    if (!precedente) throw new Error('Clé ou compte Data Genius indisponible.')
    return insererCle(tx, precedente.utilisateur, precedente.libelle, duree)
  })
}

export async function exigerLectureApi(request: Request) {
  const entete = request.headers.get('authorization')
  if (entete == null) return exigerMedicAssist()
  const secret = autorisation.exec(entete)?.[1]
  if (secret) {
    const [cle] = await prisma.$queryRaw<{ utilisateur: string }[]>`
      SELECT utilisateur_id AS utilisateur FROM warehouse.cles_api
      WHERE empreinte = ${empreinte(secret)} AND revoque_a IS NULL AND expire_a > clock_timestamp()
    `
    const contexte = cle && await contexteDepuisCompte(cle.utilisateur)
    if (contexte) return { ok: true as const, contexte }
  }
  return { ok: false as const, reponse: jsonPrive({ erreur: 'cle_invalide' }, 401, { 'WWW-Authenticate': 'Bearer' }) }
}
