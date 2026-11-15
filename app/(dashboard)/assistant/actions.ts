'use server'

import { prisma } from '@/lib/db/client'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { cleMasquageDemarrage } from '@/lib/medic-assist/demarrage'

/** Memorise en base que l'administrateur connecte a masque le guide de demarrage. */
export async function masquerDemarrage(): Promise<{ ok: boolean }> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { ok: false }
  const userId = garde.session.user.id
  const cle = cleMasquageDemarrage(userId)
  try {
    await prisma.parametreApplication.upsert({
      where: { cle },
      create: { cle, valeur: '1', updatedBy: userId },
      update: { valeur: '1', updatedBy: userId },
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
