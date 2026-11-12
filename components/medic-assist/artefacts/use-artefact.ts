'use client'

/**
 * Chargement et édition d'un artefact Medic Assist.
 *
 * - Lecture : GET /api/medic-assist/artefacts/[id]?version=n (annulée si l'artefact, la
 *   version ou le composant changent). La réponse est une `ArtefactReponse` (pas d'enveloppe),
 *   convertie en `ArtefactClient` par `reponseVersClient`.
 * - Édition : `enregistrerSpec` met la spécification à jour tout de suite (rendu optimiste)
 *   puis envoie un PATCH anti-rebond (700 ms). Une seule requête est en vol : les éditions
 *   arrivées pendant l'envoi sont regroupées et la dernière spécification gagne. Le PATCH
 *   crée une NOUVELLE version : l'artefact est remplacé par la réponse du serveur. Le corps
 *   est `{ spec, versionAttendue }` (version affichée). Réponse 409 (une version plus récente
 *   existe) : la dernière version est rechargée et un message l'explique. Autre échec : un
 *   message s'affiche et la spécification revient à la dernière version connue du serveur.
 * - Les éditions en attente sont envoyées au démontage et au changement d'artefact ou de
 *   version (aucune modification perdue en fermant le panneau).
 * - Aucune mise à jour d'état après démontage.
 */

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/hooks/use-toast'
import { reponseVersClient } from '@/lib/medic-assist/artefacts/client-mapper'
import type { ArtefactReponse } from '@/lib/medic-assist/artefacts/reponse'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'
import type { ArtefactSpec } from '@/lib/medic-assist/contrats'

export const DELAI_ANTI_REBOND_MS = 700

export type EtatArtefact = 'chargement' | 'pret' | 'erreur'
export type EtatEnregistrement = 'repos' | 'en_cours' | 'enregistre' | 'erreur'
/** Clé de message `erreurs.<code>` du namespace medicAssistArtefacts. */
export type CodeErreurArtefact = 'introuvable' | 'chargement'

export interface OptionsUseArtefact {
  /** Faux : ne charge rien (carte du fil avant survol). Vrai par défaut. */
  actif?: boolean
}

export interface RetourUseArtefact {
  artefact: ArtefactClient | null
  etat: EtatArtefact
  erreur: CodeErreurArtefact | null
  recharger: () => void
  /** Rendu optimiste immédiat, envoi anti-rebond. Sans effet en lecture seule. */
  enregistrerSpec: (spec: ArtefactSpec) => void
  enregistrement: EtatEnregistrement
  /** Spécification à afficher : l'édition locale en cours, sinon celle du serveur. */
  specLocale: ArtefactSpec | null
  /** Vrai si l'artefact ne peut pas être modifié ici (autre lecteur ou ancienne version). */
  lectureSeule: boolean
}

function urlArtefact(id: string, version?: number): string {
  const base = `/api/medic-assist/artefacts/${encodeURIComponent(id)}`
  return version === undefined ? base : `${base}?version=${version}`
}

/** Envoi des éditions d'UN artefact : vit le temps que l'artefact est affiché. */
interface Sauvegarde {
  /** Faux après démontage ou changement d'artefact : plus aucune mise à jour d'état. */
  actif: boolean
  enregistrer(spec: ArtefactSpec): void
  /** Envoie tout de suite l'édition en attente. */
  vider(): void
  /** Dernière version connue du serveur (id de la réponse, spec de retour arrière). */
  definirBase(artefact: ArtefactClient): void
}

/** Lit une `ArtefactReponse` ; lève si le corps n'en a pas la forme. */
async function lireReponse(
  reponse: Response,
  racineId?: string
): Promise<ArtefactClient> {
  const corps = (await reponse.json()) as Partial<ArtefactReponse> | null
  if (!corps || typeof corps.id !== 'string' || !corps.spec || !Array.isArray(corps.versions)) {
    throw new Error('reponse')
  }
  return reponseVersClient(corps as ArtefactReponse, { racineId })
}

interface RappelsSauvegarde {
  surDebut(): void
  /** `plusRecent` : d'autres éditions attendent, elles gardent la main sur l'affichage. */
  surSucces(artefact: ArtefactClient, plusRecent: boolean): void
  /** `base` : dernière version serveur à rétablir. */
  surEchec(base: ArtefactClient | null): void
  /** Réponse 409 : `derniere` est la version la plus récente rechargée (null si échec). */
  surConflit(derniere: ArtefactClient | null, base: ArtefactClient | null): void
}

function creerSauvegarde(
  idInitial: string,
  rappels: RappelsSauvegarde,
  delaiMs: number
): Sauvegarde {
  let idServeur = idInitial
  let base: ArtefactClient | null = null
  let enAttente: ArtefactSpec | null = null
  let minuteur: ReturnType<typeof setTimeout> | null = null
  let enVol = false

  const sauvegarde: Sauvegarde = {
    actif: true,
    enregistrer(spec) {
      enAttente = spec
      if (minuteur) clearTimeout(minuteur)
      minuteur = setTimeout(envoyer, delaiMs)
    },
    vider() {
      if (minuteur) {
        clearTimeout(minuteur)
        minuteur = null
      }
      envoyer()
    },
    definirBase(artefact) {
      base = artefact
      idServeur = artefact.id
    },
  }

  function envoyer() {
    minuteur = null
    // Une seule requête en vol : la fin de la précédente relance l'envoi.
    if (enVol || enAttente === null) return
    const spec = enAttente
    enAttente = null
    enVol = true
    if (sauvegarde.actif) rappels.surDebut()

    void (async () => {
      try {
        const reponse = await fetch(urlArtefact(idServeur), {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spec,
            ...(base ? { versionAttendue: base.version } : {}),
          }),
        })
        if (reponse.status === 409) {
          // Une version plus récente existe : on la recharge et on abandonne l'édition.
          enVol = false
          enAttente = null
          if (minuteur) {
            clearTimeout(minuteur)
            minuteur = null
          }
          let derniere: ArtefactClient | null = null
          try {
            const relue = await fetch(urlArtefact(idServeur), { credentials: 'same-origin' })
            if (relue.ok) derniere = await lireReponse(relue, base?.racineId)
          } catch {
            derniere = null
          }
          if (derniere) {
            base = derniere
            idServeur = derniere.id
          }
          rappels.surConflit(derniere, base)
          return
        }
        if (!reponse.ok) throw new Error(String(reponse.status))
        const nouveau = await lireReponse(reponse, base?.racineId)
        base = nouveau
        idServeur = nouveau.id
        enVol = false
        // Des éditions plus récentes ont suivi : elles gardent la main sur l'affichage.
        const plusRecent = enAttente !== null
        if (sauvegarde.actif) rappels.surSucces(nouveau, plusRecent)
        if (plusRecent && !minuteur) envoyer()
      } catch {
        enVol = false
        // Les éditions suivantes reposaient sur la version refusée : on les abandonne.
        enAttente = null
        if (minuteur) {
          clearTimeout(minuteur)
          minuteur = null
        }
        rappels.surEchec(base)
      }
    })()
  }

  return sauvegarde
}

export function useArtefact(
  artefactId: string,
  version?: number,
  options: OptionsUseArtefact = {}
): RetourUseArtefact {
  const actif = options.actif ?? true
  const t = useTranslations('medicAssistArtefacts')
  const { toast } = useToast()

  const [artefact, setArtefact] = useState<ArtefactClient | null>(null)
  const [etat, setEtat] = useState<EtatArtefact>('chargement')
  const [erreur, setErreur] = useState<CodeErreurArtefact | null>(null)
  const [specEditee, setSpecEditee] = useState<ArtefactSpec | null>(null)
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>('repos')
  const [rechargement, setRechargement] = useState(0)

  const sauvegardeRef = useRef<Sauvegarde | null>(null)
  const versionRef = useRef(version)
  versionRef.current = version
  const tRef = useRef(t)
  tRef.current = t
  const toastRef = useRef(toast)
  toastRef.current = toast

  // Une sauvegarde par artefact affiché ; l'édition en attente part quand on le quitte.
  useEffect(() => {
    const sauvegarde = creerSauvegarde(
      artefactId,
      {
        surDebut: () => setEnregistrement('en_cours'),
        surSucces: (nouveau, plusRecent) => {
          // On ne remplace l'affichage que si l'on regarde la dernière version.
          if (versionRef.current === undefined) {
            setArtefact(nouveau)
            if (!plusRecent) setSpecEditee(null)
          }
          setEnregistrement(plusRecent ? 'en_cours' : 'enregistre')
        },
        surConflit: derniere => {
          toastRef.current({
            variant: 'destructive',
            title: tRef.current('erreurs.conflit'),
          })
          if (!sauvegarde.actif) return
          if (derniere && versionRef.current === undefined) {
            setArtefact(derniere)
            setSpecEditee(null)
            setEnregistrement('repos')
          } else {
            setEnregistrement('erreur')
          }
        },
        surEchec: base => {
          toastRef.current({
            variant: 'destructive',
            title: tRef.current('erreurs.enregistrement'),
          })
          if (!sauvegarde.actif) return
          if (base && versionRef.current === undefined) {
            setArtefact(base)
            setSpecEditee(base.spec)
          }
          setEnregistrement('erreur')
        },
      },
      DELAI_ANTI_REBOND_MS
    )
    sauvegardeRef.current = sauvegarde
    setArtefact(null)
    setSpecEditee(null)
    setEtat('chargement')
    setErreur(null)
    setEnregistrement('repos')
    return () => {
      sauvegarde.vider()
      sauvegarde.actif = false
      if (sauvegardeRef.current === sauvegarde) sauvegardeRef.current = null
    }
  }, [artefactId])

  // Changer de version (ancienne ou retour à la dernière) envoie d'abord l'édition en attente.
  useEffect(() => {
    return () => sauvegardeRef.current?.vider()
  }, [version])

  // Lecture, annulée dès que l'artefact, la version ou l'activation changent.
  useEffect(() => {
    if (!actif) return
    const controleur = new AbortController()
    setEtat('chargement')
    setErreur(null)
    void (async () => {
      try {
        const reponse = await fetch(urlArtefact(artefactId, version), {
          credentials: 'same-origin',
          signal: controleur.signal,
        })
        if (!reponse.ok) {
          const code: CodeErreurArtefact =
            reponse.status === 404 || reponse.status === 403 ? 'introuvable' : 'chargement'
          throw Object.assign(new Error(code), { code })
        }
        const lu = await lireReponse(reponse)
        if (controleur.signal.aborted) return
        sauvegardeRef.current?.definirBase(lu)
        setArtefact(lu)
        setSpecEditee(null)
        setEtat('pret')
      } catch (e) {
        if (controleur.signal.aborted) return
        const code = (e as { code?: CodeErreurArtefact }).code ?? 'chargement'
        setErreur(code)
        setEtat('erreur')
      }
    })()
    return () => controleur.abort()
  }, [artefactId, version, actif, rechargement])

  const lectureSeule =
    artefact === null ||
    !artefact.modifiable ||
    version !== undefined ||
    artefact.version < Math.max(artefact.version, ...artefact.versions.map(v => v.version))

  const lectureSeuleRef = useRef(lectureSeule)
  lectureSeuleRef.current = lectureSeule

  const enregistrerSpec = useCallback((spec: ArtefactSpec) => {
    if (lectureSeuleRef.current) return
    setSpecEditee(spec)
    setEnregistrement('en_cours')
    sauvegardeRef.current?.enregistrer(spec)
  }, [])

  const recharger = useCallback(() => setRechargement(n => n + 1), [])

  return {
    artefact,
    etat,
    erreur,
    recharger,
    enregistrerSpec,
    enregistrement,
    specLocale: specEditee ?? artefact?.spec ?? null,
    lectureSeule,
  }
}
