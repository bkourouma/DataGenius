import { TITRE_PAR_DEFAUT_CONVERSATION } from '@/lib/medic-assist/contrats/constantes'

/**
 * Vrai si le titre est vide ou celui de repli du serveur (l'interface affiche alors
 * `liste.sansTitre`, dans la langue de l'utilisateur).
 */
export function estTitreParDefaut(titre: string | null | undefined): boolean {
  const propre = titre?.trim() ?? ''
  return propre === '' || propre === TITRE_PAR_DEFAUT_CONVERSATION
}
