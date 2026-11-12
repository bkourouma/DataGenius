/**
 * Téléchargement d'un export Medic Assist depuis le navigateur.
 *
 * Module côté navigateur, sans React : déclenche l'enregistrement d'un fichier produit par
 * GET /api/medic-assist/artefacts/[id]/export?format=… en respectant le nom donné par le
 * serveur (`Content-Disposition`, y compris `filename*=UTF-8''…`, RFC 5987/6266).
 */

import type { FormatExport } from './exports/types'

export type CodeErreurTelechargement =
  | 'reseau'
  | 'refuse'
  | 'introuvable'
  | 'format'
  | 'trop_de_lignes'
  | 'echec'

/** Erreur typée : l'interface la traduit par `code` (erreurs.telechargement.*). */
export class ErreurTelechargement extends Error {
  constructor(
    public readonly code: CodeErreurTelechargement,
    public readonly statut?: number
  ) {
    super(code)
    this.name = 'ErreurTelechargement'
  }
}

/**
 * URL de l'export d'un artefact. L'identifiant est encodé : jamais de chemin libre. Avec
 * `version`, l'export porte sur cette version (celle affichée), pas sur la dernière.
 */
export function urlExport(artefactId: string, format: FormatExport, version?: number): string {
  const base = `/api/medic-assist/artefacts/${encodeURIComponent(artefactId)}/export?format=${encodeURIComponent(format)}`
  return version !== undefined && Number.isInteger(version) && version > 0
    ? `${base}&version=${version}`
    : base
}

function codePourStatut(statut: number): CodeErreurTelechargement {
  if (statut === 401 || statut === 403) return 'refuse'
  if (statut === 404) return 'introuvable'
  if (statut === 400) return 'format'
  if (statut === 413) return 'trop_de_lignes'
  return 'echec'
}

function decoderUri(valeur: string): string | null {
  try {
    return decodeURIComponent(valeur)
  } catch {
    return null
  }
}

/** Retire les séparateurs de chemin et les caractères de contrôle d'un nom de fichier. */
function nettoyerNom(nom: string): string {
  // eslint-disable-next-line no-control-regex
  const propre = nom.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim()
  return propre === '.' || propre === '..' ? '' : propre
}

/**
 * Nom de fichier d'un en-tête `Content-Disposition`. `filename*` (UTF-8) l'emporte sur
 * `filename`. Renvoie null si aucun nom exploitable.
 */
export function nomDepuisContentDisposition(entete: string | null | undefined): string | null {
  if (!entete) return null

  const etendu = /filename\*\s*=\s*([^;]+)/i.exec(entete)
  if (etendu) {
    const valeur = etendu[1].trim()
    // Forme `charset'langue'valeur-encodée-en-pourcentage`.
    const m = /^([^']*)'[^']*'(.*)$/.exec(valeur)
    const brut = m ? m[2] : valeur
    const decode = decoderUri(brut.replace(/^"|"$/g, ''))
    const nom = decode ? nettoyerNom(decode) : ''
    if (nom) return nom
  }

  const simple = /filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(entete)
  if (simple) {
    const brut = simple[2] !== undefined ? simple[2].replace(/\\(.)/g, '$1') : simple[1].trim()
    const nom = nettoyerNom(brut)
    if (nom) return nom
  }
  return null
}

/**
 * Télécharge `url` et propose l'enregistrement du fichier.
 *
 * @param nomRepli nom utilisé si le serveur n'en donne pas.
 * @throws ErreurTelechargement (`reseau` si le serveur est injoignable, sinon selon le statut).
 */
export async function telechargerDepuisUrl(url: string, nomRepli: string): Promise<void> {
  let reponse: Response
  try {
    reponse = await fetch(url, { credentials: 'same-origin' })
  } catch {
    throw new ErreurTelechargement('reseau')
  }
  if (!reponse.ok) throw new ErreurTelechargement(codePourStatut(reponse.status), reponse.status)

  let blob: Blob
  try {
    blob = await reponse.blob()
  } catch {
    throw new ErreurTelechargement('reseau')
  }

  const nom =
    nomDepuisContentDisposition(reponse.headers.get('Content-Disposition')) ??
    (nettoyerNom(nomRepli) || 'export')

  const adresse = URL.createObjectURL(blob)
  try {
    const lien = document.createElement('a')
    lien.href = adresse
    lien.download = nom
    lien.rel = 'noopener'
    lien.style.display = 'none'
    document.body.appendChild(lien)
    lien.click()
    document.body.removeChild(lien)
  } finally {
    // Laisse au navigateur le temps de lancer l'enregistrement avant de libérer le Blob.
    setTimeout(() => URL.revokeObjectURL(adresse), 0)
  }
}
