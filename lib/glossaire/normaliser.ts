/** Minuscules sans accents ni signes diacritiques : « Éléments » et « elements » se comparent égaux. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
