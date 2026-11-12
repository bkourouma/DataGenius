import { useMemo, useState } from 'react'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useContexteEcranMedicAssist,
  useEnregistrerContexteMedicAssist,
} from '@/lib/medic-assist/client/contexte-ecran'
import { construireContexteFiltres } from '@/lib/medic-assist/client/contexte-ecran-filtres'

function EcranTest({ onRendu }: { onRendu?: () => void }) {
  const [pays, setPays] = useState<string[]>([])
  const [, setBruit] = useState(0)
  onRendu?.()
  const contexte = useMemo(
    () =>
      construireContexteFiltres({
        titre: 'Ecran',
        champs: [{ cle: 'pays', etiquette: 'Pays', valeur: pays, noms: pays.map((p) => p.toUpperCase()) }],
      }),
    [pays],
  )
  useEnregistrerContexteMedicAssist(contexte)
  return (
    <>
      <button onClick={() => setPays(['sn'])}>choisir</button>
      <button onClick={() => setBruit((n) => n + 1)}>bruit</button>
    </>
  )
}

describe('useEnregistrerContexteMedicAssist avec construireContexteFiltres', () => {
  beforeEach(() => {
    useContexteEcranMedicAssist.setState({ enregistre: null, demande: null })
  })

  it('n enregistre rien sans filtre, enregistre au choix et retire au demontage', async () => {
    const { getByText, unmount } = render(<EcranTest />)
    expect(useContexteEcranMedicAssist.getState().enregistre).toBeNull()
    await act(async () => {
      await userEvent.click(getByText('choisir'))
    })
    const enregistre = useContexteEcranMedicAssist.getState().enregistre
    expect(enregistre?.filtres).toEqual({ pays: ['sn'], paysNoms: ['SN'] })
    expect(enregistre?.libelle).toBe('Ecran · Pays : SN')
    unmount()
    expect(useContexteEcranMedicAssist.getState().enregistre).toBeNull()
  })

  it('ne reecrit pas le store quand le contenu est identique', async () => {
    const definir = vi.spyOn(useContexteEcranMedicAssist.getState(), 'definirEnregistre')
    useContexteEcranMedicAssist.setState({ definirEnregistre: definir })
    const { getByText } = render(<EcranTest />)
    await act(async () => {
      await userEvent.click(getByText('choisir'))
    })
    const appels = definir.mock.calls.length
    await act(async () => {
      await userEvent.click(getByText('bruit'))
      await userEvent.click(getByText('bruit'))
    })
    expect(definir.mock.calls.length).toBe(appels)
  })
})
