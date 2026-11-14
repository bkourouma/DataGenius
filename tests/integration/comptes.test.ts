import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const courriels = vi.hoisted(() => [] as { to: string; text: string }[])
const etatMail = vi.hoisted(() => ({ accepte: true }))
vi.mock('@/lib/mail/transport', () => ({
  mailConfigure: () => true,
  envoyerMail: vi.fn(async (message: { to: string | string[]; text: string }) => {
    courriels.push({ to: String(message.to), text: message.text })
    return etatMail.accepte
  }),
}))

import { prisma } from '@/lib/db/client'
import { getAccessScope } from '@/lib/auth/access-scope'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import {
  ErreurComptes, changerRoleCompte, definirMotDePasse, demanderReinitialisation, desactiverCompte,
  inviterUtilisateur, listerComptes, reactiverCompte, renvoyerInvitation, verifierJeton,
} from '@/lib/auth/comptes'

const MDP_1 = 'Mot-de-passe-fictif-1'
const MDP_2 = 'Mot-de-passe-fictif-2'
const MDP_3 = 'Mot-de-passe-fictif-3'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Comptes : invitation, réinitialisation, désactivation', { timeout: 60_000 }, () => {
  const ids: string[] = []
  const unique = (prefixe: string) => `${prefixe}-${randomUUID()}@example.test`

  beforeEach(() => {
    courriels.length = 0
    etatMail.accepte = true
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3120')
  })
  afterAll(async () => {
    vi.unstubAllEnvs()
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  async function creerCompte(roleName: string, status = 'active', motDePasse: string | null = MDP_1) {
    const compte = await prisma.user.create({ data: {
      email: unique(roleName.toLowerCase()), firstName: 'Fictif', roleName, status,
      passwordHash: motDePasse ? await hashPassword(motDePasse) : '!',
    } })
    ids.push(compte.id)
    return compte
  }
  const jetonDuLien = (lien: string) => new URL(lien).searchParams.get('jeton')!
  async function jetonEnvoye(email: string) {
    await vi.waitFor(() => expect(courriels.some(c => c.to === email)).toBe(true))
    const dernier = [...courriels].reverse().find(c => c.to === email)!
    return /jeton=([\w-]+)/.exec(dernier.text)![1]
  }
  async function enregistrerInvite(acteurId: string, email: string) {
    const resultat = await inviterUtilisateur(acteurId, { email, prenom: 'Awa', nom: 'Test', role: 'Member' })
    const compte = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } })
    ids.push(compte.id)
    return { ...resultat, compte, jeton: jetonDuLien(resultat.lien) }
  }

  it('invite, active par mot de passe, refuse la réutilisation et le jeton expiré', async () => {
    const admin = await creerCompte('TenantAdmin')
    const email = unique('invite')
    const { lien, envoye, compte, jeton } = await enregistrerInvite(admin.id, email.toUpperCase())
    expect(envoye).toBe(true)
    expect(lien.startsWith('http://localhost:3120/definir-mot-de-passe?jeton=')).toBe(true)
    expect(compte).toMatchObject({ email, status: 'invited', passwordHash: '!', roleName: 'Member' })
    expect(verifyPassword(MDP_1, compte.passwordHash)).toBe(false)
    await expect(getAccessScope(compte.id)).resolves.toBeNull()
    const stocke = await prisma.compteJeton.findMany({ where: { userId: compte.id } })
    expect(stocke).toHaveLength(1)
    expect(stocke[0]).toMatchObject({ type: 'invitation', creePar: admin.id, utiliseA: null })
    expect(JSON.stringify(stocke)).not.toContain(jeton)
    expect(stocke[0].expireA.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000)

    const liste = (await listerComptes()).find(c => c.id === compte.id)!
    expect(liste).toMatchObject({ statut: 'invite', oidc: false, groupes: [] })
    expect(liste.invitationExpireA).toEqual(stocke[0].expireA)
    await expect(inviterUtilisateur(admin.id, { email, prenom: 'X', nom: '', role: 'Member' })).rejects.toBeInstanceOf(ErreurComptes)

    await expect(verifierJeton(jeton)).resolves.toEqual({ valide: true, type: 'invitation', prenom: 'Awa' })
    await expect(definirMotDePasse(jeton, 'court')).rejects.toBeInstanceOf(ErreurComptes)
    await expect(verifierJeton(jeton)).resolves.toMatchObject({ valide: true })
    await definirMotDePasse(jeton, MDP_1)
    const actif = await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })
    expect(actif.status).toBe('active')
    expect(await verifyPassword(MDP_1, actif.passwordHash)).toBe(true)
    await expect(getAccessScope(compte.id)).resolves.not.toBeNull()
    await expect(verifierJeton(jeton)).resolves.toEqual({ valide: false })
    await expect(definirMotDePasse(jeton, MDP_2)).rejects.toThrow('invalide ou a expiré')

    const autre = await enregistrerInvite(admin.id, unique('expire'))
    await prisma.compteJeton.updateMany({ where: { userId: autre.compte.id }, data: { expireA: new Date(Date.now() - 1000) } })
    await expect(verifierJeton(autre.jeton)).resolves.toEqual({ valide: false })
    await expect(definirMotDePasse(autre.jeton, MDP_1)).rejects.toThrow('invalide ou a expiré')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: autre.compte.id } })).status).toBe('invited')
  })

  it("renvoie l'invitation en invalidant l'ancienne, rapporte un envoi refusé et exige un compte invité", async () => {
    const admin = await creerCompte('TenantAdmin')
    etatMail.accepte = false
    const { compte, jeton, envoye } = await enregistrerInvite(admin.id, unique('renvoi'))
    expect(envoye).toBe(false)
    const renvoi = await renvoyerInvitation(admin.id, compte.id)
    const nouveau = jetonDuLien(renvoi.lien)
    expect(nouveau).not.toBe(jeton)
    await expect(verifierJeton(jeton)).resolves.toEqual({ valide: false })
    await expect(verifierJeton(nouveau)).resolves.toMatchObject({ valide: true })
    await expect(renvoyerInvitation(admin.id, admin.id)).rejects.toBeInstanceOf(ErreurComptes)
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('APP_URL', '')
    const avant = await prisma.user.count()
    await expect(inviterUtilisateur(admin.id, { email: unique('sans-url'), prenom: 'A', nom: '', role: 'Member' }))
      .rejects.toThrow("NEXTAUTH_URL n'est pas configurée")
    expect(await prisma.user.count()).toBe(avant)
  })

  it('réinitialise un mot de passe, invalide les autres jetons et limite à 3 demandes par heure', async () => {
    const admin = await creerCompte('TenantAdmin')
    const { compte, jeton: invitation } = await enregistrerInvite(admin.id, unique('reinit'))
    await definirMotDePasse(invitation, MDP_1)
    await expect(demanderReinitialisation(compte.email.toUpperCase())).resolves.toBeUndefined()
    const reinit = await jetonEnvoye(compte.email)
    await expect(verifierJeton(reinit)).resolves.toEqual({ valide: true, type: 'reinitialisation', prenom: 'Awa' })
    await expect(verifierJeton(invitation)).resolves.toEqual({ valide: false })
    await definirMotDePasse(reinit, MDP_2)
    const apres = await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })
    expect(await verifyPassword(MDP_2, apres.passwordHash)).toBe(true)
    expect(await verifyPassword(MDP_1, apres.passwordHash)).toBe(false)
    await expect(definirMotDePasse(reinit, MDP_3)).rejects.toBeInstanceOf(ErreurComptes)

    // La première demande compte dans la limite : 2 de plus créent 3 jetons, la 4e ne crée rien.
    await demanderReinitialisation(compte.email)
    await demanderReinitialisation(compte.email)
    await demanderReinitialisation(compte.email)
    await demanderReinitialisation(compte.email)
    const jetons = await prisma.compteJeton.count({ where: { userId: compte.id, type: 'reinitialisation' } })
    expect(jetons).toBe(3)
    await vi.waitFor(() => expect(courriels.filter(c => c.to === compte.email && c.text.includes('réinitialisation'))).toHaveLength(3))

    await expect(demanderReinitialisation(unique('inconnu'))).resolves.toBeUndefined()
    await expect(demanderReinitialisation('invalide')).resolves.toBeUndefined()
  })

  it("ne crée aucun jeton pour un compte lié à OIDC, invité ou désactivé", async () => {
    const admin = await creerCompte('TenantAdmin')
    const oidc = await creerCompte('Member')
    const emetteur = 'https://identite.example.test/' + randomUUID()
    await prisma.$executeRaw`INSERT INTO public.identites_oidc (emetteur, sujet, utilisateur_id) VALUES (${emetteur}, 'sujet-comptes', ${oidc.id})`
    try {
      await expect(demanderReinitialisation(oidc.email)).resolves.toBeUndefined()
      expect((await listerComptes()).find(c => c.id === oidc.id)!.oidc).toBe(true)
    } finally {
      await prisma.$executeRaw`DELETE FROM public.identites_oidc WHERE emetteur = ${emetteur}`
    }
    const invite = await enregistrerInvite(admin.id, unique('invite-reinit'))
    const desactive = await creerCompte('Member', 'disabled')
    await demanderReinitialisation(invite.compte.email)
    await demanderReinitialisation(desactive.email)
    expect(await prisma.compteJeton.count({
      where: { userId: { in: [oidc.id, desactive.id] }, type: 'reinitialisation' },
    })).toBe(0)
    expect(await prisma.compteJeton.count({ where: { userId: invite.compte.id, type: 'reinitialisation' } })).toBe(0)
    expect(courriels.filter(c => [oidc.email, desactive.email, invite.compte.email].includes(c.to)
      && !c.text.includes('invit'))).toHaveLength(0)
  })

  it('désactive et réactive un compte, en retombant sur « invité » sans mot de passe', async () => {
    const admin = await creerCompte('TenantAdmin')
    const membre = await creerCompte('Member')
    await desactiverCompte(admin.id, membre.id)
    await expect(getAccessScope(membre.id)).resolves.toBeNull()
    expect((await listerComptes()).find(c => c.id === membre.id)!.statut).toBe('desactive')
    await expect(desactiverCompte(admin.id, membre.id)).rejects.toBeInstanceOf(ErreurComptes)
    await changerRoleCompte(admin.id, membre.id, 'TenantAdmin')
    await changerRoleCompte(admin.id, membre.id, 'Member')
    await reactiverCompte(admin.id, membre.id)
    await expect(getAccessScope(membre.id)).resolves.not.toBeNull()
    await expect(reactiverCompte(admin.id, membre.id)).rejects.toBeInstanceOf(ErreurComptes)

    const invite = await enregistrerInvite(admin.id, unique('invite-desactive'))
    await desactiverCompte(admin.id, invite.compte.id)
    await expect(verifierJeton(invite.jeton)).resolves.toEqual({ valide: false })
    await reactiverCompte(admin.id, invite.compte.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invite.compte.id } })).status).toBe('invited')
    const renvoi = await renvoyerInvitation(admin.id, invite.compte.id)
    await expect(verifierJeton(jetonDuLien(renvoi.lien))).resolves.toMatchObject({ valide: true })
  })

  it('protège le dernier administrateur actif et refuse l’auto-désactivation', async () => {
    const a = await creerCompte('TenantAdmin')
    const b = await creerCompte('TenantAdmin')
    const compter = () => prisma.user.count({ where: { roleName: 'TenantAdmin', status: 'active', deletedAt: null } })
    // Situation déterministe : les autres administrateurs actifs de la base (laissés par d'autres tests) sont
    // désactivés le temps du test puis rétablis. Les fichiers d'intégration tournent à la suite, jamais en parallèle.
    const autres = (await prisma.user.findMany({
      where: { roleName: 'TenantAdmin', status: 'active', deletedAt: null, id: { notIn: [a.id, b.id] } }, select: { id: true },
    })).map(u => u.id)
    await prisma.user.updateMany({ where: { id: { in: autres } }, data: { status: 'disabled' } })
    try {
      expect(await compter()).toBe(2)
      await expect(desactiverCompte(a.id, a.id)).rejects.toThrow('propre compte')
      expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('active')

      await desactiverCompte(a.id, b.id)
      expect(await compter()).toBe(1)
      // Il ne reste que « a » : plus rien ne doit pouvoir le retirer.
      await expect(desactiverCompte(b.id, a.id)).rejects.toThrow('dernier administrateur')
      await expect(changerRoleCompte(b.id, a.id, 'Member')).rejects.toThrow('dernier administrateur')
      await expect(changerRoleCompte(a.id, a.id, 'Member')).rejects.toThrow('propre rôle')
      expect(await compter()).toBe(1)

      await reactiverCompte(a.id, b.id)
      expect(await compter()).toBe(2)
      // Deux administrateurs actifs : on peut rétrograder l'un d'eux.
      await changerRoleCompte(a.id, b.id, 'Member')
      expect(await compter()).toBe(1)
      await expect(changerRoleCompte(a.id, b.id, 'Inconnu')).rejects.toBeInstanceOf(ErreurComptes)
    } finally {
      await prisma.user.updateMany({ where: { id: { in: autres } }, data: { status: 'active' } })
    }
  })
})
