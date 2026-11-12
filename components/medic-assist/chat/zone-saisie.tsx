"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'
import type { ContexteEcran } from '@/lib/medic-assist/contrats/chat'
import { useMessageErreurApi } from '@/lib/medic-assist/client/erreurs-api'
import {
  ACCEPT_PIECES,
  EXTENSIONS_AUTORISEES,
  NB_MAX_PIECES,
  TAILLE_MAX_PIECE_MO,
  televerserPieceJointe,
  validerFichier,
} from '@/lib/medic-assist/client/pieces-jointes'
import type { EnvoiMessage, PieceJointe } from '@/lib/medic-assist/client/types'
import { BoutonMicro } from './bouton-micro'
import { PucesPiecesJointes, type PuceFichier } from './puces-pieces-jointes'

export interface ZoneSaisieHandle {
  ajouterFichiers(fichiers: File[]): void
  focus(): void
  definirTexte(texte: string): void
}

export interface ZoneSaisieProps {
  onEnvoyer: (envoi: EnvoiMessage) => void
  onArreter: () => void
  /** Reponse en cours (submitted|streaming) : Envoyer devient Arreter. */
  enCours: boolean
  /** Choisit le placeholder. */
  conversationVide: boolean
  contexteEcran?: ContexteEcran | null
  onRetirerContexte?: () => void
  texteInitial?: string
  /** Nombre maximal de caracteres (defaut LIMITES.longueurMaxMessageUtilisateur). */
  limite?: number
}

interface PieceLocale extends PuceFichier {
  piece?: PieceJointe
}

const HAUTEUR_MAX = 192
const SEUIL_COMPTEUR = 0.85

function composer(base: string, dicte: string): string {
  if (!base) return dicte
  return /\s$/.test(base) ? base + dicte : `${base} ${dicte}`
}

export const ZoneSaisie = forwardRef<ZoneSaisieHandle, ZoneSaisieProps>(function ZoneSaisie(
  {
    onEnvoyer,
    onArreter,
    enCours,
    conversationVide,
    contexteEcran,
    onRetirerContexte,
    texteInitial = '',
    limite = LIMITES.longueurMaxMessageUtilisateur,
  },
  ref,
) {
  const t = useTranslations('medicAssist')
  const format = useFormatter()
  const messageErreurApi = useMessageErreurApi()
  const idAide = useId()
  const idCompteur = useId()
  const idApprofondie = useId()
  const idJoindre = useId()
  const [texte, setTexte] = useState(texteInitial)
  const [modeProfond, setModeProfond] = useState(false)
  const [pieces, setPieces] = useState<PieceLocale[]>([])
  const zone = useRef<HTMLTextAreaElement>(null)
  const champFichier = useRef<HTMLInputElement>(null)
  const texteRef = useRef(texte)
  texteRef.current = texte
  const piecesRef = useRef(pieces)
  piecesRef.current = pieces
  const monte = useRef(true)
  const compteurCle = useRef(0)
  // Dictee : texte present au debut, et partie dictee deja integree au texte
  // quand l'utilisateur a tape pendant la dictee.
  const base = useRef('')
  const dictee = useRef(false)
  const dicteDejaInseree = useRef('')
  const derniereDictee = useRef('')

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  // Focus a l'arrivee, bureau uniquement, a la creation d'une conversation.
  useEffect(() => {
    if (!conversationVide) return
    if (typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(min-width: 768px)').matches) zone.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-extension.
  useLayoutEffect(() => {
    const el = zone.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, HAUTEUR_MAX)}px`
  }, [texte])

  const ajouterFichiers = useCallback(
    (fichiers: File[]) => {
      let places = NB_MAX_PIECES - piecesRef.current.length
      let signale = false
      for (const fichier of fichiers) {
        const verdict = validerFichier(fichier)
        if (!verdict.valide) {
          const nom = fichier.name
          toast.error(
            verdict.raison === 'extension'
              ? t('saisie.erreurPieceExtension', {
                  nom,
                  formats: EXTENSIONS_AUTORISEES.map((e) => e.toUpperCase()).join(', '),
                })
              : verdict.raison === 'taille'
                ? t('saisie.erreurPieceTaille', {
                    nom,
                    taille: format.number(TAILLE_MAX_PIECE_MO, { style: 'unit', unit: 'megabyte' }),
                  })
                : t('saisie.erreurPieceVide', { nom }),
          )
          continue
        }
        if (places <= 0) {
          if (!signale) toast.error(t('saisie.tropDePieces', { max: NB_MAX_PIECES }))
          signale = true
          continue
        }
        places -= 1
        compteurCle.current += 1
        const cle = `piece-${compteurCle.current}`
        const locale: PieceLocale = { cle, nom: fichier.name, taille: fichier.size, enCours: true }
        piecesRef.current = [...piecesRef.current, locale]
        setPieces(piecesRef.current)
        televerserPieceJointe(fichier).then(
          (piece) => {
            if (!monte.current) return
            setPieces((courant) => {
              const suivant = courant.map((p) =>
                p.cle === cle ? { ...p, enCours: false, nom: piece.nom, taille: piece.taille, piece } : p,
              )
              piecesRef.current = suivant
              return suivant
            })
          },
          (echec: unknown) => {
            if (!monte.current) return
            toast.error(messageErreurApi(echec, t('saisie.erreurPieceEchec', { nom: fichier.name })))
            setPieces((courant) => {
              const suivant = courant.filter((p) => p.cle !== cle)
              piecesRef.current = suivant
              return suivant
            })
          },
        )
      }
    },
    [t, format, messageErreurApi],
  )

  useImperativeHandle(
    ref,
    () => ({
      ajouterFichiers,
      focus: () => zone.current?.focus(),
      definirTexte: (valeur: string) => setTexte(valeur),
    }),
    [ajouterFichiers],
  )

  const televersementEnCours = pieces.some((p) => p.enCours)
  const longueur = texte.length
  const depasse = longueur > limite
  const peutEnvoyer = texte.trim().length > 0 && !depasse && !televersementEnCours

  const envoyer = () => {
    if (!peutEnvoyer || enCours) return
    const piecesJointes = piecesRef.current.flatMap((p) => (p.piece ? [p.piece] : []))
    const envoi: EnvoiMessage = { texte: texte.trim(), modeProfond, piecesJointes }
    if (contexteEcran) envoi.contexteEcran = contexteEcran
    onEnvoyer(envoi)
    setTexte('')
    setPieces([])
    piecesRef.current = []
    base.current = ''
    dictee.current = false
    zone.current?.focus()
  }

  const surTouche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Pendant la composition IME (zh, hi...), Entree valide le candidat.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    envoyer()
  }

  const surChangement = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const valeur = e.target.value
    if (dictee.current) {
      // L'utilisateur tape pendant la dictee : ce qu'il voit devient la nouvelle base.
      base.current = valeur
      dicteDejaInseree.current = derniereDictee.current
    }
    setTexte(valeur)
  }

  const debutDictee = () => {
    dictee.current = true
    base.current = texteRef.current
    dicteDejaInseree.current = ''
    derniereDictee.current = ''
  }
  const texteDicte = (dicte: string) => {
    derniereDictee.current = dicte
    const deja = dicteDejaInseree.current
    const ajout = deja && dicte.startsWith(deja) ? dicte.slice(deja.length).trimStart() : dicte
    if (!ajout) return
    setTexte(composer(base.current, ajout))
  }
  const finDictee = () => {
    dictee.current = false
  }

  const surFichiers = (e: ChangeEvent<HTMLInputElement>) => {
    const fichiers = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (fichiers.length > 0) ajouterFichiers(fichiers)
  }

  const retirerPiece = (cle: string) => {
    const suivant = piecesRef.current.filter((p) => p.cle !== cle)
    piecesRef.current = suivant
    setPieces(suivant)
  }

  const afficherCompteur = longueur >= limite * SEUIL_COMPTEUR
  const titreContexte = contexteEcran
    ? (contexteEcran.titre ?? contexteEcran.libelle ?? t('saisie.contexteEcranFallback'))
    : ''

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border bg-card p-2 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
          depasse && 'border-destructive',
        )}
      >
        {contexteEcran ? (
          <div className="flex">
            <span className="flex max-w-full items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-xs text-secondary-foreground">
              <span className="truncate">{t('saisie.contexte', { ecran: titreContexte })}</span>
              <button
                type="button"
                onClick={onRetirerContexte}
                aria-label={t('saisie.retirerContexte')}
                className="cible-tactile -me-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:size-11"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}

        <PucesPiecesJointes pieces={pieces} onRetirer={retirerPiece} />

        <textarea
          ref={zone}
          value={texte}
          rows={1}
          onChange={surChangement}
          onKeyDown={surTouche}
          placeholder={conversationVide ? t('saisie.placeholder') : t('saisie.placeholderSuite')}
          aria-label={t('saisie.label')}
          aria-describedby={afficherCompteur ? `${idAide} ${idCompteur}` : idAide}
          aria-invalid={depasse || undefined}
          className="block max-h-48 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
        />

        <div className="flex flex-wrap items-center gap-1">
          <input
            ref={champFichier}
            id={idJoindre}
            type="file"
            multiple
            accept={ACCEPT_PIECES}
            className="hidden"
            data-testid="saisie-fichiers"
            onChange={surFichiers}
            tabIndex={-1}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('saisie.joindre')}
            title={t('saisie.joindreAide', {
              taille: format.number(TAILLE_MAX_PIECE_MO, { style: 'unit', unit: 'megabyte' }),
            })}
            onClick={() => champFichier.current?.click()}
            className="cible-tactile"
          >
            <Paperclip className="size-4" aria-hidden="true" />
          </Button>

          <span className="group relative">
            <button
              type="button"
              role="switch"
              aria-checked={modeProfond}
              aria-describedby={idApprofondie}
              onClick={() => setModeProfond((v) => !v)}
              className={cn(
                'cible-tactile flex h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11',
                modeProfond
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-card text-foreground hover:bg-accent',
              )}
            >
              <span>{t('saisie.approfondie')}</span>
            </button>
            <span
              id={idApprofondie}
              role="tooltip"
              className="invisible absolute bottom-full start-0 z-10 mb-1 w-64 rounded-md border bg-popover p-2 text-xs text-popover-foreground group-focus-within:visible group-hover:visible"
            >
              {t('saisie.approfondieAide')}
            </span>
          </span>

          <BoutonMicro
            onDebut={debutDictee}
            onTexte={(dicte) => texteDicte(dicte)}
            onFin={finDictee}
            desactive={enCours}
          />

          {enCours ? (
            <Button
              type="button"
              variant="default"
              size="icon"
              className="cible-tactile ms-auto"
              aria-label={t('saisie.arreter')}
              title={t('saisie.arreter')}
              onClick={onArreter}
            >
              <Square className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="cible-tactile ms-auto"
              aria-label={t('saisie.envoyer')}
              title={t('saisie.envoyer')}
              disabled={!peutEnvoyer}
              onClick={envoyer}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <p id={idAide} className="max-sm:sr-only">
          {t('saisie.aide')}
        </p>
        <p className="max-sm:order-last">{t('saisie.avertissement')}</p>
        <p
          id={idCompteur}
          aria-live="polite"
          className={cn('ms-auto', depasse && 'font-semibold text-destructive')}
          data-figure
        >
          {afficherCompteur
            ? depasse
              ? t('saisie.compteurDepasse', { depasse: longueur - limite })
              : t('saisie.compteur', { restant: limite - longueur })
            : null}
        </p>
      </div>
    </div>
  )
})
