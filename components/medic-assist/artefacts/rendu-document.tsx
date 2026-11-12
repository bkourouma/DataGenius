'use client'

/**
 * Rendu d'un artefact « document » : ses blocs, dans l'ordre.
 *
 * - texte : markdown sûr (`MarkdownRendu`), titres ancrés pour la table des matières ;
 * - tableau / graphique : spécification portée par le bloc, jeu pris dans `artefact.jeux` ;
 * - artefact : artefact lié (`artefactsLies[id]`), tableau, graphique ou indicateurs ; un lien
 *   absent donne un encart « artefact indisponible », sans aucune donnée.
 * Le graphique et les indicateurs sont rendus par des composants INJECTÉS par le parent.
 * Le titre du document n'est pas répété ici : la fiche qui l'affiche le porte déjà.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { FileWarning } from 'lucide-react'

import { RenduTableau } from './rendu-tableau'
import { MarkdownRendu } from './markdown-rendu'
import { TableDesMatieres } from './table-des-matieres'
import { useConteneurLarge } from './use-conteneur-large'
import { planDocument, tableDesMatieresUtile } from '@/lib/medic-assist/artefacts/document-outline'

import type {
  ArtefactDocument,
  CarteIndicateur,
  ContenuGraphique,
  ContenuTableau,
  GraphiqueSpec,
} from '@/lib/medic-assist/contrats'
import type { ArtefactClient, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

export interface PropsRenduGraphique {
  titre: string
  spec: GraphiqueSpec
  jeu: JeuClient
}

export interface PropsRenduIndicateurs {
  cartes: CarteIndicateur[]
  jeux: Record<string, JeuClient>
}

export interface RenduDocumentProps {
  artefact: ArtefactClient
  onSpecChange?: (spec: ArtefactDocument) => void
  renduGraphique: (props: PropsRenduGraphique) => React.ReactNode
  renduIndicateurs?: (props: PropsRenduIndicateurs) => React.ReactNode
}

function Indisponible({ titre, aide }: { titre: string; aide?: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
    >
      <FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium text-foreground">{titre}</p>
        {aide && <p className="mt-0.5">{aide}</p>}
      </div>
    </div>
  )
}

function TitreBloc({ children }: { children: string }) {
  return (
    <h3 dir="auto" className="mb-2 text-sm font-semibold text-foreground">
      {children}
    </h3>
  )
}

/** Largeur de conteneur à partir de laquelle la table des matières passe en colonne latérale. */
export const LARGEUR_COLONNE_TDM = 640

export function RenduDocument({
  artefact,
  onSpecChange,
  renduGraphique,
  renduIndicateurs,
}: RenduDocumentProps) {
  const t = useTranslations('medicAssistArtefacts.document')
  const doc = artefact.spec.type === 'document' ? artefact.spec : null
  const blocs = useMemo(() => doc?.blocs ?? [], [doc])
  const plan = useMemo(() => planDocument(blocs), [blocs])
  const avecTable = tableDesMatieresUtile(plan)
  const { ref: refArticle, large } = useConteneurLarge<HTMLElement>(LARGEUR_COLONNE_TDM)

  if (!doc) return <Indisponible titre={t('indisponible')} />
  if (blocs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('vide')}</p>
  }

  const remplacerTableau = (index: number, spec: ContenuTableau) => {
    onSpecChange?.({
      ...doc,
      blocs: doc.blocs.map((b, i) => (i === index && b.type === 'tableau' ? { ...b, spec } : b)),
    })
  }

  const graphique = (spec: ContenuGraphique, jeux: Record<string, JeuClient>) => {
    const jeu = jeux[spec.jeuDeDonneesId]
    if (!jeu) return <Indisponible titre={t('graphiqueIndisponible')} />
    return renduGraphique({ titre: spec.titre, spec: spec.graphique, jeu })
  }

  const rendreBloc = (bloc: ArtefactDocument['blocs'][number], index: number) => {
    switch (bloc.type) {
      case 'texte':
        return <MarkdownRendu markdown={bloc.markdown} idsTitres={plan.idsParBloc[index]} />
      case 'tableau': {
        const jeu = artefact.jeux[bloc.spec.jeuDeDonneesId]
        if (!jeu) return <Indisponible titre={t('tableauIndisponible')} />
        return (
          <div>
            <TitreBloc>{bloc.spec.titre}</TitreBloc>
            <RenduTableau
              spec={bloc.spec}
              jeu={jeu}
              modifiable={artefact.modifiable && Boolean(onSpecChange)}
              onSpecChange={spec => remplacerTableau(index, spec)}
            />
          </div>
        )
      }
      case 'graphique':
        return (
          <div>
            <TitreBloc>{bloc.spec.titre}</TitreBloc>
            {graphique(bloc.spec, artefact.jeux)}
          </div>
        )
      case 'artefact': {
        // `hasOwn` : un id « __proto__ » ou « constructor » ne doit rien résoudre.
        const lie =
          artefact.artefactsLies && Object.hasOwn(artefact.artefactsLies, bloc.artefactId)
            ? artefact.artefactsLies[bloc.artefactId]
            : undefined
        if (!lie) {
          return (
            <Indisponible titre={t('artefactIndisponible')} aide={t('artefactIndisponibleAide')} />
          )
        }
        const spec = lie.spec
        switch (spec.type) {
          case 'tableau': {
            const jeu = lie.jeux[spec.jeuDeDonneesId]
            if (!jeu) return <Indisponible titre={t('tableauIndisponible')} />
            return (
              <div>
                <TitreBloc>{lie.titre}</TitreBloc>
                <RenduTableau spec={spec} jeu={jeu} modifiable={false} />
              </div>
            )
          }
          case 'graphique': {
            const jeu = lie.jeux[spec.jeuDeDonneesId]
            if (!jeu) return <Indisponible titre={t('graphiqueIndisponible')} />
            return (
              <div>
                <TitreBloc>{lie.titre}</TitreBloc>
                {renduGraphique({ titre: spec.titre, spec: spec.graphique, jeu })}
              </div>
            )
          }
          case 'indicateurs':
            return renduIndicateurs ? (
              <div>
                <TitreBloc>{lie.titre}</TitreBloc>
                {renduIndicateurs({ cartes: spec.cartes, jeux: lie.jeux })}
              </div>
            ) : (
              <Indisponible titre={t('artefactIndisponible')} aide={t('artefactIndisponibleAide')} />
            )
          default:
            // Un document n'en contient pas un autre (un seul niveau).
            return (
              <Indisponible titre={t('artefactIndisponible')} aide={t('artefactIndisponibleAide')} />
            )
        }
      }
    }
  }

  return (
    <article
      ref={refArticle}
      aria-label={t('region', { titre: artefact.titre })}
      data-tdm={avecTable ? (large ? 'laterale' : 'repliee') : undefined}
      className={large && avecTable ? 'grid grid-cols-[minmax(0,1fr)_15rem] gap-8' : undefined}
    >
      {avecTable && (
        <aside
          className={
            large ? 'col-start-2 row-start-1 sticky top-20 self-start' : 'mb-4'
          }
        >
          <TableDesMatieres titres={plan.titres} large={large} />
        </aside>
      )}
      <div
        className={
          avecTable && large
            ? 'col-start-1 row-start-1 flex min-w-0 flex-col gap-6'
            : 'flex min-w-0 flex-col gap-6'
        }
      >
        {blocs.map((bloc, index) => (
          <div key={index} data-bloc={bloc.type} className="min-w-0">
            {rendreBloc(bloc, index)}
          </div>
        ))}
      </div>
    </article>
  )
}
