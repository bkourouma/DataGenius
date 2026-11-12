/**
 * Chargement à la demande d'ECharts (modules ciblés, pas le paquet complet).
 *
 * Isolé dans son propre module : c'est la seule frontière avec le paquet `echarts`, ce qui permet
 * de le remplacer dans les tests des composants. Le chargement est partagé (une seule fois par
 * page) et relancé après un échec (réseau coupé, découpage de code introuvable).
 */

/** Ce que les composants utilisent d'une instance ECharts (indépendant des types du paquet). */
export interface InstanceEcharts {
  setOption(option: unknown, options?: { notMerge?: boolean }): void
  resize(): void
  dispose(): void
  getDataURL(options?: OptionsImageEcharts): string
  /** Rendu serveur (`ssr: true`, sans DOM) : le SVG complet. */
  renderToSVGString?(): string
}

export interface OptionsImageEcharts {
  type?: 'png' | 'jpeg' | 'svg'
  pixelRatio?: number
  backgroundColor?: string
}

export interface ModuleEchartsCore {
  init(
    dom: HTMLElement | null,
    theme?: string | object | null,
    options?: { renderer?: 'canvas' | 'svg'; ssr?: boolean; width?: number; height?: number }
  ): unknown
  use(extensions: unknown[]): void
}

let chargement: Promise<ModuleEchartsCore> | null = null

export function chargerEcharts(): Promise<ModuleEchartsCore> {
  if (!chargement) {
    chargement = Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
      import('echarts/features'),
    ])
      .then(([core, charts, components, renderers, features]) => {
        core.use([
          charts.BarChart,
          charts.LineChart,
          charts.PieChart,
          charts.ScatterChart,
          charts.HeatmapChart,
          charts.TreemapChart,
          charts.FunnelChart,
          charts.GaugeChart,
          components.GridComponent,
          components.TooltipComponent,
          components.LegendComponent,
          components.DataZoomComponent,
          components.VisualMapComponent,
          components.TitleComponent,
          components.AriaComponent,
          components.DatasetComponent,
          components.MarkLineComponent,
          components.MarkPointComponent,
          features.LabelLayout,
          // `grid.containLabel` (graphique-option) en dépend dans ECharts 6.
          features.LegacyGridContainLabel,
          renderers.CanvasRenderer,
          renderers.SVGRenderer,
        ])
        return core as unknown as ModuleEchartsCore
      })
      .catch((erreur: unknown) => {
        chargement = null
        throw erreur
      })
  }
  return chargement
}
