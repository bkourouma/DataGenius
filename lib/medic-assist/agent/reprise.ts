/**
 * Reprise automatique bornée, par ÉTAPE du modèle, portée par un middleware du SDK.
 *
 * Pourquoi : en recette, des réponses se sont terminées en `fournisseur_indisponible` après
 * exactement les 2 reprises par défaut du SDK (attentes de 2 s puis 4 s), sans aucun jeton.
 * Le SDK ne rejoue qu'une erreur levée par `doStream()` ; une erreur Anthropic arrivée DANS le
 * flux (`overloaded_error`) lui échappe. Ce middleware rejoue les deux cas, mais seulement tant
 * que rien n'a été transmis au consommateur : une fois le premier morceau de contenu relayé, on
 * ne rejoue jamais (le texte serait dupliqué).
 */
import { wrapLanguageModel, type LanguageModel } from 'ai'
import { classerErreur, decrireErreurPourJournal } from '@/lib/medic-assist/agent/erreurs'

/** Modèle accepté par `wrapLanguageModel` (objet de spécification V2 à V4). */
type ModeleEnveloppable = Parameters<typeof wrapLanguageModel>[0]['model']

export interface PolitiqueReprise {
  /** Attentes avant chaque nouvel essai (ms) ; sa longueur borne le nombre de reprises. */
  delaisMs: readonly number[]
  /** Part aléatoire ajoutée à l'attente (0 à 1), défaut 0.25. */
  gigue?: number
  /** Remplaçable en test. Doit rejeter (AbortError) si le signal est annulé pendant l'attente. */
  attendre?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Journal d'une reprise (défaut : console.warn). */
  journaliser?: (message: string) => void
}

export const POLITIQUE_REPRISE_DEFAUT: PolitiqueReprise = {
  delaisMs: [2_000, 4_000, 8_000],
}

const GIGUE_DEFAUT = 0.25

/** Morceaux qui n'apportent aucun contenu : on peut encore rejouer l'étape après eux. */
const MORCEAUX_SANS_CONTENU = new Set(['stream-start', 'response-metadata', 'raw', 'error'])

/**
 * Une erreur se rejoue si elle est retentable, sauf un délai (le flux est déjà borné à 300 s :
 * rejouer le doublerait) et une annulation.
 */
export function erreurReessayable(error: unknown): boolean {
  const c = classerErreur(error)
  return c.retentable && c.code !== 'delai_depasse' && c.code !== 'annule'
}

function erreurAbandon(): Error {
  return Object.assign(new Error('Reprise annulée'), { name: 'AbortError' })
}

function attendreParDefaut(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(erreurAbandon())
      return
    }
    const surAbandon = () => {
      clearTimeout(minuteur)
      reject(erreurAbandon())
    }
    const minuteur = setTimeout(() => {
      signal?.removeEventListener('abort', surAbandon)
      resolve()
    }, ms)
    signal?.addEventListener('abort', surAbandon, { once: true })
  })
}

type Morceau = { type?: string; error?: unknown }

/**
 * Enveloppe le modèle d'une reprise bornée. `maxRetriesSdk` vaut 0 quand le modèle est enveloppé
 * (la reprise est portée par le middleware, sans multiplier les essais avec ceux du SDK) et
 * `undefined` (réglage du SDK conservé) quand le modèle n'est pas un objet V4 (rendu tel quel).
 */
export function avecReprise(
  modele: LanguageModel,
  options: { signal?: AbortSignal; politique?: PolitiqueReprise } = {}
): { modele: LanguageModel; maxRetriesSdk: number | undefined } {
  if (typeof modele !== 'object' || modele === null) return { modele, maxRetriesSdk: undefined }
  if ((modele as { specificationVersion?: string }).specificationVersion !== 'v4') {
    return { modele, maxRetriesSdk: undefined }
  }

  const { signal } = options
  const politique = options.politique ?? POLITIQUE_REPRISE_DEFAUT
  const delais = politique.delaisMs
  const gigue = politique.gigue ?? GIGUE_DEFAUT
  const attendre = politique.attendre ?? attendreParDefaut
  const journaliser = politique.journaliser ?? ((message: string) => console.warn(message))

  /** Journalise puis attend avant l'essai suivant ; rejette si le signal est annulé. */
  async function patienter(essai: number, erreur: unknown): Promise<void> {
    const ms = Math.round(delais[essai] * (1 + Math.random() * gigue))
    journaliser(
      `[medic-assist/chat] reprise ${essai + 1}/${delais.length} dans ${ms} ms : ${decrireErreurPourJournal(erreur)}`
    )
    await attendre(ms, signal)
  }

  const enveloppe = wrapLanguageModel({
    model: modele as ModeleEnveloppable,
    middleware: {
      wrapStream: async ({ doStream }) => {
        for (let essai = 0; ; essai++) {
          const peutReprendre = (erreur: unknown) =>
            essai < delais.length && !signal?.aborted && erreurReessayable(erreur)

          let resultat: Awaited<ReturnType<typeof doStream>>
          try {
            resultat = await doStream()
          } catch (erreur) {
            if (!peutReprendre(erreur)) throw erreur
            await patienter(essai, erreur)
            continue
          }

          const lecteur = resultat.stream.getReader()
          const tampon: unknown[] = []
          let termine = false
          let rejet: { erreur: unknown } | undefined
          let rejouer: unknown
          let doitRejouer = false

          // Lecture en tampon jusqu'au premier morceau de contenu (ou à la fin du flux).
          for (;;) {
            let lu: ReadableStreamReadResult<unknown>
            try {
              lu = await lecteur.read()
            } catch (erreur) {
              if (peutReprendre(erreur)) {
                doitRejouer = true
                rejouer = erreur
              } else {
                rejet = { erreur }
              }
              break
            }
            if (lu.done) {
              termine = true
              break
            }
            const morceau = lu.value as Morceau
            if (morceau?.type === 'error' && peutReprendre(morceau.error)) {
              doitRejouer = true
              rejouer = morceau.error
              break
            }
            tampon.push(lu.value)
            if (!MORCEAUX_SANS_CONTENU.has(String(morceau?.type))) break
            // Une erreur non réessayable est transmise telle quelle : on cesse de tamponner.
            if (morceau?.type === 'error') break
          }

          if (doitRejouer) {
            // Rien n'a été transmis au consommateur : on abandonne ce flux et on recommence.
            await lecteur.cancel().catch(() => undefined)
            await patienter(essai, rejouer)
            continue
          }

          let position = 0
          const stream = new ReadableStream<unknown>({
            async pull(controleur) {
              if (position < tampon.length) {
                controleur.enqueue(tampon[position++])
                return
              }
              if (rejet) {
                controleur.error(rejet.erreur)
                return
              }
              if (termine) {
                controleur.close()
                return
              }
              try {
                const lu = await lecteur.read()
                if (lu.done) controleur.close()
                else controleur.enqueue(lu.value)
              } catch (erreur) {
                controleur.error(erreur)
              }
            },
            cancel(raison) {
              return lecteur.cancel(raison).catch(() => undefined)
            },
          })
          return { ...resultat, stream } as typeof resultat
        }
      },
    },
  })

  return { modele: enveloppe, maxRetriesSdk: 0 }
}
