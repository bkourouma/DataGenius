/**
 * Reprise automatique bornée, par ÉTAPE du modèle, portée par un middleware du SDK.
 *
 * Pourquoi : en recette, des réponses se sont terminées en `fournisseur_indisponible` après
 * exactement les 2 reprises par défaut du SDK (attentes de 2 s puis 4 s), sans aucun jeton.
 * Le SDK ne rejoue qu'une erreur levée par `doStream()` ; une erreur Anthropic arrivée DANS le
 * flux (`overloaded_error`) lui échappe. Ce middleware rejoue les deux cas, mais seulement tant
 * que rien n'a été transmis au consommateur : une fois le premier morceau de contenu relayé, on
 * ne rejoue jamais (le texte serait dupliqué).
 *
 * Modèle de secours (lot B, R14) : quand les reprises sont épuisées sur une indisponibilité
 * du fournisseur (`fournisseur_indisponible` : panne, surcharge ; `limite_debit`), toujours
 * AVANT tout contenu transmis, l'étape est rejouée UNE fois avec le modèle de secours
 * configuré (mêmes paramètres, options propres au fournisseur principal retirées). Jamais
 * après du contenu, jamais deux fois dans la même étape, jamais pour une autre cause
 * (authentification, requête refusée, délai, annulation…).
 */
import { wrapLanguageModel, type LanguageModel } from 'ai'
import { journal } from '@/lib/journal'
import {
  classerErreur,
  decrireErreurPourJournal,
  type CodeErreurChat,
} from '@/lib/medic-assist/agent/erreurs'
import type { Fournisseur } from '@/lib/medic-assist/contrats'

/** Modèle accepté par `wrapLanguageModel` (objet de spécification V2 à V4). */
type ModeleEnveloppable = Parameters<typeof wrapLanguageModel>[0]['model']

export interface PolitiqueReprise {
  /** Attentes avant chaque nouvel essai (ms) ; sa longueur borne le nombre de reprises. */
  delaisMs: readonly number[]
  /** Part aléatoire ajoutée à l'attente (0 à 1), défaut 0.25. */
  gigue?: number
  /** Remplaçable en test. Doit rejeter (AbortError) si le signal est annulé pendant l'attente. */
  attendre?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Journal d'une reprise (défaut : journal structuré). */
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

/** Causes qui déclenchent la bascule vers le modèle de secours : indisponibilité seulement. */
const CAUSES_BASCULE: ReadonlySet<CodeErreurChat> = new Set<CodeErreurChat>([
  'fournisseur_indisponible',
  'limite_debit',
])

/** Modèles Claude qui acceptent `effort` (génération 5 et suivantes). */
const MODELES_AVEC_EFFORT = /^claude-(opus|sonnet|haiku|fable)-5/

/** Vrai si le modèle Claude accepte l'option `effort` de @ai-sdk/anthropic. */
export function modeleAccepteEffort(modeleId: string): boolean {
  return MODELES_AVEC_EFFORT.test(modeleId)
}

/** Vrai si l'erreur est une indisponibilité du fournisseur (cause de bascule). */
export function erreurIndisponibilite(error: unknown): boolean {
  return CAUSES_BASCULE.has(classerErreur(error).code)
}

export interface InfoBascule {
  /** Modèle principal (`fournisseur/modèle` tel que déclaré par le modèle). */
  de: string
  /** Modèle de secours (`fournisseur/modèle`). */
  vers: string
  fournisseur: Fournisseur
  modeleId: string
  /** Code de l'erreur qui a provoqué la bascule (jamais le message du fournisseur). */
  cause: CodeErreurChat
}

export interface SecoursReprise {
  /** Modèle de secours (objet V4 ; sinon ignoré sans erreur). */
  modele: LanguageModel
  fournisseur: Fournisseur
  modeleId: string
  /** Appelé à chaque bascule, avant l'appel au modèle de secours. */
  surBascule?: (info: InfoBascule) => void
}

export interface OptionsReprise {
  signal?: AbortSignal
  politique?: PolitiqueReprise
  secours?: SecoursReprise
  /** Champs du journal de bascule (référence d'incident, conversation) : jamais de contenu. */
  journal?: { reference?: string; conversationId?: string }
}

type ModeleV4 = { specificationVersion: 'v4'; provider?: string; modelId?: string }

function estModeleV4(modele: unknown): modele is ModeleV4 {
  return (
    typeof modele === 'object' &&
    modele !== null &&
    (modele as { specificationVersion?: string }).specificationVersion === 'v4'
  )
}

type OptionsFournisseur = Record<string, unknown> | undefined

/** Ne garde, des options par fournisseur, que celles du fournisseur de secours. */
function filtrerOptions(options: unknown, fournisseur: Fournisseur): OptionsFournisseur {
  if (typeof options !== 'object' || options === null) return undefined
  const propres = (options as Record<string, unknown>)[fournisseur]
  return propres === undefined ? undefined : { [fournisseur]: propres }
}

function avecOptions<T extends object>(objet: T, options: OptionsFournisseur): T {
  const { providerOptions: _ignore, ...reste } = objet as T & { providerOptions?: unknown }
  return (options ? { ...reste, providerOptions: options } : reste) as T
}

/**
 * Paramètres de l'étape adaptés au modèle de secours : les options d'un autre fournisseur
 * (`effort`, `cacheControl` Anthropic…) sont retirées partout (appel, messages, parties,
 * outils) ; `effort` est retiré si le modèle Claude de secours ne l'accepte pas ; la borne de
 * jetons de sortie propre à Claude est retirée chez un autre fournisseur (sa borne s'applique).
 */
export function adapterParametresSecours<P extends Record<string, unknown>>(
  params: P,
  fournisseur: Fournisseur,
  modeleId: string
): P {
  let appel = filtrerOptions(params.providerOptions, fournisseur)
  if (fournisseur === 'anthropic' && appel && !modeleAccepteEffort(modeleId)) {
    const anthropic = { ...(appel.anthropic as Record<string, unknown>) }
    delete anthropic.effort
    appel = Object.keys(anthropic).length > 0 ? { anthropic } : undefined
  }
  const prompt = Array.isArray(params.prompt)
    ? (params.prompt as Record<string, unknown>[]).map(message => {
        const contenu = Array.isArray(message.content)
          ? (message.content as Record<string, unknown>[]).map(partie =>
              typeof partie === 'object' && partie !== null
                ? avecOptions(partie, filtrerOptions(partie.providerOptions, fournisseur))
                : partie
            )
          : message.content
        return avecOptions(
          { ...message, content: contenu },
          filtrerOptions(message.providerOptions, fournisseur)
        )
      })
    : params.prompt
  const outils = Array.isArray(params.tools)
    ? (params.tools as Record<string, unknown>[]).map(outil =>
        avecOptions(outil, filtrerOptions(outil.providerOptions, fournisseur))
      )
    : params.tools
  const adapte: Record<string, unknown> = avecOptions({ ...params, prompt }, appel)
  if (params.tools !== undefined) adapte.tools = outils
  if (fournisseur !== 'anthropic') delete adapte.maxOutputTokens
  return adapte as P
}

/**
 * Enveloppe le modèle d'une reprise bornée. `maxRetriesSdk` vaut 0 quand le modèle est enveloppé
 * (la reprise est portée par le middleware, sans multiplier les essais avec ceux du SDK) et
 * `undefined` (réglage du SDK conservé) quand le modèle n'est pas un objet V4 (rendu tel quel).
 */
export function avecReprise(
  modele: LanguageModel,
  options: OptionsReprise = {}
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
  const journaliser =
    politique.journaliser ??
    ((message: string) => journal.avertissement('chat : reprise du modèle', { domaine: 'chat', detail: message }))
  const secours = options.secours && estModeleV4(options.secours.modele) ? options.secours : null
  const principal = modele as ModeleV4
  const nomPrincipal = `${principal.provider ?? 'inconnu'}/${principal.modelId ?? 'inconnu'}`

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
      wrapStream: async ({ doStream, params }) => {
        // Une seule bascule par étape (chaque étape rappelle wrapStream) ; après elle, ni
        // reprise ni seconde bascule : l'erreur du secours est rendue telle quelle.
        let bascule = false

        type ResultatFlux = Awaited<ReturnType<typeof doStream>>
        const appeler = (): PromiseLike<ResultatFlux> => {
          if (!bascule || !secours) return doStream()
          const cible = secours.modele as unknown as {
            doStream: (p: unknown) => PromiseLike<ResultatFlux>
          }
          return cible.doStream(
            adapterParametresSecours(
              params as unknown as Record<string, unknown>,
              secours.fournisseur,
              secours.modeleId
            )
          )
        }

        const basculer = (erreur: unknown): void => {
          if (!secours) return
          bascule = true
          const info: InfoBascule = {
            de: nomPrincipal,
            vers: `${secours.fournisseur}/${secours.modeleId}`,
            fournisseur: secours.fournisseur,
            modeleId: secours.modeleId,
            cause: classerErreur(erreur).code,
          }
          journal.avertissement('chat : bascule vers le modèle de secours', {
            domaine: 'chat',
            reference: options.journal?.reference,
            conversationId: options.journal?.conversationId,
            evenement: 'bascule_modele_secours',
            de: info.de,
            vers: info.vers,
            cause: info.cause,
          })
          try {
            options.secours?.surBascule?.(info)
          } catch {
            // Un rappel défaillant n'empêche pas la bascule.
          }
        }

        for (let essai = 0; ; essai++) {
          const peutReprendre = (erreur: unknown) =>
            !bascule && essai < delais.length && !signal?.aborted && erreurReessayable(erreur)
          const peutBasculer = (erreur: unknown) =>
            secours !== null && !bascule && !signal?.aborted && erreurIndisponibilite(erreur)

          let resultat: ResultatFlux
          try {
            resultat = await appeler()
          } catch (erreur) {
            if (peutReprendre(erreur)) {
              await patienter(essai, erreur)
              continue
            }
            if (peutBasculer(erreur)) {
              basculer(erreur)
              continue
            }
            throw erreur
          }

          const lecteur = resultat.stream.getReader()
          const tampon: unknown[] = []
          let termine = false
          let rejet: { erreur: unknown } | undefined
          let rejouer: unknown
          let doitRejouer = false
          let doitBasculer = false

          // Lecture en tampon jusqu'au premier morceau de contenu (ou à la fin du flux).
          for (;;) {
            let lu: ReadableStreamReadResult<unknown>
            try {
              lu = await lecteur.read()
            } catch (erreur) {
              if (peutReprendre(erreur)) {
                doitRejouer = true
                rejouer = erreur
              } else if (peutBasculer(erreur)) {
                doitBasculer = true
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
            if (morceau?.type === 'error' && peutBasculer(morceau.error)) {
              doitBasculer = true
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
          if (doitBasculer) {
            // Rien n'a été transmis : l'étape est rejouée une fois avec le modèle de secours.
            await lecteur.cancel().catch(() => undefined)
            basculer(rejouer)
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
