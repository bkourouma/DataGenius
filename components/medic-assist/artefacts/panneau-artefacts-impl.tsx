'use client'

import { Maximize2, Minimize2, X } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { VoletProvenance } from '@/components/medic-assist/commun/provenance-impl'
import { ActionsArtefact } from '@/components/medic-assist/suivi/actions-artefact'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  artefactsReferences,
  jeuxReferences,
  type Provenance,
} from '@/lib/medic-assist/contrats'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'
import { cn } from '@/lib/utils'

import { BarreOutilsArtefact, type ModeVueArtefact } from './barre-outils-artefact'
import { ID_ZONE_ARTEFACT, OngletsArtefacts, idOnglet } from './onglets-artefacts'
import {
  RenduArtefact,
  type RenduGraphiqueHandle,
  type RenduTableauHandle,
} from './rendu-artefact'
import { useArtefact } from './use-artefact'
import { useSuperpositionMobile } from './use-conteneur-large'
import { useArtefactsConversation, type ResumeArtefact } from './use-artefacts-conversation'

export interface PanneauArtefactsProps {
  conversationId: string
  /** Artefact affiché ; null/absent : le dernier de la conversation. */
  artefactActifId?: string | null
  onFermer: () => void
  onSelection: (artefactId: string) => void
}

/** SuperAdmin et TenantAdmin voient le SQL du volet « Comment j'ai calculé ». */
function useEstAdmin(): boolean {
  const { data: session } = useSession()
  const role = session?.user?.roleName
  return role === 'TenantAdmin'
}

/** Provenances des jeux d'un artefact, une par jeu référencé (liés d'un document compris). */
function provenancesDe(artefact: ArtefactClient): Provenance[] {
  const ids = new Set<string>(jeuxReferences(artefact.spec))
  const jeux = { ...artefact.jeux }
  if (artefact.spec.type === 'document') {
    for (const lie of artefactsReferences(artefact.spec)) {
      const cible = artefact.artefactsLies?.[lie]
      if (!cible) continue
      for (const id of jeuxReferences(cible.spec)) ids.add(id)
      Object.assign(jeux, cible.jeux)
    }
  }
  const resultat: Provenance[] = []
  for (const id of ids) {
    const jeu = jeux[id]
    if (jeu) resultat.push(jeu.provenance)
  }
  return resultat
}

const SELECTEURS_FOCUSABLES =
  'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// ---------------------------------------------------------------------------
// Contenu d'un artefact (clé = id : tout l'état local repart à zéro quand on change d'onglet)
// ---------------------------------------------------------------------------

interface ContenuArtefactProps {
  artefactId: string
  titreRepli?: string
  estAdmin: boolean
  /** Racine de l'artefact affiché, une fois connue (pour retrouver son onglet). */
  onRacine: (racineId: string) => void
  /** Une version vient d'être enregistrée : la liste des onglets se rafraîchit. */
  onEnregistre: () => void
}

function ContenuArtefact({
  artefactId,
  titreRepli,
  estAdmin,
  onRacine,
  onEnregistre,
}: ContenuArtefactProps) {
  const t = useTranslations('medicAssistArtefacts')
  const { toast } = useToast()
  const [version, setVersion] = useState<number | undefined>(undefined)
  const [vue, setVue] = useState<ModeVueArtefact>('natif')
  const [provenanceOuverte, setProvenanceOuverte] = useState(false)
  const idProvenance = useId()
  const refGraphique = useRef<RenduGraphiqueHandle>(null)
  const refTableau = useRef<RenduTableauHandle>(null)

  const { artefact, etat, erreur, recharger, enregistrerSpec, enregistrement, specLocale } =
    useArtefact(artefactId, version)

  const racineId = artefact?.racineId
  useEffect(() => {
    if (racineId) onRacine(racineId)
  }, [racineId, onRacine])

  useEffect(() => {
    if (enregistrement === 'enregistre') onEnregistre()
  }, [enregistrement, onEnregistre])

  const copier = useCallback(async () => {
    let ok = false
    try {
      ok = (await refTableau.current?.copierTsv()) ?? false
    } catch {
      ok = false
    }
    toast(
      ok
        ? { title: t('panneau.copieReussie') }
        : { variant: 'destructive', title: t('panneau.copieEchec') }
    )
  }, [t, toast])

  if (etat === 'erreur') {
    return (
      <div role="alert" className="grid justify-items-start gap-3 p-4">
        <p className="m-0 text-sm text-foreground">{t(`erreurs.${erreur ?? 'chargement'}`)}</p>
        <Button type="button" variant="outline" size="sm" onClick={recharger}>
          {t('panneau.reessayer')}
        </Button>
      </div>
    )
  }

  if (etat === 'chargement' || !artefact || !specLocale) {
    return (
      <div role="status" aria-busy="true" className="grid gap-3 p-4">
        <span className="sr-only">{t('panneau.chargement')}</span>
        {titreRepli ? <p className="m-0 text-base font-semibold">{titreRepli}</p> : null}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  const derniere = Math.max(artefact.version, ...artefact.versions.map(v => v.version))
  const versionAffichee = artefact.version
  const ancienne = versionAffichee < derniere
  // Une ancienne version se lit, elle ne s'édite pas ; les rendus reçoivent `modifiable: false`.
  const affiche: ArtefactClient = ancienne ? { ...artefact, modifiable: false } : artefact
  const provenances = provenancesDe(artefact)

  const graphiqueEnNatif = artefact.type === 'graphique' && vue === 'natif'
  const copiable = artefact.type === 'tableau' || (artefact.type === 'graphique' && vue === 'tableau')
  const telechargerPng = graphiqueEnNatif
    ? async (nomBase: string) => {
        const poignee = refGraphique.current
        if (!poignee) throw new Error('graphique indisponible')
        await poignee.telechargerPng(nomBase)
      }
    : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-3 border-b border-border p-3 sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 min-w-0 break-words text-lg font-semibold">{artefact.titre}</h2>
            {!artefact.modifiable ? (
              <Badge variant="outline">{t('panneau.lectureSeule')}</Badge>
            ) : null}
          </div>
          {artefact.sousTitre ? (
            <p className="m-0 mt-0.5 text-sm text-muted-foreground">{artefact.sousTitre}</p>
          ) : null}
        </div>
        <BarreOutilsArtefact
          artefact={artefact}
          versionAffichee={versionAffichee}
          onChoisirVersion={v => setVersion(v >= derniere ? undefined : v)}
          vue={vue}
          onVue={setVue}
          copiable={copiable}
          onCopier={() => void copier()}
          onTelechargerPng={telechargerPng}
          provenanceOuverte={provenanceOuverte}
          idProvenance={idProvenance}
          onProvenance={() => setProvenanceOuverte(v => !v)}
          enregistrement={enregistrement}
          actions={<ActionsArtefact artefactId={artefact.id} titre={artefact.titre} />}
        />
      </div>

      {ancienne ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-warning-soft px-4 py-2 text-sm"
        >
          <span>{t('panneau.version.bandeau', { n: versionAffichee })}</span>
          <Button type="button" variant="link" size="sm" onClick={() => setVersion(undefined)}>
            {t('panneau.version.revenir')}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <RenduArtefact
          artefact={affiche}
          spec={specLocale}
          onSpecChange={enregistrerSpec}
          refGraphique={refGraphique}
          refTableau={refTableau}
          vue={vue}
          onReessayer={recharger}
        />
        <div id={idProvenance} hidden={!provenanceOuverte} className="mt-4 grid gap-3">
          {provenanceOuverte
            ? provenances.map((p, i) => (
                <div key={`${p.libelleSource}-${i}`} className="grid gap-1">
                  {provenances.length > 1 ? (
                    <p className="m-0 text-xs font-semibold text-muted-foreground">
                      {t('panneau.jeuNumero', { n: i + 1, total: provenances.length })}
                    </p>
                  ) : null}
                  <VoletProvenance provenance={p} estAdmin={estAdmin} ouvertParDefaut />
                </div>
              ))
            : null}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panneau
// ---------------------------------------------------------------------------

/**
 * Panneau d'artefacts à droite du chat : onglets, versions, téléchargements, copie, plein
 * écran, volet « Comment j'ai calculé ». Il remplit son conteneur (le parent gère la largeur) ;
 * sous 640 px il devient une feuille plein écran.
 */
export function PanneauArtefacts({
  conversationId,
  artefactActifId,
  onFermer,
  onSelection,
}: PanneauArtefactsProps) {
  const t = useTranslations('medicAssistArtefacts')
  const estAdmin = useEstAdmin()
  const { artefacts, etat: etatListe, rafraichir } = useArtefactsConversation(conversationId)
  const [pleinChoisi, setPlein] = useState(false)
  const superposition = useSuperpositionMobile()
  // En feuille plein écran mobile, le panneau se comporte comme le plein écran (dialogue modal).
  const plein = pleinChoisi || superposition
  const [racineActive, setRacineActive] = useState<string | null>(null)
  const racineRef = useRef<HTMLElement>(null)
  const boutonPleinRef = useRef<HTMLButtonElement>(null)

  const idAffiche = artefactActifId ?? artefacts[artefacts.length - 1]?.id ?? null
  const ongletActif: ResumeArtefact | undefined =
    artefacts.find(a => a.id === idAffiche) ?? artefacts.find(a => a.racineId === racineActive)

  // Feuille mobile : on retient l'élément qui avait le focus avant l'ouverture, pour le lui rendre
  // à la fermeture par Échap. Cet effet précède les effets de focus ci-dessous.
  const ouvreurRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!superposition) return
    const actif = document.activeElement
    ouvreurRef.current =
      actif instanceof HTMLElement && actif !== document.body && !racineRef.current?.contains(actif)
        ? actif
        : null
  }, [superposition])

  // Le plein écran garde le focus dans le panneau et le rend au bouton à la sortie.
  const premierRendu = useRef(true)
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }
    boutonPleinRef.current?.focus()
  }, [plein])

  // Feuille mobile : le focus entre dans le panneau à l'ouverture.
  useEffect(() => {
    if (superposition) racineRef.current?.querySelector<HTMLElement>(SELECTEURS_FOCUSABLES)?.focus()
  }, [superposition])

  const surTouche = (evenement: KeyboardEvent<HTMLElement>) => {
    if (!plein) return
    if (evenement.key === 'Escape' && !evenement.defaultPrevented) {
      evenement.preventDefault()
      if (superposition) {
        const ouvreur = ouvreurRef.current
        ouvreurRef.current = null
        onFermer()
        // Le focus revient à l'élément qui avait ouvert la feuille, s'il est encore dans la page.
        if (ouvreur?.isConnected) ouvreur.focus()
      } else setPlein(false)
      return
    }
    if (evenement.key !== 'Tab') return
    const racine = racineRef.current
    if (!racine || !(evenement.target instanceof Node) || !racine.contains(evenement.target)) return
    const focusables = Array.from(racine.querySelectorAll<HTMLElement>(SELECTEURS_FOCUSABLES)).filter(
      el => !el.closest('[hidden]')
    )
    if (focusables.length === 0) return
    const premier = focusables[0]
    const dernier = focusables[focusables.length - 1]
    if (evenement.shiftKey && document.activeElement === premier) {
      evenement.preventDefault()
      dernier.focus()
    } else if (!evenement.shiftKey && document.activeElement === dernier) {
      evenement.preventDefault()
      premier.focus()
    }
  }

  let corps: React.ReactNode
  if (idAffiche) {
    corps = (
      <ContenuArtefact
        key={idAffiche}
        artefactId={idAffiche}
        titreRepli={ongletActif?.titre}
        estAdmin={estAdmin}
        onRacine={setRacineActive}
        onEnregistre={rafraichir}
      />
    )
  } else if (etatListe === 'chargement') {
    corps = (
      <div role="status" aria-busy="true" className="grid gap-3 p-4">
        <span className="sr-only">{t('panneau.chargementListe')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  } else if (etatListe === 'erreur') {
    corps = (
      <div role="alert" className="grid justify-items-start gap-3 p-4">
        <p className="m-0 text-sm">{t('erreurs.liste')}</p>
        <Button type="button" variant="outline" size="sm" onClick={rafraichir}>
          {t('panneau.reessayer')}
        </Button>
      </div>
    )
  } else {
    corps = (
      <div className="grid justify-items-center gap-1 p-8 text-center">
        <p className="m-0 text-base font-semibold">{t('panneau.vide.titre')}</p>
        <p className="m-0 max-w-sm text-sm text-muted-foreground">{t('panneau.vide.texte')}</p>
      </div>
    )
  }

  return (
    <section
      ref={racineRef}
      role={plein ? 'dialog' : 'region'}
      aria-modal={plein ? true : undefined}
      aria-label={plein ? t('panneau.pleinEcran') : t('panneau.region')}
      onKeyDown={surTouche}
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-border bg-card text-foreground',
        'max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:h-auto',
        plein && 'fixed inset-0 z-50 h-auto'
      )}
    >
      <header className="flex items-center gap-2 border-b border-border p-2">
        {artefacts.length > 0 ? (
          <OngletsArtefacts
            artefacts={artefacts}
            actifId={ongletActif?.id ?? null}
            onSelection={onSelection}
            libelle={t('panneau.listeOnglets')}
          />
        ) : (
          <p className="m-0 min-w-0 flex-1 truncate ps-2 text-sm font-semibold">
            {t('panneau.titre')}
          </p>
        )}
        <Button
          ref={boutonPleinRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={pleinChoisi}
          aria-label={pleinChoisi ? t('panneau.reduire') : t('panneau.agrandir')}
          title={pleinChoisi ? t('panneau.reduire') : t('panneau.agrandir')}
          className="cible-tactile max-sm:hidden"
          onClick={() => setPlein(v => !v)}
        >
          {pleinChoisi ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="cible-tactile"
          aria-label={t('panneau.fermer')}
          title={t('panneau.fermer')}
          onClick={onFermer}
        >
          <X aria-hidden />
        </Button>
      </header>

      <div
        id={ID_ZONE_ARTEFACT}
        role={ongletActif ? 'tabpanel' : undefined}
        aria-labelledby={ongletActif ? idOnglet(ongletActif.id) : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {corps}
      </div>
    </section>
  )
}
