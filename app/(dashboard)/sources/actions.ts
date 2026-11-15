'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { journal } from '@/lib/journal'
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
import { MAX_FICHIER } from '@/lib/warehouse/connecteurs/fichier'
import { messageErreurLib } from './erreurs-lib'
import { retourSynchroTraduit } from './retour-synchro'

type Etat = { erreur?: string; succes?: string }

export async function ajouterConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
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
    return { erreur: t('connexionImpossible') }
  }
  revalidatePath('/sources')
  redirect('/sources/' + id)
}

export async function ajouterConnexionRest(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  let id: string
  try {
    id = await ajouterSourceRest(formulaire.get('titre'), {
      url: formulaire.get('url'), token: formulaire.get('token'),
      chemin: formulaire.get('chemin'), parametrePage: formulaire.get('parametrePage'),
    })
  } catch {
    return { erreur: t('apiIndisponible') }
  }
  revalidatePath('/sources')
  redirect('/sources/' + id)
}

export async function importerFichierSource(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const fichier = formulaire.get('fichier')
  if (!(fichier instanceof File) || !fichier.size || fichier.size > MAX_FICHIER) return { erreur: t('fichierInvalide') }
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
    return { erreur: t('fichierNonEnregistre') }
  }
  revalidatePath('/sources')
  if (typeof source === 'string') {
    revalidatePath('/sources/' + id)
    return { succes: t('fichierRemplace') }
  }
  redirect('/sources/' + id)
}

export async function ajouterImport(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  try {
    await creerImport({
      sourceId: formulaire.get('sourceId'), schema: formulaire.get('schema'), table: formulaire.get('table'),
      titre: formulaire.get('titre'), description: formulaire.get('description'), colonnes: formulaire.getAll('colonnes'),
      frequenceMinutes: formulaire.get('frequenceMinutes'),
    })
  } catch (erreur) {
    return {
      erreur: erreur instanceof ErreurAdministrationSource ? await messageErreurLib(erreur.message) :
        t('importNonEnregistre'),
    }
  }
  revalidatePath('/sources')
  redirect('/sources')
}

export async function changerFrequence(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  try {
    const cle = formulaire.get('jeu')
    if (typeof cle !== 'string') return { erreur: t('importIntrouvable') }
    await modifierFrequence(cle, formulaire.get('frequenceMinutes'))
  } catch {
    return { erreur: t('frequenceNonEnregistree') }
  }
  revalidatePath('/sources')
  return { succes: t('frequenceEnregistree') }
}


const CLE_JEU = /^[a-z][a-z0-9_]{0,59}$/
const ID_SOURCE = /^[A-Za-z0-9_-]{1,64}$/

export async function actualiserJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const jeu = formulaire.get('jeu')
  if (typeof jeu !== 'string' || !CLE_JEU.test(jeu)) return { erreur: t('jeuIntrouvable') }
  let resultats: { jeu: string; statut: string; code?: string }[]
  try {
    resultats = await synchroniserEntrepot({ forcer: true, jeu })
  } catch (erreur) {
    journal.erreur('Synchronisation manuelle impossible', { domaine: 'sources', jeu, erreur: erreur instanceof Error ? erreur.name : 'inconnue' })
    return { erreur: t('synchroImpossible') }
  }
  revalidatePath('/sources')
  const resultat = resultats[0]
  if (!resultat) return { erreur: t('jeuIntrouvable') }
  // Sans code dans le résultat (lot de fiabilité non fusionné), relit le dernier code enregistré.
  let code: string | null | undefined = resultat.code
  if (resultat.statut === 'echec' && !code) code = await dernierCodeExecution(jeu).catch(() => null)
  return retourSynchroTraduit(await getTranslations('sources.synchro'), { statut: resultat.statut, code })
}

export async function modifierConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const id = formulaire.get('sourceId')
  if (typeof id !== 'string' || !ID_SOURCE.test(id)) return { erreur: t('sourceIntrouvable') }
  try {
    const actuelle = await chargerConnexionSource(id)
    if (!actuelle) return { erreur: t('sourceIntrouvable') }
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
      erreur: erreur instanceof ErreurAdministrationSource ? await messageErreurLib(erreur.message) :
        t('modificationRefusee'),
    }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/' + id)
  return { succes: t('connexionModifiee') }
}

export async function supprimerConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const id = formulaire.get('sourceId')
  if (typeof id !== 'string' || !ID_SOURCE.test(id)) return { erreur: t('sourceIntrouvable') }
  if (formulaire.get('confirmation') !== 'on') return { erreur: t('confirmerSuppressionSource') }
  try {
    await supprimerSource(garde.contexte.userId, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? await messageErreurLib(erreur.message) : t('suppressionImpossible') }
  }
  revalidatePath('/sources')
  redirect('/sources')
}

export async function renommerJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !CLE_JEU.test(cle)) return { erreur: t('importIntrouvable') }
  try {
    await renommerImport(garde.contexte.userId, cle, formulaire.get('titre'))
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? await messageErreurLib(erreur.message) : t('nomNonEnregistre') }
  }
  revalidatePath('/sources')
  return { succes: t('nomEnregistre') }
}

export async function supprimerJeu(_etat: Etat, formulaire: FormData): Promise<Etat> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const t = await getTranslations('sources.actions')
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !CLE_JEU.test(cle)) return { erreur: t('importIntrouvable') }
  if (formulaire.get('confirmation') !== 'on') return { erreur: t('confirmerSuppressionImport') }
  try {
    await supprimerImport(garde.contexte.userId, cle)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource ? await messageErreurLib(erreur.message) : t('suppressionImpossible') }
  }
  revalidatePath('/sources')
  return { succes: t('importSupprime') }
}
