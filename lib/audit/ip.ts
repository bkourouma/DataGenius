import { headers } from 'next/headers'
import { extraireIp, sautsProxyDeConfiance } from '@/lib/auth/limite-connexion'

/**
 * IP du client de la requête courante, avec la même logique de proxy de confiance que la limite de
 * connexion. Hors requête (worker, test) `headers()` lève : on renvoie alors undefined, comme sans
 * DATAGENIUS_PROXY_DE_CONFIANCE.
 */
export function ipRequeteCourante(): string | undefined {
  try {
    return extraireIp(headers(), sautsProxyDeConfiance())
  } catch {
    return undefined
  }
}
