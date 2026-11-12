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
} from '@/lib/warehouse/sources-admin'
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

export async function actualiserJeu(formulaire: FormData) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return
  const jeu = formulaire.get('jeu')
  if (typeof jeu !== 'string' || !/^[a-z][a-z0-9_]{0,59}$/.test(jeu)) return
  await synchroniserEntrepot({ forcer: true, jeu })
  revalidatePath('/sources')
}
