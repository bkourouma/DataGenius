/** Suggestions qui s'appuient sur le catalogue de la source active. */
export function questionsDepart(): string[] {
  return ['jeux', 'indicateurs', 'ventilation', 'graphique'].map(cle => `accueil.questions.source.${cle}`)
}
