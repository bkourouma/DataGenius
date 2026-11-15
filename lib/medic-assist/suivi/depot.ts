/**
 * Depot du suivi : toutes les lectures et ecritures des tables Assistant* dont
 * le lot 5 a besoin, derriere une interface. Les services (actions, rapports,
 * partages...) ne parlent qu'a cette interface, ce qui les rend testables sans
 * base (tests/unit/medic-assist/lot5/_depot-memoire.ts) et independants des
 * noms exacts du schema Prisma pose par le lot 0.
 *
 * REGLE DE SECURITE : toute methode qui prend un `userId` met ce `userId` (ou
 * le partage) dans le MEME `where` que l'identifiant (`where: { id, userId }`),
 * jamais une lecture par id suivie d'un controle apres coup.
 *
 * L'implementation Prisma est ecrite en phase B (depot-prisma.ts).
 */

import type { ResultatAction } from '@/lib/medic-assist/contrats'

import type {
  ActionRow,
  AnalyseResume,
  ArtefactVisible,
  ConversationResume,
  EpingleResume,
  ModificationRapportProgramme,
  NouveauPartage,
  NouveauRapportProgramme,
  NouvelleAction,
  PartageEnvoye,
  PartageRecu,
  RapportProgrammeRow,
  ResultatEnvoiRapport,
} from './types'

export interface Pagination {
  page: number
  taille: number
}

export interface DepotSuivi {
  // ----- lecture minimale des conversations et artefacts (lots 1 et 4)
  /** Artefact dont `userId` est proprietaire OU destinataire d'un partage (meme where). */
  trouverArtefactVisible(artefactId: string, userId: string): Promise<ArtefactVisible | null>
  /** Artefact dont `userId` est proprietaire. */
  trouverArtefactProprietaire(artefactId: string, userId: string): Promise<ArtefactVisible | null>
  trouverConversationProprietaire(
    conversationId: string,
    userId: string
  ): Promise<ConversationResume | null>

  // ----- actions proposees par l'assistant
  creerAction(donnees: NouvelleAction): Promise<ActionRow>
  /** `where: { id, userId }` : l'action d'un autre est introuvable. */
  trouverAction(id: string, userId: string): Promise<ActionRow | null>
  /** Reecrit parametres et resume tant que l'action est 'proposee' ; false sinon. */
  mettreAJourActionProposee(
    id: string,
    userId: string,
    donnees: { parametres: unknown; resume: string }
  ): Promise<boolean>
  /**
   * Compare-and-set atomique : `updateMany({ where: { id, userId, statut: 'proposee' },
   * data: { statut: 'executee', executeeA: now } })`. Vrai pour UN SEUL appelant ;
   * c'est ce qui rend la confirmation idempotente.
   */
  reserverAction(id: string, userId: string): Promise<boolean>
  /**
   * Cloture une action reservee : 'executee' ou 'echec'. Le resultat est toujours au
   * format du contrat ; en echec, resultat.erreur porte le code court.
   */
  terminerAction(
    id: string,
    userId: string,
    donnees: { statut: 'executee' | 'echec'; resultat: ResultatAction }
  ): Promise<void>
  /** 'proposee' -> 'annulee' ; false si l'action n'est plus 'proposee' ou n'est pas a userId. */
  annulerAction(id: string, userId: string): Promise<boolean>
  /** Identifiants des Task creees par les actions executees de `userId` (resultat.entiteId). */
  idsTachesCreeesPar(userId: string): Promise<string[]>
  /** Pour des Task, l'utilisateur dont l'action executee les a creees (tacheId -> userId). */
  createursDesTaches(tacheIds: string[]): Promise<Map<string, string>>

  // ----- Mes analyses (artefacts enregistres)
  /** Vrai si l'enregistrement est nouveau, faux s'il existait deja (idempotent). */
  enregistrerAnalyse(userId: string, artefactId: string): Promise<boolean>
  retirerAnalyse(userId: string, artefactId: string): Promise<boolean>
  listerAnalyses(
    userId: string,
    options: { recherche?: string; artefactId?: string } & Pagination
  ): Promise<{ lignes: AnalyseResume[]; total: number }>

  // ----- epingles du tableau de bord
  epingler(userId: string, artefactId: string): Promise<boolean>
  desepingler(userId: string, artefactId: string): Promise<boolean>
  listerEpingles(userId: string, options?: { artefactId?: string }): Promise<EpingleResume[]>

  // ----- partages
  /**
   * Cree les partages (ignore ceux qui existent deja : unique par cible et
   * destinataire) ; renvoie ceux qui ont ete REELLEMENT crees, pour ne notifier
   * que les nouveaux destinataires.
   */
  creerPartages(partages: NouveauPartage[]): Promise<NouveauPartage[]>
  listerPartagesRecus(
    userId: string,
    pagination: Pagination
  ): Promise<{ lignes: PartageRecu[]; total: number }>
  listerPartagesEnvoyes(
    userId: string,
    pagination: Pagination
  ): Promise<{ lignes: PartageEnvoye[]; total: number }>

  /**
   * Retire un partage dont `userId` est l'expediteur OU le destinataire (meme where),
   * et, dans la meme transaction, les epingles du destinataire que ce partage
   * justifiait (sauf si un autre partage ou la propriete les justifie encore).
   * Faux (rien d'autre n'est touche) si le partage n'existe pas ou ne concerne pas `userId`.
   */
  retirerPartage(partageId: string, userId: string): Promise<boolean>

  // ----- rapports programmes
  creerRapport(donnees: NouveauRapportProgramme): Promise<RapportProgrammeRow>
  trouverRapport(id: string, userId: string): Promise<RapportProgrammeRow | null>
  listerRapports(userId: string): Promise<RapportProgrammeRow[]>
  mettreAJourRapport(
    id: string,
    userId: string,
    modification: ModificationRapportProgramme
  ): Promise<RapportProgrammeRow | null>
  supprimerRapport(id: string, userId: string): Promise<boolean>
  /**
   * Appel systeme (tache planifiee) : rapports actifs dont prochainEnvoiA <= maintenant
   * ET dont le bail est absent ou expire (enCoursJusqua null ou <= maintenant).
   */
  listerRapportsEchus(maintenant: Date, limite: number): Promise<RapportProgrammeRow[]>
  /**
   * Compare-and-set qui POSE le bail : updateMany({ where: { id, actif: true,
   * prochainEnvoiA: attendu.prochainEnvoiA, essais: attendu.essais, enCoursJusqua null ou
   * <= maintenant }, data: { enCoursJusqua: jusqua, essais: essaisApres } }). Vrai pour UN
   * SEUL appelant : deux executions simultanees n'envoient pas deux fois le meme rapport.
   * prochainEnvoiA n'est PAS avance ici : il l'est a l'enregistrement du resultat.
   */
  reserverRapport(
    id: string,
    attendu: { prochainEnvoiA: Date; essais: number },
    maintenant: Date,
    jusqua: Date,
    essaisApres: number
  ): Promise<boolean>
  /** Ecrit le resultat ; remet TOUJOURS enCoursJusqua a null (bail leve). */
  enregistrerResultatRapport(id: string, resultat: ResultatEnvoiRapport): Promise<void>
  /** Identifiants des TenantAdmin actifs (roleName 'TenantAdmin', status 'active', non supprimes). */
  listerAdministrateursActifs(): Promise<string[]>
}
