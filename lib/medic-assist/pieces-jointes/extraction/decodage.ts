/** Decodage de texte : UTF-8 (BOM retire) sinon Windows-1252 ; UTF-16 si une marque l'annonce. */

export function decoderTexte(octets: Uint8Array): string {
  if (octets.length >= 2 && octets[0] === 0xff && octets[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(octets.subarray(2))
  }
  if (octets.length >= 2 && octets[0] === 0xfe && octets[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(octets.subarray(2))
  }
  const debut =
    octets.length >= 3 && octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf ? 3 : 0
  const utile = octets.subarray(debut)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(utile)
  } catch {
    return new TextDecoder('windows-1252').decode(utile)
  }
}
