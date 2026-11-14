import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { journal } from '@/lib/journal'

/**
 * Filtre des hôtes des connecteurs PostgreSQL et MySQL. Sans autorisation explicite, un
 * administrateur ne peut pas viser la boucle locale, le réseau privé ni les métadonnées cloud.
 * DATAGENIUS_SOURCES_HOTES_AUTORISES : noms ou IP exacts, séparés par des virgules.
 */
export class ErreurHoteSource extends Error {}

// Message unique : ne révèle pas si l'hôte existe, ni vers quelle adresse il résout.
const MESSAGE = 'Hôte non autorisé ou introuvable.'

function normaliser(hote: string) {
  return hote.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

export function hotesAutorises(brut: string | undefined = process.env.DATAGENIUS_SOURCES_HOTES_AUTORISES) {
  return new Set((brut ?? '').split(',').map(normaliser).filter(Boolean))
}

function ipv4Restreinte(ip: string) {
  const [a, b, c] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)
}

function hextets(ip: string) {
  let texte = ip.split('%')[0]
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(texte)
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number)
    texte = texte.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [debut, fin, trop] = texte.split('::')
  if (trop !== undefined) return null
  const gauche = debut ? debut.split(':') : []
  const droite = fin ? fin.split(':') : []
  const manque = 8 - gauche.length - droite.length
  if (fin === undefined ? gauche.length !== 8 : manque < 1) return null
  const tous = fin === undefined ? gauche : [...gauche, ...Array<string>(manque).fill('0'), ...droite]
  const valeurs = tous.map(h => parseInt(h, 16))
  return valeurs.length === 8 && valeurs.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffff) ? valeurs : null
}

function ipv4Embarquee(h: number[], depuis: number) {
  return [h[depuis] >> 8, h[depuis] & 255, h[depuis + 1] >> 8, h[depuis + 1] & 255].join('.')
}

export function adresseRestreinte(adresse: string): boolean {
  const ip = normaliser(adresse)
  const famille = isIP(ip.split('%')[0])
  if (famille === 4) return ipv4Restreinte(ip)
  if (famille !== 6) return true
  const h = hextets(ip)
  if (!h) return true
  if (h.slice(0, 5).every(v => v === 0) && (h[5] === 0xffff || h[5] === 0)) {
    // ::, ::1, IPv4 mappée (::ffff:a.b.c.d) ou compatible (::a.b.c.d).
    return h[5] === 0 && h[6] === 0 && h[7] <= 1 ? true : ipv4Restreinte(ipv4Embarquee(h, 6))
  }
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(v => v === 0)) return ipv4Restreinte(ipv4Embarquee(h, 6))
  // ::ffff:0:a.b.c.d (IPv4 traduite), 64:ff9b:1::/48 (NAT64 local) et 2001::/32 (Teredo) : refusées.
  if (h.slice(0, 4).every(v => v === 0) && h[4] === 0xffff && h[5] === 0) return true
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true
  if (h[0] === 0x2001 && h[1] === 0) return true
  return (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0 || (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xff00) === 0xff00 ||
    (h[0] === 0x2001 && h[1] === 0x0db8) || (h[0] === 0x2002 && ipv4Restreinte(ipv4Embarquee(h, 1)))
}

/** Lève ErreurHoteSource si l'hôte (nom ou IP) vise une adresse interne non autorisée. */
export async function verifierHoteSource(
  hote: string,
  options: { autorises?: Set<string>; resoudre?: (nom: string) => Promise<string[]> } = {},
) {
  const autorises = options.autorises ?? hotesAutorises()
  const nom = normaliser(hote)
  if (!nom) throw new ErreurHoteSource(MESSAGE)
  if (autorises.has(nom)) return
  const resoudre = options.resoudre ?? (async (valeur: string) =>
    (await lookup(valeur, { all: true, verbatim: true })).map(a => a.address))
  let adresses: string[]
  try {
    adresses = isIP(nom) ? [nom] : await resoudre(nom)
  } catch {
    journal.avertissement('Hôte de source non résolu', { domaine: 'sources', evenement: 'hote_non_resolu' })
    throw new ErreurHoteSource(MESSAGE)
  }
  const refusees = adresses.filter(a => adresseRestreinte(a) && !autorises.has(normaliser(a)))
  if (!adresses.length || refusees.length) {
    journal.avertissement('Hôte de source refusé', { domaine: 'sources', evenement: 'hote_refuse', adressesRefusees: refusees.length })
    throw new ErreurHoteSource(MESSAGE)
  }
}
