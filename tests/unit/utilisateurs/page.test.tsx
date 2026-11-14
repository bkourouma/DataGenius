import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((chemin: string) => { throw new Error(`REDIRECT:${chemin}`) }),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: vi.fn() }))
vi.mock('@/lib/auth/comptes', () => ({ listerComptes: vi.fn(async () => []) }))
vi.mock('@/app/(dashboard)/utilisateurs/actions', () => ({
  inviter: vi.fn(), renvoyer: vi.fn(), desactiver: vi.fn(), reactiver: vi.fn(), changerRole: vi.fn(),
}))

import UtilisateursPage from '@/app/(dashboard)/utilisateurs/page'
import { listerComptes } from '@/lib/auth/comptes'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'

describe('page Utilisateurs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirige sans lister les comptes si la garde refuse', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: false, reponse: {} } as never)
    await expect(UtilisateursPage()).rejects.toThrow('REDIRECT:/medic-assist')
    expect(listerComptes).not.toHaveBeenCalled()
  })

  it('liste les comptes pour un administrateur', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: true, contexte: { userId: 'moi' } } as never)
    await expect(UtilisateursPage()).resolves.toBeTruthy()
    expect(listerComptes).toHaveBeenCalledOnce()
  })
})
