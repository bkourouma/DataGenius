import { lookup } from 'node:dns/promises'
import { request as https } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { adresseRestreinte } from '@/lib/warehouse/hotes-sources'
import { journal } from '@/lib/journal'

type Raison = 'refuse' | 'reseau' | 'statut' | 'delai'
export type ResultatWebhook = { ok: true } | { ok: false; raison: Raison }

const DELAI_MS = 5000

class Echec extends Error {
  constructor(readonly raison: Raison) { super(raison) }
}

/** Attend la promesse, mais abandonne dès que le délai global est dépassé. */
function avecDelai<T>(promesse: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abandon = () => reject(new Echec('delai'))
    if (signal.aborted) return abandon()
    signal.addEventListener('abort', abandon, { once: true })
    promesse.then(resolve, reject).finally(() => signal.removeEventListener('abort', abandon))
  })
}

/** Résout l'hôte et exige que TOUTES les adresses soient publiques (aucune exception d'origine privée). */
async function adresse(url: URL, signal: AbortSignal) {
  const nom = url.hostname.replace(/^\[|\]$/g, '')
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new Echec('refuse')
  if (nom === 'localhost' || nom.endsWith('.localhost')) throw new Echec('refuse')
  if (isIP(nom)) {
    if (adresseRestreinte(nom)) throw new Echec('refuse')
    return nom
  }
  const adresses = await avecDelai(lookup(nom, { all: true }), signal).catch(erreur => {
    throw erreur instanceof Echec ? erreur : new Echec('refuse')
  })
  if (!adresses.length || adresses.some(a => adresseRestreinte(a.address))) throw new Echec('refuse')
  return adresses[0].address
}

function envoyer(url: URL, ip: string, corps: string, signal: AbortSignal) {
  const domaine = url.hostname.replace(/^\[|\]$/g, '')
  return new Promise<void>((resolve, reject) => {
    const req = https({ hostname: ip, servername: isIP(domaine) ? '' : domaine,
      checkServerIdentity: (_, certificat) => checkServerIdentity(domaine, certificat),
      path: url.pathname + url.search, signal, agent: false, method: 'POST', headers: {
        host: url.host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps),
      } }, res => {
      const statut = res.statusCode ?? 0
      res.destroy()
      if (statut >= 200 && statut < 300) resolve()
      else reject(new Echec('statut'))
    })
    req.on('error', () => reject(new Echec(signal.aborted ? 'delai' : 'reseau')))
    req.end(corps)
  })
}

/** Envoie la charge en POST, sans nouvelle tentative ni redirection. Ne lève jamais ; ne journalise ni l'adresse ni l'hôte. */
export async function envoyerWebhook(adresseWebhook: string, charge: unknown): Promise<ResultatWebhook> {
  let raison: Raison
  try {
    if (!URL.canParse(adresseWebhook)) throw new Echec('refuse')
    const url = new URL(adresseWebhook)
    const signal = AbortSignal.timeout(DELAI_MS)
    const ip = await adresse(url, signal)
    const corps = JSON.stringify(charge)
    await avecDelai(envoyer(url, ip, corps, signal), signal)
    return { ok: true }
  } catch (erreur) {
    raison = erreur instanceof Echec ? erreur.raison : 'reseau'
  }
  journal.avertissement('Webhook d’alerte non envoyé', { domaine: 'alertes_tableaux', raison })
  return { ok: false, raison }
}
