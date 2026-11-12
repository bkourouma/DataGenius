"use client"

/**
 * Contexte d'ecran de Medic Assist (store zustand).
 *
 * - Un ecran peut enregistrer son contexte (filtres, selection...) avec
 *   `useEnregistrerContexteMedicAssist(ctx)` ; il est retire au demontage.
 * - Le lanceur (en-tete, Ctrl+K) lit `useContexteEcranMedicAssist` au moment
 *   d'envoyer la question, y ajoute le chemin, les parametres d'URL et le titre
 *   de la page, puis le depose dans `demande` : la page /medic-assist le prend
 *   (`consommerDemande`) et envoie la question automatiquement.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { CheminInterneSchema } from '@/lib/medic-assist/contrats/communs'
import { ContexteEcranSchema, type ContexteEcran } from '@/lib/medic-assist/contrats/chat'

/** Demande deposee par le lanceur, consommee une seule fois par la page de chat. */
export interface DemandeMedicAssist {
  /** Question a envoyer. */
  question: string
  /** Contexte de l'ecran d'ou la question est posee (retirable par l'utilisateur). */
  contexte?: ContexteEcran
  /** Identifiant unique, pour ne traiter une demande qu'une fois (double rendu React). */
  id: string
}

interface EtatContexteEcran {
  /** Contexte enregistre par l'ecran courant (filtres, selection...), sans chemin. */
  enregistre: Partial<ContexteEcran> | null
  /** Demande en attente, deposee par le lanceur avant la navigation. */
  demande: DemandeMedicAssist | null
  definirEnregistre: (contexte: Partial<ContexteEcran> | null) => void
  deposerDemande: (demande: Omit<DemandeMedicAssist, 'id'>) => void
  /** Retourne la demande en attente et la vide ; null s'il n'y en a pas. */
  consommerDemande: () => DemandeMedicAssist | null
}

let compteur = 0

export const useContexteEcranMedicAssist = create<EtatContexteEcran>((set, get) => ({
  enregistre: null,
  demande: null,
  definirEnregistre: (contexte) => set({ enregistre: contexte }),
  deposerDemande: (demande) => {
    compteur += 1
    set({ demande: { ...demande, id: `${Date.now()}-${compteur}` } })
  },
  consommerDemande: () => {
    const demande = get().demande
    if (demande) set({ demande: null })
    return demande
  },
}))

/**
 * A appeler depuis un ecran pour exposer son contexte a Medic Assist (filtres
 * actifs, ligne selectionnee...). Retire au demontage. `contexte` doit etre
 * stable ou memoise : le hook compare par contenu serialise.
 */
export function useEnregistrerContexteMedicAssist(contexte: Partial<ContexteEcran> | null): void {
  const definir = useContexteEcranMedicAssist((etat) => etat.definirEnregistre)
  const empreinte = contexte ? JSON.stringify(contexte) : ''
  useEffect(() => {
    definir(empreinte ? (JSON.parse(empreinte) as Partial<ContexteEcran>) : null)
    return () => definir(null)
  }, [definir, empreinte])
}

/**
 * Construit le ContexteEcran complet a partir de la page courante : chemin,
 * parametres d'URL, titre du document, et ce que l'ecran a enregistre.
 * Les parametres vides et le libelle absent sont omis. Retourne null quand le
 * chemin n'est pas un chemin interne valide (CheminInterneSchema) : on n'envoie
 * alors aucun contexte plutot qu'une requete que le serveur refuserait.
 */
export function construireContexteEcran(
  chemin: string,
  parametresUrl: URLSearchParams | string,
  titreDocument: string | undefined,
  enregistre: Partial<ContexteEcran> | null,
): ContexteEcran | null {
  if (!CheminInterneSchema.safeParse(chemin).success) return null
  const recherche = typeof parametresUrl === 'string' ? new URLSearchParams(parametresUrl) : parametresUrl
  const parametres: Record<string, string> = {}
  recherche.forEach((valeur, cle) => {
    if (valeur !== '') parametres[cle] = valeur
  })
  const contexte: ContexteEcran = { chemin }
  const titre = enregistre?.titre ?? (titreDocument?.trim() || undefined)
  if (titre) contexte.titre = titre.slice(0, 200)
  const tousParametres = { ...parametres, ...(enregistre?.parametres ?? {}) }
  if (Object.keys(tousParametres).length > 0) contexte.parametres = tousParametres
  if (enregistre?.filtres && Object.keys(enregistre.filtres).length > 0) contexte.filtres = enregistre.filtres
  // Le contrat borne le contexte : un contexte invalide (ex. filtres trop gros) est abandonne.
  if (!ContexteEcranSchema.safeParse(contexte).success) return null
  if (enregistre?.libelle) contexte.libelle = enregistre.libelle.slice(0, 300)
  return contexte
}
