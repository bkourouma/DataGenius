/**
 * Lecture d'un corps de requête EN FLUX avec un plafond réel (R13).
 *
 * `request.text()` / `request.formData()` chargent tout le corps avant tout contrôle, et le
 * contrôle de `content-length` est contournable (envoi fragmenté sans en-tête). Ici chaque
 * fragment est compté ; au-delà du plafond le flux est annulé et la lecture est rejetée
 * immédiatement, sans avoir gardé plus d'un fragment de trop en mémoire.
 */

export class CorpsTropVolumineux extends Error {
  readonly maximum: number
  constructor(maximum: number) {
    super('Corps trop volumineux')
    this.name = 'CorpsTropVolumineux'
    this.maximum = maximum
  }
}

/** Corps de la requête sous forme d'octets ; Uint8Array vide si la requête n'a pas de corps. */
export async function lireOctetsBornes(
  source: { body: ReadableStream<Uint8Array> | null },
  maximum: number
): Promise<Uint8Array> {
  const lecteur = source.body?.getReader()
  if (!lecteur) return new Uint8Array(0)
  const fragments: Uint8Array[] = []
  let taille = 0
  try {
    while (true) {
      const { done, value } = await lecteur.read()
      if (done) break
      taille += value.byteLength
      if (taille > maximum) {
        await lecteur.cancel().catch(() => undefined)
        throw new CorpsTropVolumineux(maximum)
      }
      fragments.push(value)
    }
  } finally {
    lecteur.releaseLock()
  }
  const octets = new Uint8Array(taille)
  let decalage = 0
  for (const fragment of fragments) {
    octets.set(fragment, decalage)
    decalage += fragment.byteLength
  }
  return octets
}

/**
 * Corps de la requête en texte UTF-8. `fatal` (défaut) lève une TypeError sur un UTF-8 invalide ;
 * sinon les octets invalides deviennent U+FFFD, comme `request.text()`.
 */
export async function lireTexteBorne(
  source: { body: ReadableStream<Uint8Array> | null },
  maximum: number,
  options: { fatal?: boolean } = {}
): Promise<string> {
  const octets = await lireOctetsBornes(source, maximum)
  return new TextDecoder('utf-8', { fatal: options.fatal ?? true }).decode(octets)
}

/**
 * Reconstruit une requête multipart à partir d'octets déjà lus (borne respectée), pour pouvoir
 * appeler `.formData()` sans relire le flux d'origine. Les en-têtes sont copiés (content-type
 * avec sa frontière) ; content-length est recalculé par le runtime.
 */
export function requeteDepuisOctets(request: Request, octets: Uint8Array): Request {
  const entetes = new Headers(request.headers)
  entetes.delete('content-length')
  entetes.delete('transfer-encoding')
  return new Request(request.url, { method: 'POST', headers: entetes, body: octets as BodyInit })
}
