'use client'

/**
 * Rendu d'un artefact « tableau » (avec tableau croisé) sur le DataGrid du dépôt.
 *
 * Le modèle (colonnes, filtres de la spécification, tri, totaux, pivot) est calculé par
 * `construireModeleTableau` ; le DataGrid apporte recherche, tri au clic, colonnes
 * visibles, densité, plein écran et export Excel, sans modification.
 *
 * Ce que le DataGrid ne laisse pas observer (aucun callback) est lu par le pied de
 * tableau, qui reçoit l'instance TanStack : tri en cours et état affiché (pour la copie).
 * Remontée par `onSpecChange` (si `modifiable`) : le TRI d'un tableau à plat après une
 * action de l'utilisateur, et le TABLEAU CROISÉ choisi dans l'éditeur (bouton « Modifier le
 * tableau croisé », propriétaire seulement ; `pivot: undefined` le retire). Les colonnes masquées restent des préférences
 * locales du DataGrid (stockage du navigateur) et la recherche libre est un filtre
 * d'affichage : ni l'une ni l'autre n'entre dans la spécification.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertCircle, Table2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DataGrid } from '@/components/ui/data-grid'
import { EditeurPivot } from './editeur-pivot'
import { Skeleton } from '@/components/ui/skeleton'
import { creerFormateur, estFormatNumerique } from '@/lib/medic-assist/artefacts/formats'
import { construireModeleTableau, estFormatAdditif } from '@/lib/medic-assist/artefacts/modele-tableau'
import { modeleVersTsv } from '@/lib/medic-assist/artefacts/tsv'

import type { ColumnDef, SortingState, Table } from '@tanstack/react-table'
import type { DataGridColumnMeta } from '@/components/ui/data-grid'
import type { FormatColonne as FormatExcel } from '@/lib/client/export-utils'
import type {
  Agregat,
  ContenuTableau,
  FormatColonne,
  Pivot,
} from '@/lib/medic-assist/contrats'
import type {
  ColonneModele,
  JeuClient,
  ModeleTableau,
} from '@/lib/medic-assist/artefacts/types-rendu'

type Ligne = Record<string, unknown>

export interface RenduTableauProps {
  spec: ContenuTableau
  /** Absent tant que le jeu se charge : un squelette est affiché. */
  jeu: JeuClient | null | undefined
  /** Propriétaire de l'artefact : le tri choisi à l'écran remonte par `onSpecChange`. */
  modifiable?: boolean
  onSpecChange?: (spec: ContenuTableau) => void
  /** Hauteur maximale de la zone défilante, en pixels. */
  hauteurMax?: number
  /** Préfixe des préférences locales (colonnes, densité) ; défaut : jeu + titre. */
  cleStockage?: string
}

export interface RenduTableauHandle {
  /** Copie le tableau affiché (filtres, tri, colonnes visibles) en TSV ; false si le navigateur refuse. */
  copierTsv(): Promise<boolean>
  /** Modèle du tableau tel qu'affiché. */
  modele(): ModeleTableau
}

/** Format Excel du DataGrid pour un format de colonne de l'artefact. */
export function formatExcelDe(format: FormatColonne): FormatExcel {
  switch (format) {
    case 'montant':
    case 'montant_compact':
      return 'montant'
    case 'pourcentage':
      return 'pourcentage'
    case 'date':
      return 'date'
    case 'entier':
      return 'entier'
    case 'decimal':
      return 'decimal'
    default:
      // texte et période : du texte (un « 2026-04 » ne doit pas devenir une date).
      return 'texte'
  }
}

function empreinte(texte: string): string {
  let h = 5381
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function nomFichier(titre: string): string {
  const base = titre
    .normalize('NFKD')
    .replace(/[̀-ͯ]+/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'tableau'
}

/** Copie un texte dans le presse-papiers (API moderne, puis repli `execCommand`). */
async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texte)
      return true
    }
  } catch {
    // Refus du navigateur (permission, contexte non sécurisé) : repli ci-dessous.
  }
  try {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
    const zone = document.createElement('textarea')
    zone.value = texte
    zone.setAttribute('readonly', '')
    zone.style.position = 'fixed'
    zone.style.insetBlockStart = '0'
    zone.style.opacity = '0'
    document.body.appendChild(zone)
    zone.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(zone)
    return ok
  } catch {
    return false
  }
}

/** Modèle tel qu'affiché : colonnes visibles, lignes filtrées par la recherche et triées. */
function modeleAffiche(base: ModeleTableau, table: Table<Ligne> | null): ModeleTableau {
  if (!table) return base
  const visibles = new Set(table.getVisibleLeafColumns().map(c => c.id))
  const colonnes = base.colonnes.filter(c => visibles.has(c.id))
  if (colonnes.length === 0) return base
  const lignes = table.getSortedRowModel().rows.map(r => r.original)
  const totaux = base.totaux
    ? Object.fromEntries(colonnes.map(c => [c.id, base.totaux?.[c.id] ?? null]))
    : null
  return { ...base, colonnes, lignes, totaux }
}

// ---------------------------------------------------------------------------
// Pied du tableau : compteur, avertissement, observation du DataGrid
// ---------------------------------------------------------------------------

interface PiedProps {
  table: Table<Ligne>
  tronque: boolean
  nbChargees: number
  interactionRef: React.MutableRefObject<boolean>
  onTable: (table: Table<Ligne>) => void
  onTri: (tri: SortingState) => void
}

function PiedTableau({ table, tronque, nbChargees, interactionRef, onTable, onTri }: PiedProps) {
  const t = useTranslations('medicAssistArtefacts.tableau')
  const tri = table.getState().sorting
  const signature = JSON.stringify(tri)
  const derniere = useRef(signature)
  const n = table.getSortedRowModel().rows.length

  useEffect(() => {
    onTable(table)
  }, [table, onTable])

  useEffect(() => {
    if (signature === derniere.current) return
    derniere.current = signature
    // Un tri qui n'est pas un geste de l'utilisateur (montage, rechargement) ne remonte pas.
    if (!interactionRef.current) return
    onTri(JSON.parse(signature) as SortingState)
  }, [signature, interactionRef, onTri])

  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p data-testid="compteur-tableau" className="tabular-nums">
        {t('nbLignes', { n })}
      </p>
      {tronque && (
        <p role="status" className="flex items-start gap-1.5 text-xs">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('tronque', { n: nbChargees })}</span>
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export const RenduTableau = forwardRef<RenduTableauHandle, RenduTableauProps>(function RenduTableau(
  { spec, jeu, modifiable = false, onSpecChange, hauteurMax, cleStockage },
  ref
) {
  const t = useTranslations('medicAssistArtefacts.tableau')
  const locale = useLocale()

  // Réinitialisation locale des filtres : vaut aussi pour un lecteur qui ne peut rien enregistrer.
  const [sansFiltres, setSansFiltres] = useState(false)
  const signatureFiltres = JSON.stringify(spec.filtres ?? null)
  useEffect(() => {
    setSansFiltres(false)
  }, [signatureFiltres])
  const specEffective = useMemo<ContenuTableau>(
    () => (sansFiltres ? { ...spec, filtres: undefined } : spec),
    [spec, sansFiltres]
  )

  const calcul = useMemo(() => {
    if (!jeu) return null
    try {
      const modele = construireModeleTableau(jeu, specEffective, {
        locale,
        libelleAgregat: (agregat: Agregat) => t(`agregats.${agregat}`),
      })
      return { modele, erreur: false }
    } catch {
      return { modele: null, erreur: true }
    }
    // `t` change d'identité à chaque rendu avec le mock des tests ; la langue suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeu, specEffective, locale])
  const modele = calcul?.modele ?? null

  const tableRef = useRef<Table<Ligne> | null>(null)
  const interactionRef = useRef(false)
  const modeleRef = useRef<ModeleTableau | null>(modele)
  modeleRef.current = modele
  const specRef = useRef(spec)
  specRef.current = spec
  const surChangement = useRef(onSpecChange)
  surChangement.current = onSpecChange
  const modifiableRef = useRef(modifiable)
  modifiableRef.current = modifiable
  const [editeurOuvert, setEditeurOuvert] = useState(false)
  const libelleTotalRef = useRef(t('total'))
  libelleTotalRef.current = t('total')

  const surTable = useCallback((table: Table<Ligne>) => {
    tableRef.current = table
  }, [])

  const cleGrille = spec.pivot ? `croise-${empreinte(JSON.stringify(spec.pivot))}` : 'plat'
  // Tri de départ figé tant que la structure ne change pas : retirer un tri revient au tri
  // d'origine, pas au dernier tri remonté dans la spécification.
  const triDepart = useRef<{ cle: string; tri: SortingState } | null>(null)
  if (!triDepart.current || triDepart.current.cle !== cleGrille) {
    triDepart.current = {
      cle: cleGrille,
      tri: spec.pivot
        ? []
        : (spec.tri ?? []).map(entree => ({ id: entree.cle, desc: entree.sens === 'desc' })),
    }
  }

  const surTri = useCallback(
    (tri: SortingState) => {
      const courante = modeleRef.current
      if (!modifiableRef.current || !surChangement.current || !courante || courante.estPivot) return
      const ids = new Set(courante.colonnes.map(c => c.id))
      const valide = tri.filter(e => ids.has(e.id))
      const suivante: ContenuTableau = {
        ...specRef.current,
        tri: valide.length > 0 ? valide.map(e => ({ cle: e.id, sens: e.desc ? 'desc' : 'asc' })) : undefined,
      }
      surChangement.current(suivante)
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      async copierTsv() {
        const base = modeleRef.current
        if (!base) {
          toast.error(t('copie.echec'))
          return false
        }
        const texte = modeleVersTsv(modeleAffiche(base, tableRef.current), {
          locale,
          libelleTotal: libelleTotalRef.current,
        })
        const ok = await copierTexte(texte)
        if (ok) toast.success(t('copie.succes'))
        else toast.error(t('copie.echec'))
        return ok
      },
      modele() {
        const base = modeleRef.current
        if (!base) {
          return {
            colonnes: [],
            lignes: [],
            totaux: null,
            estPivot: false,
            nbLignesSource: 0,
            nbLignesFiltrees: 0,
          }
        }
        return modeleAffiche(base, tableRef.current)
      },
    }),
    // `t` : voir plus haut ; la langue suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale]
  )

  const libelleTotal = t('total')
  const colonnes = useMemo<ColumnDef<Ligne, unknown>[]>(() => {
    if (!modele) return []
    return modele.colonnes.map((c: ColonneModele, index) => {
      const formateur = creerFormateur(c.format, locale, { unite: c.unite })
      const numerique = estFormatNumerique(c.format)
      const meta: DataGridColumnMeta<Ligne> = {
        label: c.libelle,
        align: c.alignement,
        exportFormat: formatExcelDe(c.format),
        cellClassName: numerique ? 'tabular-nums' : undefined,
      }
      // Cumul par retrait de colonne : pertinent pour un tableau à plat seulement. Les
      // cellules d'un pivot sont déjà des agrégats (une moyenne ne se re-somme pas).
      if (!modele.estPivot) {
        if (c.type === 'dimension') meta.dimension = true
        else if (estFormatAdditif(c.format)) meta.agregat = 'somme'
      }
      const totaux = modele.totaux
      return {
        id: c.id,
        accessorFn: (ligne: Ligne) => ligne[c.id] ?? null,
        header: c.libelle,
        cell: ({ getValue }) => <span className={numerique ? 'tabular-nums' : undefined}>{formateur(getValue())}</span>,
        footer: totaux
          ? () => {
              const valeur = formateur(totaux[c.id])
              const texte =
                index === 0 ? (valeur ? `${libelleTotal} ${valeur}` : libelleTotal) : valeur
              return <span className={numerique ? 'tabular-nums' : undefined}>{texte}</span>
            }
          : undefined,
        meta,
      } satisfies ColumnDef<Ligne, unknown>
    })
  }, [modele, locale, libelleTotal])

  const sousTitres = useMemo(() => {
    if (!jeu) return []
    return [spec.sousTitre, jeu.provenance.periode?.libelle, jeu.provenance.perimetre.libelle].filter(
      (s): s is string => Boolean(s)
    )
  }, [jeu, spec.sousTitre])

  const peutEditerPivot = modifiable && Boolean(onSpecChange)
  const surPivot = useCallback((pivot: Pivot | undefined) => {
    if (!modifiableRef.current || !surChangement.current) return
    surChangement.current({ ...specRef.current, pivot })
  }, [])

  const filtresActifs = (specEffective.filtres?.length ?? 0) > 0
  const reinitialiserFiltres = useCallback(() => {
    setSansFiltres(true)
    if (modifiableRef.current && surChangement.current) {
      surChangement.current({ ...specRef.current, filtres: undefined })
    }
  }, [])
  const filtresAReinitialiser = (spec.filtres?.length ?? 0) > 0 && !sansFiltres

  if (!jeu) {
    return (
      <div role="status" aria-label={t('chargement')} className="flex flex-col gap-2 rounded-lg border p-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    )
  }

  if (!modele) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
      >
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('erreur')}
      </div>
    )
  }

  const messageVide = filtresActifs
    ? { titre: t('vide.titre'), description: t('vide.description') }
    : { titre: t('vide.titreSansFiltre'), description: t('vide.descriptionSansFiltre') }

  return (
    <section
      aria-label={t('regionLabel', { titre: spec.titre })}
      className="min-w-0"
      onPointerDownCapture={() => {
        interactionRef.current = true
      }}
      onKeyDownCapture={() => {
        interactionRef.current = true
      }}
      onClickCapture={() => {
        interactionRef.current = true
      }}
    >
      {peutEditerPivot && (
        <div className="mb-2 flex flex-col gap-2">
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={editeurOuvert}
              onClick={() => setEditeurOuvert(v => !v)}
            >
              <Table2 aria-hidden="true" />
              {t('modifierPivot')}
            </Button>
          </div>
          {editeurOuvert && (
            <EditeurPivot spec={spec} jeu={jeu} modifiable ouvertParDefaut onChange={surPivot} />
          )}
        </div>
      )}
      <DataGrid<Ligne>
        key={cleGrille}
        columns={colonnes}
        data={modele.lignes}
        getRowId={(_ligne, index) => String(index)}
        storageKey={
          cleStockage
            ? `${cleStockage}.${cleGrille}`
            : `medicassist.tableau.${jeu.jeuDeDonneesId}.${empreinte(spec.titre)}.${cleGrille}`
        }
        triInitial={triDepart.current.tri}
        afficherCompteur={false}
        exportFileName={nomFichier(spec.titre)}
        exportTitle={spec.titre}
        exportSubtitle={sousTitres.length > 0 ? sousTitres : undefined}
        maxHeight={hauteurMax ? `${hauteurMax}px` : undefined}
        emptyState={{
          title: messageVide.titre,
          description: messageVide.description,
          action:
            filtresAReinitialiser ? (
              <Button variant="outline" size="sm" onClick={reinitialiserFiltres}>
                {t('vide.reinitialiser')}
              </Button>
            ) : undefined,
        }}
        renderFooter={table => (
          <PiedTableau
            table={table}
            tronque={jeu.tronque}
            nbChargees={jeu.lignes.length}
            interactionRef={interactionRef}
            onTable={surTable}
            onTri={surTri}
          />
        )}
      />
    </section>
  )
})
