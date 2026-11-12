/**
 * Chemin d'édition du tableau croisé : bouton « Modifier le tableau croisé » → éditeur →
 * `onSpecChange({ ...spec, pivot })` → `useArtefact.enregistrerSpec` → PATCH (fetch factice).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RenduArtefact } from '@/components/medic-assist/artefacts/rendu-artefact'
import { RenduTableau } from '@/components/medic-assist/artefacts/rendu-tableau'
import { useArtefact } from '@/components/medic-assist/artefacts/use-artefact'
import type { ArtefactSpec, ContenuTableau } from '@/lib/medic-assist/contrats'

import { artefactTest, jeuTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

function Harnais({ id, version }: { id: string; version?: number }) {
  const { artefact, specLocale, enregistrerSpec } = useArtefact(id, version)
  if (!artefact || !specLocale) return <p>chargement</p>
  return (
    <RenduArtefact
      artefact={artefact}
      spec={specLocale}
      onSpecChange={enregistrerSpec}
    />
  )
}

type Appel = { methode: string; corps?: { spec: ArtefactSpec; versionAttendue?: number } }

describe('édition du tableau croisé', () => {
  let appels: Appel[]

  beforeEach(() => {
    appels = []
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function simulerApi(modifiable: boolean) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const methode = init?.method ?? 'GET'
        appels.push({ methode, corps: init?.body ? JSON.parse(String(init.body)) : undefined })
        const artefact = artefactTest('tableau', { modifiable, version: methode === 'PATCH' ? 2 : 1 })
        return reponseJson(reponseApi(artefact))
      })
    )
  }

  it("le pivot choisi dans l'éditeur arrive dans le PATCH (spec contenant le pivot)", async () => {
    simulerApi(true)
    render(<Harnais id="art-tableau" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier le tableau croisé' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tableau croisé', pressed: false }))

    await waitFor(() => expect(appels.some(a => a.methode === 'PATCH')).toBe(true), { timeout: 4000 })
    const patch = appels.find(a => a.methode === 'PATCH')
    expect(patch?.corps?.versionAttendue).toBe(1)
    expect(patch?.corps?.spec).toMatchObject({
      type: 'tableau',
      jeuDeDonneesId: 'jeu-1',
      pivot: { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
    })
  })

  it('lecture seule : pas de bouton ; le pivot en place est affiché', async () => {
    const jeu = jeuTest()
    const spec: ContenuTableau = {
      titre: 'CA par pays',
      jeuDeDonneesId: 'jeu-1',
      pivot: { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
    }
    render(<RenduTableau spec={spec} jeu={jeu} modifiable={false} onSpecChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Modifier le tableau croisé' })).toBeNull()
    expect(await screen.findByText('CA')).toBeInTheDocument()
  })

  it('propriétaire : le bouton ouvre puis replie l’éditeur', async () => {
    const surChangement = vi.fn()
    render(
      <RenduTableau
        spec={{ titre: 'CA par pays', jeuDeDonneesId: 'jeu-1' }}
        jeu={jeuTest()}
        modifiable
        onSpecChange={surChangement}
      />
    )
    const bouton = screen.getByRole('button', { name: 'Modifier le tableau croisé' })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(bouton)
    expect(bouton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('group', { name: 'Affichage' })).toBeInTheDocument()
    await userEvent.click(bouton)
    expect(screen.queryByRole('group', { name: 'Affichage' })).toBeNull()
    expect(surChangement).not.toHaveBeenCalled()
  })

  it('« Retirer » renvoie un pivot indéfini', async () => {
    const surChangement = vi.fn()
    render(
      <RenduTableau
        spec={{
          titre: 'CA par pays',
          jeuDeDonneesId: 'jeu-1',
          pivot: { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
        }}
        jeu={jeuTest()}
        modifiable
        onSpecChange={surChangement}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Modifier le tableau croisé' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retirer le tableau croisé' }))
    expect(surChangement).toHaveBeenCalledTimes(1)
    const envoye = surChangement.mock.calls[0][0] as ContenuTableau
    expect(envoye.pivot).toBeUndefined()
    expect(envoye.titre).toBe('CA par pays')
  })
})
