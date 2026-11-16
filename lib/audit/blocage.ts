/**
 * Limite le nombre de lignes `connexion.bloquee` : une seule par clé (empreinte e-mail ou IP) et par
 * fenêtre de blocage, pour qu'une attaque par force brute ne fasse pas gonfler la table. La mémoire est
 * celle du processus (au plus une ligne par clé, fenêtre et processus) ; elle est bornée et purgée.
 */
const FENETRE_MS = 15 * 60_000
const ENTREES_MAX = 5000
const vues = new Map<string, number>()

export function doitTracerBlocage(cle: string, maintenant: number = Date.now()): boolean {
  const derniere = vues.get(cle)
  if (derniere !== undefined && maintenant - derniere < FENETRE_MS) return false
  if (vues.size >= ENTREES_MAX) {
    for (const [k, quand] of vues) if (maintenant - quand >= FENETRE_MS) vues.delete(k)
    if (vues.size >= ENTREES_MAX) vues.clear()
  }
  vues.set(cle, maintenant)
  return true
}

/** Pour les tests. */
export function reinitialiserBlocages(): void {
  vues.clear()
}
