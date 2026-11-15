import { describe, expect, it, vi } from 'vitest'
import { getTranslations } from 'next-intl/server'
import { render, screen } from '@testing-library/react'
import { retourSynchro } from '@/lib/warehouse/libelles-synchro'
import { CLES_ECHEC_SYNCHRO, retourSynchroTraduit } from '@/app/(dashboard)/sources/retour-synchro'
import { Retour, Soumettre } from '@/app/(dashboard)/sources/formulaires'

// React 18 stable n'expose pas useFormStatus : le dépôt compile avec un canal qui l'a, jsdom non.
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormStatus: () => ({ pending: false }),
  useFormState: (_action: unknown, etat: unknown) => [etat, () => {}],
}))

const CODES = [
  'source', 'schema', 'volume', 'plage', 'unique', 'non_nul', 'configuration', 'incremental_cle',
  'incremental_date', 'interne', 'delai', 'bail_perdu', 'configuration_modifiee',
  'enregistrement_impossible', 'backoff',
]
const STATUTS = ['en_cours', 'publie', 'identique', 'pas_echu', 'echec', 'inconnu', '']
const CODES_ENTREE: (string | null | undefined)[] = [
  ...CODES, undefined, null, '', 'code_inconnu', 'toString', 'constructor', '__proto__', 'hasOwnProperty',
]

describe('retourSynchroTraduit (fr)', () => {
  it('couvre les 15 codes d’échec de la lib', () => {
    expect(Object.keys(CLES_ECHEC_SYNCHRO).sort()).toEqual([...CODES].sort())
  })

  it('reproduit exactement retourSynchro de la lib pour tous les statuts et codes', async () => {
    const t = await getTranslations('sources.synchro')
    for (const statut of STATUTS) {
      for (const code of CODES_ENTREE) {
        expect(retourSynchroTraduit(t, { statut, code }), `${statut}/${String(code)}`).toStrictEqual(retourSynchro({ statut, code }))
      }
      expect(retourSynchroTraduit(t, { statut }), statut).toStrictEqual(retourSynchro({ statut }))
    }
  })
})

describe('Retour et Soumettre (fr)', () => {
  it('affiche l’erreur en alerte et le succès en statut', () => {
    const { rerender } = render(<Retour erreur="Échec : x" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Échec : x')
    rerender(<Retour succes="Données publiées." />)
    expect(screen.getByRole('status')).toHaveTextContent('Données publiées.')
  })

  it('affiche le texte du bouton hors attente', () => {
    render(<form><Soumettre texte="Renommer" attente="Enregistrement…" /></form>)
    expect(screen.getByRole('button', { name: 'Renommer' })).toBeEnabled()
  })
})
