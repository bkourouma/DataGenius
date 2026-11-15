export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { verifierEnvironnement } = await import('./lib/env')
  const { journal } = await import('./lib/journal')
  try {
    verifierEnvironnement('web')
  } catch (erreur) {
    journal.erreur('Démarrage refusé : environnement invalide', {
      erreur,
      variables: (erreur as { variables?: string[] }).variables,
    })
    throw erreur
  }
}
