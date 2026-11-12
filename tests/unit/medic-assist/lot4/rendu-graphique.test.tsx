import { createRef } from 'react'

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EchartsReact } from '@/components/medic-assist/artefacts/echarts-react'
import { RenduGraphique } from '@/components/medic-assist/artefacts/rendu-graphique'
import { jetons } from '@/lib/medic-assist/artefacts/palette'

import { faux } from './_echarts-faux'
import { langueTest } from './_intl'

import type { RenduGraphiqueHandle } from '@/components/medic-assist/artefacts/rendu-graphique'
import type { ColonneJeu, GraphiqueSpec } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)
vi.mock('@/components/medic-assist/artefacts/echarts-chargeur', async () =>
  (await import('./_echarts-faux')).moduleChargeur()
)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

const { toast } = await import('sonner')

const COLS: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'canal', libelle: 'Canal', type: 'texte' },
  { cle: 'ca', libelle: "Chiffre d'affaires", type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
]

function jeu(lignes: Record<string, unknown>[], colonnes: ColonneJeu[] = COLS): JeuClient {
  return {
    jeuDeDonneesId: 'j1',
    colonnes,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {} as never,
  }
}

const LIGNES = [
  { pays: 'France', ca: 100, taux: 80, qte: 1, periode: '2026-05', canal: 'A' },
  { pays: 'Mali', ca: 300, taux: 60, qte: 3, periode: '2026-04', canal: 'A' },
  { pays: 'France', ca: 50, taux: 100, qte: 2, periode: '2026-04', canal: 'B' },
  { pays: 'Togo', ca: 20, taux: 40, qte: 5, periode: '2026-06', canal: 'B' },
]
// B-1 : la jauge lit le total du jeu (jamais la première ligne d'un jeu de plusieurs lignes).
const JEU = { ...jeu(LIGNES), totaux: { taux: 70 } }
const JEU_DOUZE = jeu(
  Array.from({ length: 12 }, (_, i) => ({
    pays: `Pays ${i + 1}`,
    ca: 100 + i,
    taux: 50,
    qte: i,
    periode: '2026-04',
    canal: 'A',
  }))
)
const JEU_UNE_MESURE = jeu(
  LIGNES.map(l => ({ pays: l.pays, ca: l.ca })),
  COLS.filter(c => c.cle === 'pays' || c.cle === 'ca')
)

const spec = (s: Partial<GraphiqueSpec> & Pick<GraphiqueSpec, 'forme'>): GraphiqueSpec => ({
  x: 'pays',
  y: [{ cle: 'ca' }],
  ...s,
})

const SERIES_ATTENDUES: [GraphiqueSpec, string][] = [
  [spec({ forme: 'barres' }), 'bar'],
  [spec({ forme: 'barres_empilees', y: [{ cle: 'ca' }, { cle: 'qte' }], empile: true }), 'bar'],
  [spec({ forme: 'barres_horizontales' }), 'bar'],
  [spec({ forme: 'lignes', x: 'periode' }), 'line'],
  [spec({ forme: 'aires', x: 'periode' }), 'line'],
  [spec({ forme: 'secteurs' }), 'pie'],
  [spec({ forme: 'anneau' }), 'pie'],
  [spec({ forme: 'nuage', x: 'ca', y: [{ cle: 'qte' }] }), 'scatter'],
  [
    spec({
      forme: 'combine',
      y: [{ cle: 'ca', forme: 'barres' }, { cle: 'taux', forme: 'lignes', axe: 'droite' }],
    }),
    'line',
  ],
  [spec({ forme: 'carte_chaleur', serie: 'canal' }), 'heatmap'],
  [spec({ forme: 'treemap' }), 'treemap'],
  [spec({ forme: 'entonnoir' }), 'funnel'],
  [spec({ forme: 'jauge', y: [{ cle: 'taux' }] }), 'gauge'],
]

function typesSeries(option: Record<string, unknown>): string[] {
  return ((option.series as { type: string }[] | undefined) ?? []).map(s => s.type)
}

beforeEach(() => {
  faux.reinitialiser()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.info).mockClear()
})

afterEach(async () => {
  // Laisse finir le chargement asynchrone avant de démonter (évite les alertes act).
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
  cleanup()
  langueTest.code = 'fr'
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
})

describe('EchartsReact (chargement à la demande)', () => {
  it('affiche un squelette pendant le chargement puis crée l\'instance et applique l\'option', async () => {
    render(<EchartsReact option={{ a: 1 }} hauteur={200} />)
    expect(screen.getByRole('status')).toHaveTextContent('Chargement du graphique')
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(faux.derniere().setOption).toHaveBeenCalledWith({ a: 1 }, { notMerge: true })
  })

  it('échec de chargement des modules : erreur, toast, puis réessai réussi', async () => {
    faux.echecChargement = true
    render(<EchartsReact option={{}} hauteur={200} />)
    const alerte = await screen.findByRole('alert')
    expect(toast.error).toHaveBeenCalledTimes(1)
    faux.echecChargement = false
    await userEvent.click(within(alerte).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(faux.instances).toHaveLength(1))
  })

  it('réapplique l\'option avec notMerge quand elle change', async () => {
    const { rerender } = render(<EchartsReact option={{ a: 1 }} hauteur={200} />)
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(faux.derniere().setOption).toHaveBeenCalledTimes(1))
    rerender(<EchartsReact option={{ a: 2 }} hauteur={200} />)
    await waitFor(() => expect(faux.derniere().setOption).toHaveBeenCalledTimes(2))
    expect(faux.derniere().setOption).toHaveBeenLastCalledWith({ a: 2 }, { notMerge: true })
    expect(faux.instances).toHaveLength(1)
  })

  it('redimensionne avec ResizeObserver, nettoie et libère l\'instance au démontage', async () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let rappel: () => void = () => {}
    class FauxObservateur {
      constructor(cb: () => void) {
        rappel = cb
      }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    }
    const ancien = window.ResizeObserver
    window.ResizeObserver = FauxObservateur as never
    const { unmount } = render(<EchartsReact option={{}} hauteur={200} />)
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    expect(observe).toHaveBeenCalledTimes(1)
    rappel()
    expect(faux.derniere().resize).toHaveBeenCalled()
    unmount()
    expect(disconnect).toHaveBeenCalled()
    expect(faux.derniere().dispose).toHaveBeenCalledTimes(1)
    window.ResizeObserver = ancien
  })

  it('coupe l\'animation quand l\'utilisateur préfère moins de mouvement', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    )
    render(<EchartsReact option={{ animation: true }} hauteur={200} />)
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(faux.derniere().setOption).toHaveBeenCalled())
    expect(faux.derniereOption().animation).toBe(false)
  })

  it('affiche une erreur avec un bouton Réessayer, un toast, puis se rétablit', async () => {
    faux.echecInit = true
    render(<EchartsReact option={{}} hauteur={200} />)
    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent("Le graphique n'a pas pu être chargé.")
    expect(toast.error).toHaveBeenCalledWith("Le graphique n'a pas pu être chargé.")

    faux.echecInit = false
    await userEvent.click(within(alerte).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(faux.derniere().setOption).toHaveBeenCalled()
  })

  it('un conteneur sans dimension ne plante pas', async () => {
    const { container } = render(<EchartsReact option={{}} hauteur={0} />)
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    expect(container.firstChild).toBeInTheDocument()
  })
})

describe('RenduGraphique', () => {
  it.each(SERIES_ATTENDUES)('rend la forme %# avec une option ECharts cohérente', async (s, type) => {
    render(<RenduGraphique titre="Ventes" spec={s} jeu={JEU} />)
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(faux.derniere().setOption).toHaveBeenCalled())
    const option = faux.derniereOption()
    expect(typesSeries(option)).toContain(type)
    expect(option.aria).toMatchObject({ enabled: true })
  })

  it('donne au tracé un nom accessible détaillé (titre, forme, mesures, points)', async () => {
    render(<RenduGraphique titre="Ventes par pays" spec={spec({ forme: 'barres' })} jeu={JEU} />)
    const figure = screen.getByRole('img')
    const nom = figure.getAttribute('aria-label') ?? ''
    expect(nom).toContain('Ventes par pays')
    expect(nom).toContain('Graphique en barres')
    expect(nom).toMatch(/1 série/)
    expect(nom).toMatch(/points?/)
    await waitFor(() => expect(faux.instances.length).toBeGreaterThan(0))
  })

  it('affiche l\'état vide (message et icône) sans charger ECharts', () => {
    render(<RenduGraphique titre="Ventes" spec={spec({ forme: 'barres' })} jeu={jeu([])} />)
    const vide = screen.getByRole('status')
    expect(vide).toHaveTextContent('Aucune donnée à afficher')
    expect(vide.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(faux.instances).toHaveLength(0)
  })

  it('signale le repli des secteurs au-delà de 8 catégories (icône et texte)', async () => {
    const { container } = render(
      <RenduGraphique titre="Parts" spec={spec({ forme: 'secteurs' })} jeu={JEU_DOUZE} />
    )
    const liste = screen.getByRole('list', { name: 'Remarques sur l\'affichage' })
    expect(liste).toHaveTextContent('Affichage en barres horizontales : plus de 8 catégories')
    expect(liste.querySelector('svg')).toBeInTheDocument()
    await waitFor(() => expect(faux.instances).toHaveLength(1))
    await waitFor(() => expect(faux.derniere().setOption).toHaveBeenCalled())
    expect(typesSeries(faux.derniereOption())).toContain('bar')
    expect(container.querySelector('figure')).toBeInTheDocument()
  })

  it('signale la limite appliquée (Top N sur total)', async () => {
    render(<RenduGraphique titre="Top" spec={spec({ forme: 'barres', limite: 2 })} jeu={JEU} />)
    expect(screen.getByRole('list')).toHaveTextContent('Top 2 sur 3')
    await waitFor(() => expect(faux.instances.length).toBeGreaterThan(0))
  })

  it('agrandit les barres horizontales selon le nombre de catégories, avec un plafond', async () => {
    const { container, rerender } = render(
      <RenduGraphique titre="Barres" spec={spec({ forme: 'barres' })} jeu={JEU} />
    )
    const hauteur = () => (container.querySelector('figure > div') as HTMLElement).style.height
    expect(hauteur()).toBe('320px')
    rerender(<RenduGraphique titre="Barres" spec={spec({ forme: 'barres' })} jeu={JEU} compact />)
    expect(hauteur()).toBe('240px')
    rerender(
      <RenduGraphique titre="Barres" spec={spec({ forme: 'barres_horizontales' })} jeu={JEU_DOUZE} />
    )
    expect(hauteur()).toBe('416px')
    const beaucoup = jeu(
      Array.from({ length: 60 }, (_, i) => ({ pays: `P${i}`, ca: i + 1, taux: 1, qte: 1, periode: '2026-04', canal: 'A' }))
    )
    rerender(
      <RenduGraphique titre="Barres" spec={spec({ forme: 'barres_horizontales' })} jeu={beaucoup} />
    )
    expect(hauteur()).toBe('640px')
    rerender(
      <RenduGraphique titre="Barres" spec={spec({ forme: 'barres' })} jeu={JEU} hauteur={500} />
    )
    expect(hauteur()).toBe('500px')
    await waitFor(() => expect(faux.instances.length).toBeGreaterThan(0))
  })

  it('applique le thème sombre quand <html> porte la classe dark', async () => {
    document.documentElement.classList.add('dark')
    render(<RenduGraphique titre="Ventes" spec={spec({ forme: 'barres' })} jeu={JEU} />)
    await waitFor(() => {
      const instance = faux.instances.at(-1)
      expect(instance?.setOption.mock.calls.at(-1)?.[0]).toMatchObject({
        textStyle: { color: jetons('sombre').encre },
      })
    })
  })

  describe('sélecteur de forme', () => {
    it('est masqué si le lecteur ne peut pas modifier ou si sansSelecteur', async () => {
      const { rerender } = render(
        <RenduGraphique titre="V" spec={spec({ forme: 'barres' })} jeu={JEU} />
      )
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
      rerender(<RenduGraphique titre="V" spec={spec({ forme: 'barres' })} jeu={JEU} modifiable sansSelecteur />)
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
      rerender(<RenduGraphique titre="V" spec={spec({ forme: 'barres' })} jeu={JEU} modifiable />)
      expect(screen.getByRole('toolbar', { name: 'Forme du graphique' })).toBeInTheDocument()
      await waitFor(() => expect(faux.instances.length).toBeGreaterThan(0))
    })

    it('un clic appelle onSpecChange avec la spécification adaptée', async () => {
      const onSpecChange = vi.fn()
      render(
        <RenduGraphique
          titre="V"
          spec={spec({ forme: 'barres' })}
          jeu={JEU}
          modifiable
          onSpecChange={onSpecChange}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'lignes' }))
      expect(onSpecChange).toHaveBeenCalledTimes(1)
      expect(onSpecChange.mock.calls[0][0]).toMatchObject({ forme: 'lignes', x: 'pays' })
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('un changement refusé affiche un toast traduit et ne change rien', async () => {
      const onSpecChange = vi.fn()
      render(
        <RenduGraphique
          titre="V"
          spec={spec({ forme: 'barres' })}
          jeu={JEU_UNE_MESURE}
          modifiable
          onSpecChange={onSpecChange}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /^nuage de points/ }))
      expect(onSpecChange).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith(
        'Changement impossible : Cette forme demande au moins deux mesures.'
      )
    })

    it('un remplacement (trop de catégories) applique la forme effective et le signale', async () => {
      const onSpecChange = vi.fn()
      render(
        <RenduGraphique
          titre="V"
          spec={spec({ forme: 'barres' })}
          jeu={JEU_DOUZE}
          modifiable
          onSpecChange={onSpecChange}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /^secteurs/ }))
      expect(onSpecChange.mock.calls[0][0]).toMatchObject({ forme: 'barres_horizontales' })
      expect(vi.mocked(toast.info).mock.calls[0][0]).toContain('barres horizontales')
    })
  })

  describe('export PNG', () => {
    it('télécharge un PNG en haute résolution sur fond blanc', async () => {
      const ref = createRef<RenduGraphiqueHandle>()
      render(<RenduGraphique ref={ref} titre="V" spec={spec({ forme: 'barres' })} jeu={JEU} />)
      await waitFor(() => expect(faux.instances).toHaveLength(1))
      const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      let lien: HTMLAnchorElement | null = null
      const original = document.body.appendChild.bind(document.body)
      const ajout = vi.spyOn(document.body, 'appendChild').mockImplementation(n => {
        if (n instanceof HTMLAnchorElement) lien = n
        return original(n)
      })

      await ref.current!.telechargerPng('ventes-2026')

      expect(faux.derniere().getDataURL).toHaveBeenCalledWith({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#fff',
      })
      expect(clic).toHaveBeenCalledTimes(1)
      expect((lien as HTMLAnchorElement | null)?.download).toBe('ventes-2026.png')
      expect((lien as HTMLAnchorElement | null)?.href).toBe('data:image/png;base64,AAAA')
      expect(ref.current!.versDataUrl()).toBe('data:image/png;base64,AAAA')
      clic.mockRestore()
      ajout.mockRestore()
    })

    it('signale par un toast que le graphique n\'est pas prêt', async () => {
      const ref = createRef<RenduGraphiqueHandle>()
      render(<RenduGraphique ref={ref} titre="V" spec={spec({ forme: 'barres' })} jeu={jeu([])} />)
      expect(ref.current!.versDataUrl()).toBeNull()
      await ref.current!.telechargerPng('x')
      expect(toast.error).toHaveBeenCalledWith(
        "Le graphique n'est pas encore prêt : réessayez dans un instant."
      )
    })
  })

  describe('langues', () => {
    it('anglais : sens de lecture gauche-droite', async () => {
      langueTest.code = 'en'
      const { container } = render(
        <RenduGraphique titre="V" spec={spec({ forme: 'barres' })} jeu={JEU} modifiable />
      )
      expect((container.firstChild as HTMLElement).getAttribute('dir')).toBe('ltr')
      await waitFor(() => expect(faux.instances).toHaveLength(1))
    })

    it('arabe : dir rtl, sélecteur inversé, aucune classe left/right', async () => {
      langueTest.code = 'ar'
      const { container } = render(
        <RenduGraphique titre="V" spec={spec({ forme: 'secteurs' })} jeu={JEU_DOUZE} modifiable />
      )
      expect((container.firstChild as HTMLElement).getAttribute('dir')).toBe('rtl')
      expect(screen.getByRole('toolbar').getAttribute('dir')).toBe('rtl')
      expect(container.innerHTML).not.toMatch(/(?:^|[\s"'])-?(?:left|right|ml|mr|pl|pr)-/)
      await waitFor(() => expect(faux.instances).toHaveLength(1))
    })
  })
})
