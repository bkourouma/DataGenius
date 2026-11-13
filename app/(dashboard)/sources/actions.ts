'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import {
  ajouterSource,
  ajouterSourceMySql,
  ajouterSourceRest,
  ajouterSourceFichier,
  remplacerSourceFichier,
  creerImport,
  modifierFrequence,
  ErreurAdministrationSource,
  chargerConnexionSource,
  modifierSource,
  supprimerSource,
  renommerImport,
  supprimerImport,
} from '@/lib/warehouse/sources-admin'
import { dernierCodeExecution } from '@/lib/warehouse/jeux-admin'
import { retourSynchro } from '@/lib/warehouse/libelles-synchro'
import { MAX_FICHIER } from '@/lib/warehouse/connecteurs/fichier'

type Etat = { erreur?: string; succes?: string }

export async function ajouterConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  let id: string
  try {
    const connexion = {
      hote: formulaire.get('hote'), port: formulaire.get('port'),
      base: formulaire.get('base'), utilisateur: formulaire.get('utilisateur'),
      motDePasse: formulaire.get('motDePasse'), tls: formulaire.get('tls'),
    }
    const titre = formulaire.get('titre')
    id = formulaire.get('moteur') === 'mysql' ? await ajouterSourceMySql(titre, connexion) : await ajouterSource({ titre, ...connexion })
  } catch {
    return { erreur: 'Connexion impossible. Vérifiez les paramètres, le compte de lecture et la configuration du serveur.' }
  }
  revalidatePath('/sources')
  redirect('/sources/' + id)
}

export async function ajouterConnexionRest(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  let id: string
  try {
    id = await ajouterSourceRest(formulaire.get('titre'), {
      url: formulaire.get('url'), token: formulaire.get('token'),
      chemin: formulaire.get('chemin'), parametrePage: formulaire.get('parametrePage'),
    })
  } catch {
    return { erreur: 'API indisponible. Vérifiez l’URL autorisée, le jeton et le chemin vers le tableau JSON.' }
  }
  revalidatePath('/sources')
  redirect('/sources/' + id)
}

export async function importerFichierSource(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const fichier = formulaire.get('fichier')
  if (!(fichier instanceof File) || !fichier.size || fichier.size > MAX_FICHIER) return { erreur: 'Choisissez un fichier CSV ou Excel de 5 Mio maximum.' }
  const source = formulaire.get('sourceId')
  let id: string
  try {
    const config = { nom: fichier.name, contenu: new Uint8Array(await fichier.arrayBuffer()) }
    if (typeof source === 'string') {
      await remplacerSourceFichier(source, config)
      id = source
    } else {
      id = await ajouterSourceFichier(formulaire.get('titre'), config)
    }
  } catch {
    return { erreur: 'Fichier non enregistré. Vérifiez son format et la présence d’au moins une feuille importable de 5 000 lignes au plus.' }
  }
  revalidatePath('/sources')
  if (typeof source === 'string') {
    revalidatePath('/sources/' + id)
    return { succes: 'Fichier remplacé. Relancez les imports liés pour publier les nouvelles données.' }
  }
  redirect('/sources/' + id)
}

export async function ajouterImport(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    await creerImport({
      sourceId: formulaire.get('sourceId'), schema: formulaire.get('schema'), table: formulaire.get('table'),
      titre: formulaire.get('titre'), description: formulaire.get('description'), colonnes: formulaire.getAll('colonnes'),
      frequenceMinutes: formulaire.get('frequenceMinutes'),
    })
  } catch (erreur) {
    return {
      erreur: erreur instanceof ErreurAdministrationSource ? erreur.message :
        'Import non enregistré. Sélectionnez entre 1 et 50 colonnes accessibles et une fréquence valide.',
    }
  }
  revalidatePath('/sources')
  redirect('/sources')
}

export async function changerFrequence(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    const cle = formulaire.get('jeu')
    if (typeof cle !== 'string') return { erreur: 'Import introuvable.' }
    await modifierFrequence(cle, formulaire.get('frequenceMinutes'))
  } catch {
    return { erreur: 'Fréquence non enregistrée. Indiquez de 1 à 10 080 minutes.' }
  }
  revalidatePath('/sources')
  return { succes: 'Fréquence enregistrée.' }
}


const CLE_JEU = /^[a-z][a-z0-9_]{0,59}$/
const ID_SOURCE = /^[A-Za-z0-9_-]{1,64}$/

export async function actualiserJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const jeu = formulaire.get('jeu')
  if (typeof jeu !== 'string' || !CLE_JEU.test(jeu)) return { erreur: 'Jeu introuvable.' }
  let resultats: { jeu: string; statut: string; code?: string }[]
  try {
    resultats = await synchroniserEntrepot({ forcer: true, jeu })
  } catch (erreur) {
    console.error('[datagenius] sources', { evenement: 'synchro_manuelle', jeu, erreur: erreur instanceof Error ? erreur.message : 'inconnue' })
    return { erreur: 'Synchronisation impossible. Réessayez dans un instant.' }
  }
  revalidatePath('/sources')
  const resultat = resultats[0]
  if (!resultat) return { erreur: 'Jeu introuvable.' }
  // Sans code dans le résultat (lot de fiabilité non fusionné), relit le dernier code enregistré.
  let code: string | null | undefined = resultat.code
  if (resultat.statut === 'echec' && !code) code = await dernierCodeExecution(jeu).catch(() => null)
  return retourSynchro({ statut: resultat.statut, code })
}

export async function modifierConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const id = formulaire.get('sourceId')
  if (typeof id !== 'string' || !ID_SOURCE.test(id)) return { erreur: 'Source introuvable.' }
  try {
    const actuelle = await chargerConnexionSource(id)
    if (!actuelle) return { erreur: 'Source introuvable.' }
    const champ = (nom: string) => formulaire.get(nom)
    let entree: Record<string, unknown>
    if (actuelle.type === 'rest') {
      entree = { titre: champ('titre'), url: champ('url'), token: champ('token'), chemin: champ('chemin'), parametrePage: champ('parametrePage') }
    } else if (actuelle.type === 'fichier') {
      entree = { titre: champ('titre') }
    } else {
      entree = {
        titre: champ('titre'), hote: champ('hote'), port: champ('port'), base: champ('base'),
        utilisateur: champ('utilisateur'), motDePasse: champ('motDePasse'), tls: champ('tls'),
      }
    }
    await modifierSource(id, entree)
  } catch (erreur) {
    return {
      erreur: erreur instanceof ErreurAdministrationSource ? erreur.message :
        'Modification refusée : la connexion n’a pas pu être testée. Les paramètres actuels sont conservés.',
    }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/' + id)
  return { succes: 'Connexion modifiée et testée.' }
}

export async function supprimerConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const id = formulaire.get('sourceId')
  if (typeof id !== 'string' || !ID_SOURCE.test(id)) return { erreur: 'Source introuvable.' }
  if (formulaire.get('confirmation') !== 'on') return { erreur: 'Cochez la case de confirmation pour supprimer la source.' }
  try {
    await supprimerSource(garde.contexte.userId, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? erreur.message : 'Suppression impossible. Réessayez dans un instant.' }
  }
  revalidatePath('/sources')
  redirect('/sources')
}

export async function renommerJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !CLE_JEU.test(cle)) return { erreur: 'Import introuvable.' }
  try {
    await renommerImport(garde.contexte.userId, cle, formulaire.get('titre'))
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? erreur.message : 'Nom non enregistré. Indiquez un nom de 1 à 120 caractères.' }
  }
  revalidatePath('/sources')
  return { succes: 'Nom enregistré.' }
}

export async function supprimerJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !CLE_JEU.test(cle)) return { erreur: 'Import introuvable.' }
  if (formulaire.get('confirmation') !== 'on') return { erreur: 'Cochez la case de confirmation pour supprimer l’import.' }
  try {
    await supprimerImport(garde.contexte.userId, cle)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? erreur.message : 'Suppression impossible. Réessayez dans un instant.' }
  }
  revalidatePath('/sources')
  return { succes: 'Import supprimé.' }
}
