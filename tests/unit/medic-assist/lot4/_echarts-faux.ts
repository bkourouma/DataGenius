/**
 * Faux ECharts pour les tests de composants du lot 4 (le paquet n'est pas installé ici).
 *
 * Un import statique de `echarts/core` ne se résout pas sans le paquet (Vite le refuse même avec
 * `vi.mock`) : le chargement est donc isolé dans `echarts-chargeur.ts`, que l'on remplace ici.
 * Usage, en tête d'un fichier de test (les `vi.mock` sont remontés par Vitest) :
 *   vi.mock('@/components/medic-assist/artefacts/echarts-chargeur', async () =>
 *     (await import('./_echarts-faux')).moduleChargeur())
 *
 * `faux.instances` garde chaque instance créée ; `faux.echecInit` fait échouer `init` ;
 * `faux.echecChargement` fait échouer le chargement des modules.
 */
import { vi } from 'vitest'

export interface FausseInstance {
  setOption: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  getDataURL: ReturnType<typeof vi.fn>
}

export const faux = {
  instances: [] as FausseInstance[],
  echecInit: false,
  echecChargement: false,
  reinitialiser() {
    this.instances = []
    this.echecInit = false
    this.echecChargement = false
  },
  derniere(): FausseInstance {
    return this.instances[this.instances.length - 1]
  },
  derniereOption(): Record<string, unknown> {
    return this.derniere().setOption.mock.calls.at(-1)?.[0] as Record<string, unknown>
  },
}

export function moduleCore() {
  return {
    use: (_extensions: unknown[]) => {},
    init: (_dom: unknown, _theme: unknown, _options: unknown) => {
      if (faux.echecInit) throw new Error('init impossible')
      const instance: FausseInstance = {
        setOption: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
        getDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
      }
      faux.instances.push(instance)
      return instance
    },
  }
}

/** Remplace `echarts-chargeur` : `chargerEcharts()` rend le faux noyau (ou échoue si `echecChargement`). */
export function moduleChargeur() {
  return {
    chargerEcharts: () =>
      faux.echecChargement
        ? Promise.reject(new Error('chargement impossible'))
        : Promise.resolve(moduleCore()),
  }
}
