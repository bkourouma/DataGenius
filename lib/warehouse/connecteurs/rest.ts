import { lookup } from 'node:dns/promises'
import { request as http } from 'node:http'
import { request as https } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { z } from 'zod'
import { MAX_LIGNES_SOURCE, MAX_OCTETS_SOURCE, correspondRecherche, publierLignes, type ColonneSource, type Connecteur } from './contrat'

const table = { schema: 'api', table: 'donnees' }
const MAX_PAGES = 100
const MAX_PAGE_OCTETS = 2 * 1024 * 1024
const echec = () => new Error('Réponse de la source REST indisponible ou invalide.')

export const ConnexionRest = z.strictObject({
  url: z.string().trim().max(2048).url().refine(value => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
  }),
  token: z.string().max(1024).regex(/^[\x21-\x7e]*$/).default(''),
  chemin: z.string().max(200).regex(/^(?:[\w-]+(?:\.[\w-]+)*)?$/).default(''),
  parametrePage: z.string().max(50).regex(/^[\w-]*$/).default(''),
})
type Config = z.infer<typeof ConnexionRest>
type Ligne = Record<string, unknown>

function ipv4Publique(ip: string) {
  if (isIP(ip) !== 4) return false
  const [a, b, c] = ip.split('.').map(Number)
  return a > 0 && a < 224 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113)
}

async function adresse(url: URL, signal: AbortSignal) {
  const prive = process.env.DATAGENIUS_REST_ORIGINES_PRIVEES?.split(',').some(s => s.trim() === url.origin) ?? false
  if (!prive && (url.protocol !== 'https:' || url.port)) throw echec()
  const nom = url.hostname.replace(/^\[|\]$/g, '')
  const adresses = await lookup(nom, { all: true, family: prive ? 0 : 4 })
  signal.throwIfAborted()
  if (!adresses.length || (!prive && adresses.some(a => !ipv4Publique(a.address)))) throw echec()
  return adresses[0].address
}

async function charger(url: URL, ip: string, token: string, signal: AbortSignal, limite: number) {
  const envoyer = url.protocol === 'https:' ? https : http
  const domaine = url.hostname.replace(/^\[|\]$/g, '')
  return new Promise<Buffer>((resolve, reject) => {
    const req = envoyer({ hostname: ip, servername: isIP(domaine) ? '' : domaine,
      checkServerIdentity: (_, certificat) => checkServerIdentity(domaine, certificat), port: url.port || undefined,
      path: url.pathname + url.search, signal, agent: false, method: 'GET', headers: {
        host: url.host, accept: 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}),
      } }, res => {
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300 ||
          (type !== 'application/json' && !/^application\/[\w.+-]+\+json$/.test(type)) ||
          Number(res.headers['content-length']) > limite) {
        reject(echec()); res.destroy(); return
      }
      let taille = 0
      const morceaux: Buffer[] = []
      res.on('data', (bloc: Buffer) => {
        taille += bloc.length
        if (taille > limite) { reject(echec()); res.destroy() }
        else morceaux.push(bloc)
      })
      res.on('error', () => reject(echec()))
      res.on('end', () => resolve(Buffer.concat(morceaux)))
    })
    req.on('error', () => reject(echec()))
    req.end()
  })
}

class NombreJson {
  constructor(readonly source: string) {}
  toJSON() { return this.source }
}

const analyser = JSON.parse as (texte: string, reviver: (cle: string, valeur: unknown, contexte?: { source?: string }) => unknown) => unknown

function extraire(texte: string, chemin: string): Ligne[] {
  let objet = analyser(texte, (_, valeur, contexte) => typeof valeur === 'number' && contexte?.source ? new NombreJson(contexte.source) : valeur)
  for (const champ of chemin ? chemin.split('.') : []) {
    if (!objet || typeof objet !== 'object' || !Object.hasOwn(objet, champ)) throw echec()
    objet = (objet as Ligne)[champ]
  }
  if (!Array.isArray(objet) || objet.some(l => !l || typeof l !== 'object' || Array.isArray(l) || l instanceof NombreJson)) throw echec()
  return objet as Ligne[]
}

async function* pages(config: Config) {
  try {
    const url = new URL(config.url)
    const signal = AbortSignal.timeout(15_000)
    const ip = await adresse(url, signal)
    let total = 0
    const maxPages = config.parametrePage ? MAX_PAGES : 1
    for (let page = 1; page <= maxPages; page++) {
      if (config.parametrePage) url.searchParams.set(config.parametrePage, String(page))
      const corps = await charger(url, ip, config.token, signal, Math.min(MAX_PAGE_OCTETS, MAX_OCTETS_SOURCE - total))
      total += corps.length
      const lignes = extraire(corps.toString('utf8'), config.chemin)
      if (lignes.length > MAX_LIGNES_SOURCE) throw echec()
      if (!lignes.length) return
      yield lignes
    }
    if (config.parametrePage) throw echec()
  } catch {
    throw echec()
  }
}

export async function testerRest(configuration: Config) {
  await pages(configuration).next()
}

export const rest: Connecteur<Config> = {
  async tables(_, recherche) {
    return { tables: correspondRecherche(table, recherche) ? [table] : [], tronque: false }
  },
  async colonnes(configuration, choix) {
    if (choix.schema !== table.schema || choix.table !== table.table) return []
    const premiere = (await pages(configuration).next()).value ?? []
    const colonnes = new Map<string, ColonneSource['type'] | null>()
    for (const ligne of premiere) {
      for (const [nom, valeur] of Object.entries(ligne)) {
        if (!nom || nom.includes('\0') || Buffer.byteLength(nom) > 63) continue
        const type = valeur === null ? null : valeur instanceof NombreJson || typeof valeur === 'number' ? 'decimal' : 'texte'
        const precedent = colonnes.get(nom)
        colonnes.set(nom, !precedent || precedent === type || !type ? precedent ?? type : 'texte')
      }
    }
    return [...colonnes].map(([nom, type]) => ({ nom, type: type ?? 'texte', typePostgres: type === 'decimal' ? 'nombre JSON' : 'JSON' }))
  },
  async lire(configuration, jeu) {
    if (jeu.schema !== table.schema || jeu.table !== table.table) throw echec()
    async function* lireLignes() {
      const attendues = jeu.colonnes.map(c => c.origine ?? c.nom)
      const presentes = new Set<string>()
      let lignesLues = 0
      for await (const page of pages(configuration)) {
        for (const ligne of page) {
          lignesLues++
          yield Object.fromEntries(attendues.map(cle => {
            if (!Object.hasOwn(ligne, cle)) return [cle, null]
            presentes.add(cle)
            const valeur = ligne[cle]
            return [cle, valeur instanceof NombreJson ? valeur.source : valeur]
          }))
        }
      }
      if (lignesLues && attendues.some(cle => !presentes.has(cle))) throw echec()
    }
    return publierLignes(jeu, lireLignes())
  },
}
