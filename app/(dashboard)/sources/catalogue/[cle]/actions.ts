'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerCatalogueMetier, ErreurCatalogueMetier, publierCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { ZodError } from 'zod'

export async function publier(
  cle: string, version: number, _etat: { erreur?: string }, donnees: FormData,
): Promise<{ erreur?: string }> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(cle)) return { erreur: 'Jeu introuvable.' }

  try {
    const catalogue = await chargerCatalogueMetier(cle)
    if (!catalogue) return { erreur: 'Jeu introuvable.' }
    const lire = (champ: string) => String(donnees.get(champ) ?? '').trim()
    const facultatif = (champ: string) => lire(champ) || undefined
    const ids = (champ: string, maximum: number) => {
      const valeurs = donnees.getAll(champ).map(String)
      if (valeurs.length > maximum || new Set(valeurs).size !== valeurs.length || valeurs.some(id => !/^\d{1,5}$/.test(id))) {
        throw new Error('Sélection invalide.')
      }
      return valeurs
    }
    const colonnes = catalogue.colonnes.flatMap(({ nom, description: descriptionParDefaut }) => {
      const description = lire(`description-${nom}`)
      const synonymes = lire(`synonymes-${nom}`).split(',').map(s => s.trim()).filter(Boolean)
      return description || synonymes.length ? [{ nom, description: description || descriptionParDefaut, synonymes }] : []
    })
    const mesures = ids('mesures', 30).map(id => {
      const agregat = lire(`agregat-${id}`)
      const filtres = ids(`filtres-${id}`, 6).map(filtre => ({
        colonne: lire(`colonne-filtre-${id}-${filtre}`),
        operateur: lire(`operateur-filtre-${id}-${filtre}`),
        valeur: String(donnees.get(`valeur-filtre-${id}-${filtre}`) ?? ''),
      }))
      return {
        cle: lire(`cle-${id}`), libelle: lire(`libelle-${id}`), description: lire(`definition-${id}`),
        colonne: lire(`colonne-${id}`), agregat, denominateur: agregat === 'rapport' ? facultatif(`denominateur-${id}`) : undefined,
        unite: facultatif(`unite-${id}`), devise: facultatif(`devise-${id}`)?.toUpperCase(), filtres,
      }
    })
    const colonneDate = facultatif('colonne-date')
    await publierCatalogueMetier(cle, version, {
      description: lire('description'), grain: lire('grain'), calendrier: facultatif('calendrier'),
      calendrierFiscal: colonneDate ? { colonneDate, moisDebutExercice: Number(lire('debut-exercice')) } : undefined,
      responsable: facultatif('responsable'), cles: donnees.getAll('cles'), dimensions: donnees.getAll('dimensions'),
      colonnes, mesures,
    }, garde.contexte.userId)
  } catch (erreur) {
    if (erreur instanceof ErreurCatalogueMetier) return { erreur: erreur.message }
    if (erreur instanceof ZodError) return { erreur: 'Vérifiez les champs du catalogue et les colonnes des indicateurs.' }
    return { erreur: 'La publication du catalogue a échoué.' }
  }
  revalidatePath('/sources/catalogue/' + cle)
  redirect('/sources/catalogue/' + cle + '?publication=ok')
}
