import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DELAI_ANTI_REBOND_MS,
  useArtefact,
} from '@/components/medic-assist/artefacts/use-artefact'
import type { ArtefactSpec } from '@/lib/medic-assist/contrats'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'

import { artefactTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

type Appel = {
  url: string
  methode: string
  corps?: { spec: ArtefactSpec; versionAttendue?: number }
  signal?: AbortSignal
}

function specTitre(titre: string): ArtefactSpec {
  return { type: 'tableau', titre, jeuDeDonneesId: 'jeu-1' }
}

/** Laisse les promesses en attente se résoudre (horloge factice comprise). */
async function laisser(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useArtefact', () => {
  let appels: Appel[]
  let reponses: (appel: Appel) => Promise<Response>

  beforeEach(() => {
    vi.useFakeTimers()
    toast.mockReset()
    appels = []
    reponses = async appel =>
      appel.methode === 'PATCH'
        ? reponseJson(reponseApi(artefactTest('tableau', { version: 2 })))
        : reponseJson(reponseApi(artefactTest('tableau')))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const appel: Appel = {
          url,
          methode: init?.method ?? 'GET',
          corps: init?.body ? JSON.parse(String(init.body)) : undefined,
          signal: init?.signal ?? undefined,
        }
        appels.push(appel)
        return reponses(appel)
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const patchs = () => appels.filter(a => a.methode === 'PATCH')

  it("charge l'artefact puis passe à l'état prêt", async () => {
    const { result } = renderHook(() => useArtefact('art-tableau'))
    expect(result.current.etat).toBe('chargement')
    await laisser()
    expect(result.current.etat).toBe('pret')
    expect(result.current.artefact?.id).toBe('art-tableau')
    expect(result.current.specLocale).toEqual(result.current.artefact?.spec)
    expect(appels[0].url).toBe('/api/medic-assist/artefacts/art-tableau')
  })

  it('demande la version voulue', async () => {
    renderHook(() => useArtefact('art-tableau', 3))
    await laisser()
    expect(appels[0].url).toBe('/api/medic-assist/artefacts/art-tableau?version=3')
  })

  it("ne charge rien tant que l'option actif est fausse", async () => {
    const { result, rerender } = renderHook(({ actif }) => useArtefact('art-tableau', undefined, { actif }), {
      initialProps: { actif: false },
    })
    await laisser()
    expect(appels).toHaveLength(0)
    expect(result.current.etat).toBe('chargement')
    rerender({ actif: true })
    await laisser()
    expect(appels).toHaveLength(1)
    expect(result.current.etat).toBe('pret')
  })

  it('distingue artefact introuvable et erreur de chargement, et recharge à la demande', async () => {
    reponses = async () => reponseJson({ error: 'NotFound' }, 404)
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    expect(result.current.etat).toBe('erreur')
    expect(result.current.erreur).toBe('introuvable')

    reponses = async () => reponseJson({ error: 'x' }, 500)
    act(() => result.current.recharger())
    await laisser()
    expect(result.current.erreur).toBe('chargement')

    reponses = async () => reponseJson(reponseApi(artefactTest('tableau')))
    act(() => result.current.recharger())
    await laisser()
    expect(result.current.etat).toBe('pret')
    expect(result.current.erreur).toBeNull()
  })

  it('annule la lecture en cours quand on change d’artefact ou qu’on démonte', async () => {
    reponses = () => new Promise(() => {})
    const { rerender, unmount } = renderHook(({ id }) => useArtefact(id), {
      initialProps: { id: 'a' },
    })
    await laisser()
    const premier = appels[0].signal
    rerender({ id: 'b' })
    expect(premier?.aborted).toBe(true)
    await laisser()
    const second = appels[1].signal
    unmount()
    expect(second?.aborted).toBe(true)
  })

  it('met à jour la spec tout de suite et n’envoie qu’un PATCH pour 5 éditions rapprochées', async () => {
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()

    for (let i = 1; i <= 5; i++) {
      act(() => result.current.enregistrerSpec(specTitre(`édition ${i}`)))
      await laisser(100)
    }
    // Rendu optimiste : la dernière édition est déjà affichée, rien n'est encore parti.
    expect((result.current.specLocale as { titre: string }).titre).toBe('édition 5')
    expect(result.current.enregistrement).toBe('en_cours')
    expect(patchs()).toHaveLength(0)

    await laisser(DELAI_ANTI_REBOND_MS)
    expect(patchs()).toHaveLength(1)
    expect(patchs()[0].url).toBe('/api/medic-assist/artefacts/art-tableau')
    expect(patchs()[0].corps?.spec).toEqual(specTitre('édition 5'))
    // La version affichée est annoncée : le serveur répond 409 si une plus récente existe.
    expect(patchs()[0].corps).toEqual({ spec: specTitre('édition 5'), versionAttendue: 1 })

    // La réponse devient l'artefact (nouvelle version).
    expect(result.current.artefact?.version).toBe(2)
    expect(result.current.enregistrement).toBe('enregistre')
    expect(result.current.specLocale).toEqual(result.current.artefact?.spec)
  })

  it('garde une seule requête en vol : la dernière spec part ensuite, avec l’id de la réponse', async () => {
    let finir!: (r: Response) => void
    reponses = appel => {
      if (appel.methode === 'GET') return Promise.resolve(reponseJson(reponseApi(artefactTest('tableau'))))
      if (patchs().length === 1) return new Promise<Response>(r => (finir = r))
      return Promise.resolve(
        reponseJson(reponseApi(artefactTest('tableau', { id: 'v3', version: 3 })))
      )
    }
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()

    act(() => result.current.enregistrerSpec(specTitre('A')))
    await laisser(DELAI_ANTI_REBOND_MS)
    expect(patchs()).toHaveLength(1)

    act(() => result.current.enregistrerSpec(specTitre('B')))
    await laisser(DELAI_ANTI_REBOND_MS)
    act(() => result.current.enregistrerSpec(specTitre('C')))
    await laisser(DELAI_ANTI_REBOND_MS)
    expect(patchs()).toHaveLength(1) // toujours une seule requête en vol

    await act(async () => {
      finir(reponseJson(reponseApi(artefactTest('tableau', { id: 'v2', version: 2 }))))
      await vi.advanceTimersByTimeAsync(0)
    })
    // L'édition la plus récente (C) n'est pas écrasée par la réponse de A.
    await laisser()
    expect(patchs()).toHaveLength(2)
    expect(patchs()[1].corps?.spec).toEqual(specTitre('C'))
    expect(patchs()[1].url).toBe('/api/medic-assist/artefacts/v2')
    expect(patchs()[1].corps?.versionAttendue).toBe(2)
    expect(result.current.artefact?.id).toBe('v3')
  })

  it('revient à la dernière version du serveur et prévient en cas d’échec', async () => {
    reponses = async appel =>
      appel.methode === 'PATCH'
        ? reponseJson({ error: 'Internal' }, 500)
        : reponseJson(reponseApi(artefactTest('tableau')))
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    const specServeur = result.current.artefact?.spec

    act(() => result.current.enregistrerSpec(specTitre('refusée')))
    expect((result.current.specLocale as { titre: string }).titre).toBe('refusée')
    await laisser(DELAI_ANTI_REBOND_MS)

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: expect.stringContaining("L'enregistrement a échoué"),
      })
    )
    expect(result.current.specLocale).toEqual(specServeur)
    expect(result.current.enregistrement).toBe('erreur')
  })

  it('envoie l’édition en attente au démontage', async () => {
    const { result, unmount } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    act(() => result.current.enregistrerSpec(specTitre('avant fermeture')))
    expect(patchs()).toHaveLength(0)
    unmount()
    expect(patchs()).toHaveLength(1)
    expect(patchs()[0].corps?.spec).toEqual(specTitre('avant fermeture'))
    await laisser(DELAI_ANTI_REBOND_MS * 2)
    expect(patchs()).toHaveLength(1)
  })

  it('envoie l’édition en attente quand on change d’artefact', async () => {
    const { result, rerender } = renderHook(({ id }) => useArtefact(id), {
      initialProps: { id: 'art-tableau' },
    })
    await laisser()
    act(() => result.current.enregistrerSpec(specTitre('à garder')))
    rerender({ id: 'autre' })
    expect(patchs()).toHaveLength(1)
    expect(patchs()[0].url).toBe('/api/medic-assist/artefacts/art-tableau')
    await laisser()
  })

  it('ignore les éditions en lecture seule (autre lecteur ou ancienne version)', async () => {
    const lecteur: ArtefactClient = artefactTest('tableau', { modifiable: false })
    reponses = async () => reponseJson(reponseApi(lecteur))
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    expect(result.current.lectureSeule).toBe(true)
    act(() => result.current.enregistrerSpec(specTitre('interdit')))
    await laisser(DELAI_ANTI_REBOND_MS * 2)
    expect(patchs()).toHaveLength(0)
    expect(result.current.specLocale).toEqual(lecteur.spec)
  })

  it('une version ancienne est en lecture seule', async () => {
    reponses = async () =>
      reponseJson(
        reponseApi(
          artefactTest('tableau', {
            version: 1,
            versions: [
              { version: 1, creeLe: '2026-11-02T08:00:00.000Z' },
              { version: 2, creeLe: '2026-11-02T09:00:00.000Z' },
            ],
          })
        )
      )
    const { result } = renderHook(() => useArtefact('art-tableau', 1))
    await laisser()
    expect(result.current.lectureSeule).toBe(true)
  })

  it('409 : recharge la dernière version, prévient (conflit) et abandonne l’édition', async () => {
    const derniere = artefactTest('tableau', {
      id: 'v5',
      version: 5,
      versions: [{ version: 5, creeLe: '2026-11-02T10:00:00.000Z' }],
      spec: specTitre('version du serveur'),
    })
    reponses = async appel => {
      if (appel.methode === 'PATCH') {
        return reponseJson({ error: 'Conflict', message: 'Version périmée' }, 409)
      }
      return reponseJson(reponseApi(appel.url.endsWith('art-tableau') && patchs().length > 0 ? derniere : artefactTest('tableau')))
    }
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()

    act(() => result.current.enregistrerSpec(specTitre('ma modification')))
    await laisser(DELAI_ANTI_REBOND_MS)

    expect(patchs()).toHaveLength(1)
    // Le GET de rechargement ne demande aucune version précise : la dernière.
    expect(appels.filter(a => a.methode === 'GET').at(-1)?.url).toBe(
      '/api/medic-assist/artefacts/art-tableau'
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: expect.stringContaining('modifié entre-temps'),
      })
    )
    expect(result.current.artefact?.version).toBe(5)
    expect(result.current.specLocale).toEqual(specTitre('version du serveur'))
    expect(result.current.enregistrement).toBe('repos')

    // L'édition suivante s'appuie sur la version rechargée.
    act(() => result.current.enregistrerSpec(specTitre('reprise')))
    await laisser(DELAI_ANTI_REBOND_MS)
    expect(patchs()).toHaveLength(2)
    expect(patchs()[1].corps?.versionAttendue).toBe(5)
    expect(patchs()[1].url).toBe('/api/medic-assist/artefacts/v5')
  })

  it('409 puis rechargement impossible : retour à la version connue, état en erreur', async () => {
    reponses = async appel => {
      if (appel.methode === 'PATCH') return reponseJson({ error: 'Conflict' }, 409)
      return patchs().length > 0
        ? reponseJson({ error: 'x' }, 500)
        : reponseJson(reponseApi(artefactTest('tableau')))
    }
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    act(() => result.current.enregistrerSpec(specTitre('perdue')))
    await laisser(DELAI_ANTI_REBOND_MS)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(result.current.enregistrement).toBe('erreur')
  })

  it('convertit la réponse HTTP : jeux avec lignes, droits, dates et racine', async () => {
    reponses = async () =>
      reponseJson(
        reponseApi(
          artefactTest('tableau', {
            id: 'art-v2',
            racineId: 'art-tableau',
            version: 2,
            modifiable: false,
            versions: [
              { version: 1, creeLe: '2026-11-02T08:00:00.000Z' },
              { version: 2, creeLe: '2026-11-02T09:00:00.000Z' },
            ],
          })
        )
      )
    const { result } = renderHook(() => useArtefact('art-v2'))
    await laisser()
    const a = result.current.artefact
    expect(a?.racineId).toBe('art-tableau')
    expect(a?.modifiable).toBe(false)
    expect(a?.versions[1].creeLe).toBe('2026-11-02T09:00:00.000Z')
    expect(a?.jeux['jeu-1'].lignes).toHaveLength(2)
    expect(result.current.lectureSeule).toBe(true)
  })

  it('une réponse sans la forme d’un artefact est une erreur de chargement', async () => {
    reponses = async () => reponseJson({ artefact: artefactTest('tableau') })
    const { result } = renderHook(() => useArtefact('art-tableau'))
    await laisser()
    expect(result.current.etat).toBe('erreur')
    expect(result.current.erreur).toBe('chargement')
  })
})
