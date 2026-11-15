import { describe, expect, it } from 'vitest'

import {
  CODES_ERREUR_CHAT,
  cleMessageErreur,
  descriptionMessageErreur,
  erreurReessayable,
  extraireCodeErreur,
  extraireDetailsErreur,
  formaterReinitialisation,
} from '@/lib/medic-assist/client/erreurs-chat'
import { messageErreurApi } from '@/lib/medic-assist/client/erreurs-api'
import { ErreurApiMedicAssist } from '@/lib/medic-assist/client/api'
import fr from '@/messages/fr/medicAssist.json'

const corps = (o: object) => new Error(JSON.stringify(o))

describe('codes 409', () => {
  it('sont reconnus dans le flux et dans le corps JSON', () => {
    expect(CODES_ERREUR_CHAT).toContain('tour_en_cours')
    expect(extraireCodeErreur(new Error('medic_assist_erreur:tour_en_cours'))).toBe('tour_en_cours')
    expect(extraireCodeErreur(corps({ error: 'message_deja_recu', message: 'x' }))).toBe(
      'message_deja_recu'
    )
  })

  it('tour_en_cours est réessayable, message_deja_recu non', () => {
    expect(erreurReessayable('tour_en_cours')).toBe(true)
    expect(erreurReessayable('message_deja_recu')).toBe(false)
  })

  it('leurs clés pointent vers gardeFous.erreurs et existent en français', () => {
    expect(cleMessageErreur('tour_en_cours')).toBe('gardeFous.erreurs.tour_en_cours')
    expect(cleMessageErreur('quota_epuise')).toBe('erreurs.quota_epuise')
    expect(fr.gardeFous.erreurs.tour_en_cours).toBeTruthy()
    expect(fr.gardeFous.erreurs.message_deja_recu).toBeTruthy()
  })
})

describe('extraireDetailsErreur', () => {
  it('lit details du corps JSON', () => {
    const e = corps({
      error: 'quota_epuise',
      message: 'x',
      details: { reference: 'DG-7K3F9Q', reinitialisationA: '2026-11-13T23:00:00.000Z' },
    })
    expect(extraireDetailsErreur(e)).toEqual({
      reference: 'DG-7K3F9Q',
      reinitialisationA: '2026-11-13T23:00:00.000Z',
    })
  })

  it('lit le suffixe du flux', () => {
    expect(extraireDetailsErreur(new Error('medic_assist_erreur:interne DG-7K3F9Q'))).toEqual({
      reference: 'DG-7K3F9Q',
    })
  })

  it('ne lève jamais et ignore les valeurs invalides', () => {
    for (const entree of [null, undefined, 42, '{', new Error('{"details":'), { message: 3 }]) {
      expect(extraireDetailsErreur(entree)).toEqual({})
    }
    const e = corps({ error: 'x', details: { reference: 'pas une ref', reinitialisationA: 'hier' } })
    expect(extraireDetailsErreur(e)).toEqual({})
  })
})

describe('affichage du quota', () => {
  it("formate l'heure dans la langue demandée", () => {
    const maintenant = new Date('2026-11-13T10:00:00Z')
    const iso = '2026-11-13T23:00:00.000Z'
    const heure = formaterReinitialisation(iso, 'fr', maintenant)
    expect(heure).toMatch(/\d{2}:\d{2}/)
    expect(formaterReinitialisation('invalide', 'fr')).toBeNull()
  })

  it("choisit la clé avec l'heure quand elle est connue, sinon le message simple", () => {
    const d = descriptionMessageErreur(
      'quota_epuise',
      { reinitialisationA: '2026-11-13T23:00:00.000Z' },
      'fr'
    )
    expect(d.cle).toBe('gardeFous.quotaEpuiseHeure')
    expect(d.valeurs.heure).toBeTruthy()
    expect(descriptionMessageErreur('quota_epuise', {}, 'fr')).toEqual({
      cle: 'erreurs.quota_epuise',
      valeurs: {},
    })
  })
})

describe('messageErreurApi : repli sur gardeFous.api', () => {
  const traducteur = (cles: Record<string, string>) =>
    Object.assign((c: string) => cles[c], { has: (c: string) => c in cles })

  it('utilise le secours quand le premier espace ignore le code', () => {
    const e = new ErreurApiMedicAssist(429, 'limiteDebit')
    const secours = traducteur({ limiteDebit: 'Trop de dictées' })
    expect(messageErreurApi(e, traducteur({}), 'repli', secours)).toBe('Trop de dictées')
    expect(messageErreurApi(e, traducteur({}), 'repli')).toBe('repli')
  })
})
