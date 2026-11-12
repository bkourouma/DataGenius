/**
 * Adresse a mettre dans un lien vers un document depose.
 *
 * Les documents sont enregistres en base sous /uploads/documents/<nom> et
 * servis par app/api/uploads/documents/[nom] (controle de session et de pays).
 * next.config.js reecrit l'ancienne adresse vers la route, mais le middleware
 * renvoie les comptes Agency vers /dashboard pour toute page hors de leur
 * liste, avant toute reecriture : un lien vers /uploads/... ne s'ouvrait donc
 * jamais pour eux. Le lien vise directement la route /api.
 *
 * Module sans dependance serveur : utilisable dans un composant client.
 */

export const PREFIXE_URL_DOCUMENTS = '/uploads/documents/'

export function lienDocument(url: string): string {
  return url.startsWith(PREFIXE_URL_DOCUMENTS) ? `/api${url}` : url
}
