'use client'

/**
 * Panneau repliable « Tableau croisé » d'un artefact tableau.
 *
 * Choisit les champs en lignes (1 à 3), en colonnes (0 à 2) et les valeurs (1 à 6) avec leur
 * agrégat. Chaque modification valide appelle `onChange(pivot)` ; « Tableau » ou « Retirer »
 * appellent `onChange(undefined)` (« Tableau » garde le brouillon pour revenir au croisé).
 * Les listes sont des `<select>` natifs : clavier et lecteurs d'écran sans réglage, et
 * assez hauts pour le doigt à 375 px.
 */

import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Plus, Table2, Trash2, TriangleAlert, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type {
  Agregat,
  ColonneJeu,
  ContenuTableau,
  Pivot,
} from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

export const LIMITES_PIVOT = {
  lignes: { min: 1, max: 3 },
  colonnes: { min: 0, max: 2 },
  valeurs: { min: 1, max: 6 },
} as const

const AGREGATS: Agregat[] = ['somme', 'moyenne', 'min', 'max', 'nombre']
const TYPES_DIMENSION: ColonneJeu['type'][] = ['texte', 'date', 'periode']
const TYPES_NUMERIQUES: ColonneJeu['type'][] = ['entier', 'decimal', 'montant', 'pourcentage']

export interface EditeurPivotProps {
  spec: ContenuTableau
  jeu: JeuClient | null | undefined
  /** Le panneau n'existe que pour le propriétaire. */
  modifiable?: boolean
  onChange: (pivot: Pivot | undefined) => void
  /** Ouvert d'emblée (défaut : ouvert si un tableau croisé est en place). */
  ouvertParDefaut?: boolean
}

type Valeur = Pivot['valeurs'][number]

const CLASSE_SELECT =
  'h-10 [@media(pointer:coarse)]:min-h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm ' +
  'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

function agregatParDefaut(colonne: ColonneJeu | undefined): Agregat {
  return colonne?.type === 'pourcentage' ? 'moyenne' : 'somme'
}

/**
 * Premier couple champ / agrégat encore libre, ou null.
 * D'abord l'agrégat par défaut de chaque champ (somme, ou moyenne pour un pourcentage) : une
 * 2e valeur additive est donc un autre champ en somme, et non le même champ en moyenne.
 * Les autres agrégats ne servent que lorsque tous les champs sont déjà pris par défaut.
 */
export function valeurLibre(numeriques: ColonneJeu[], prises: Valeur[]): Valeur | null {
  const prise = (cle: string, agregat: Agregat) =>
    prises.some(v => v.cle === cle && v.agregat === agregat)
  for (const c of numeriques) {
    const defaut = agregatParDefaut(c)
    if (!prise(c.cle, defaut)) return { cle: c.cle, agregat: defaut }
  }
  for (const c of numeriques) {
    for (const a of AGREGATS) {
      if (!prise(c.cle, a)) return { cle: c.cle, agregat: a }
    }
  }
  return null
}

export function EditeurPivot({
  spec,
  jeu,
  modifiable = false,
  onChange,
  ouvertParDefaut,
}: EditeurPivotProps) {
  const t = useTranslations('medicAssistArtefacts.tableau.pivot')
  const ta = useTranslations('medicAssistArtefacts.tableau')
  const idBase = useId()
  const [ouvert, setOuvert] = useState(ouvertParDefaut ?? Boolean(spec.pivot))
  // Dernier tableau croisé connu : « Tableau » le met de côté, « Tableau croisé » le rappelle.
  const [brouillon, setBrouillon] = useState<Pivot | null>(spec.pivot ?? null)
  useEffect(() => {
    if (spec.pivot) setBrouillon(spec.pivot)
  }, [spec.pivot])

  const colonnes = useMemo(() => jeu?.colonnes ?? [], [jeu])
  const dimensions = useMemo(() => colonnes.filter(c => TYPES_DIMENSION.includes(c.type)), [colonnes])
  const numeriques = useMemo(() => colonnes.filter(c => TYPES_NUMERIQUES.includes(c.type)), [colonnes])
  const parCle = useMemo(() => new Map(colonnes.map(c => [c.cle, c])), [colonnes])

  if (!modifiable || !jeu) return null

  const pivot = spec.pivot
  const peutCreer = dimensions.length > 0 && numeriques.length > 0

  const valider = (p: Pivot) => {
    setBrouillon(p)
    onChange(p)
  }

  const pivotInitial = (): Pivot | null => {
    if (brouillon) return brouillon
    if (!peutCreer) return null
    const valeur = valeurLibre(numeriques, [])
    if (!valeur) return null
    return { lignes: [dimensions[0].cle], colonnes: [], valeurs: [valeur] }
  }

  const afficherCroise = () => {
    const p = pivotInitial()
    if (p) valider(p)
  }

  const afficherTableau = () => {
    onChange(undefined)
  }

  const retirer = () => {
    setBrouillon(null)
    onChange(undefined)
  }

  // --- Lignes et colonnes ---------------------------------------------------

  const utilises = pivot ? [...pivot.lignes, ...pivot.colonnes] : []
  const doublons = new Set(utilises.filter((cle, i) => utilises.indexOf(cle) !== i))
  const libres = (courant: string | undefined) =>
    dimensions.filter(d => d.cle === courant || !utilises.includes(d.cle))

  const changerDimension = (groupe: 'lignes' | 'colonnes', index: number, cle: string) => {
    if (!pivot || !cle) return
    const liste = [...pivot[groupe]]
    liste[index] = cle
    valider({ ...pivot, [groupe]: liste })
  }

  const ajouterDimension = (groupe: 'lignes' | 'colonnes') => {
    if (!pivot) return
    const libre = dimensions.find(d => !utilises.includes(d.cle))
    if (!libre || pivot[groupe].length >= LIMITES_PIVOT[groupe].max) return
    valider({ ...pivot, [groupe]: [...pivot[groupe], libre.cle] })
  }

  const retirerDimension = (groupe: 'lignes' | 'colonnes', index: number) => {
    if (!pivot || pivot[groupe].length <= LIMITES_PIVOT[groupe].min) return
    valider({ ...pivot, [groupe]: pivot[groupe].filter((_, i) => i !== index) })
  }

  // --- Valeurs ------------------------------------------------------------------

  const changerValeur = (index: number, changement: Partial<Valeur>) => {
    if (!pivot) return
    const actuelle = pivot.valeurs[index]
    let suivante: Valeur = { ...actuelle, ...changement }
    const autres = pivot.valeurs.filter((_, i) => i !== index)
    if (autres.some(v => v.cle === suivante.cle && v.agregat === suivante.agregat)) {
      // Nouveau champ déjà pris avec cet agrégat : on prend le premier agrégat libre du champ.
      const colonne = parCle.get(suivante.cle)
      const libre = valeurLibre(colonne ? [colonne] : [], autres)
      if (!libre) return
      suivante = libre
    }
    const valeurs = [...pivot.valeurs]
    valeurs[index] = suivante
    valider({ ...pivot, valeurs })
  }

  const ajouterValeur = () => {
    if (!pivot || pivot.valeurs.length >= LIMITES_PIVOT.valeurs.max) return
    const libre = valeurLibre(numeriques, pivot.valeurs)
    if (libre) valider({ ...pivot, valeurs: [...pivot.valeurs, libre] })
  }

  const retirerValeur = (index: number) => {
    if (!pivot || pivot.valeurs.length <= LIMITES_PIVOT.valeurs.min) return
    valider({ ...pivot, valeurs: pivot.valeurs.filter((_, i) => i !== index) })
  }

  const sommePourcentage =
    pivot?.valeurs.some(v => v.agregat === 'somme' && parCle.get(v.cle)?.type === 'pourcentage') ?? false

  const idPanneau = `${idBase}-panneau`

  const groupeDimensions = (groupe: 'lignes' | 'colonnes', cle: 'champLigne' | 'champColonne', ajouter: 'ajouterLigne' | 'ajouterColonne', limite: 'limiteLignes' | 'limiteColonnes') => {
    if (!pivot) return null
    const liste = pivot[groupe]
    const max = LIMITES_PIVOT[groupe].max
    const min = LIMITES_PIVOT[groupe].min
    const reste = dimensions.some(d => !utilises.includes(d.cle))
    return (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t(groupe)}</legend>
        {liste.map((valeur, index) => {
          const id = `${idBase}-${groupe}-${index}`
          return (
            <div key={`${valeur}-${index}`} className="flex items-center gap-2">
              <label htmlFor={id} className="sr-only">
                {t(cle, { n: index + 1 })}
              </label>
              <select
                id={id}
                className={CLASSE_SELECT}
                value={valeur}
                onChange={event => changerDimension(groupe, index, event.target.value)}
              >
                {libres(valeur).map(d => (
                  <option key={d.cle} value={d.cle}>
                    {d.libelle}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                disabled={liste.length <= min}
                title={liste.length <= min && min > 0 ? t('minLignes') : undefined}
                aria-label={t('retirerChamp', { n: index + 1 })}
                onClick={() => retirerDimension(groupe, index)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 gap-1 [@media(pointer:coarse)]:h-11"
            disabled={liste.length >= max || !reste}
            onClick={() => ajouterDimension(groupe)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t(ajouter)}
          </Button>
          {liste.length >= max && <p className="text-xs text-muted-foreground">{t(limite)}</p>}
        </div>
      </fieldset>
    )
  }

  return (
    <section className="rounded-lg border bg-card" aria-label={t('titre')}>
      <h3 className="m-0">
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={ouvert}
          aria-controls={idPanneau}
          onClick={() => setOuvert(v => !v)}
        >
          <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1">{t('titre')}</span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', ouvert && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </h3>

      {ouvert && (
        <div id={idPanneau} className="flex flex-col gap-4 border-t p-3">
          <p className="text-sm text-muted-foreground">{t('aide')}</p>

          <div role="group" aria-label={t('vue')} className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={pivot ? 'outline' : 'default'}
              aria-pressed={!pivot}
              className="h-10 flex-1 [@media(pointer:coarse)]:h-11 sm:flex-none"
              onClick={afficherTableau}
            >
              {t('vueTableau')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={pivot ? 'default' : 'outline'}
              aria-pressed={Boolean(pivot)}
              disabled={!pivot && !brouillon && !peutCreer}
              className="h-10 flex-1 [@media(pointer:coarse)]:h-11 sm:flex-none"
              onClick={afficherCroise}
            >
              {t('vueCroise')}
            </Button>
          </div>

          {!pivot && !brouillon && dimensions.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('aucunChampLigne')}</p>
          )}
          {!pivot && !brouillon && dimensions.length > 0 && numeriques.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('aucunChampValeur')}</p>
          )}

          {pivot && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {groupeDimensions('lignes', 'champLigne', 'ajouterLigne', 'limiteLignes')}
                {groupeDimensions('colonnes', 'champColonne', 'ajouterColonne', 'limiteColonnes')}
              </div>

              {doublons.size > 0 && (
                <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('doublon')}
                </p>
              )}

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t('valeurs')}</legend>
                {pivot.valeurs.map((valeur, index) => {
                  const idChamp = `${idBase}-valeur-${index}`
                  const idAgregat = `${idBase}-agregat-${index}`
                  return (
                    <div
                      key={`${valeur.cle}-${valeur.agregat}-${index}`}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                    >
                      <label htmlFor={idChamp} className="sr-only">
                        {t('champValeur', { n: index + 1 })}
                      </label>
                      <select
                        id={idChamp}
                        className={CLASSE_SELECT}
                        value={valeur.cle}
                        onChange={event => changerValeur(index, { cle: event.target.value })}
                      >
                        {numeriques.map(c => (
                          <option key={c.cle} value={c.cle}>
                            {c.libelle}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <label htmlFor={idAgregat} className="sr-only">
                          {t('agregatValeur', { n: index + 1 })}
                        </label>
                        <select
                          id={idAgregat}
                          className={CLASSE_SELECT}
                          value={valeur.agregat}
                          onChange={event => changerValeur(index, { agregat: event.target.value as Agregat })}
                        >
                          {AGREGATS.filter(
                            a =>
                              a === valeur.agregat ||
                              !pivot.valeurs.some(v => v.cle === valeur.cle && v.agregat === a)
                          ).map(a => (
                            <option key={a} value={a}>
                              {ta(`agregats.${a}`)}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                          disabled={pivot.valeurs.length <= LIMITES_PIVOT.valeurs.min}
                          title={pivot.valeurs.length <= LIMITES_PIVOT.valeurs.min ? t('minValeurs') : undefined}
                          aria-label={t('retirerValeur', { n: index + 1 })}
                          onClick={() => retirerValeur(index)}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 gap-1 [@media(pointer:coarse)]:h-11"
                    disabled={
                      pivot.valeurs.length >= LIMITES_PIVOT.valeurs.max ||
                      !valeurLibre(numeriques, pivot.valeurs)
                    }
                    onClick={ajouterValeur}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {t('ajouterValeur')}
                  </Button>
                  {pivot.valeurs.length >= LIMITES_PIVOT.valeurs.max && (
                    <p className="text-xs text-muted-foreground">{t('limiteValeurs')}</p>
                  )}
                </div>
              </fieldset>

              {sommePourcentage && (
                <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  {ta('avertissements.sommePourcentage')}
                </p>
              )}
            </>
          )}

          {(pivot || brouillon) && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 gap-1 text-destructive hover:text-destructive [@media(pointer:coarse)]:h-11"
                onClick={retirer}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('retirer')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
