/**
 * Construit la reponse HTTP d'un artefact (`ArtefactReponse`) : le DTO du stockage, les lignes
 * de chaque jeu (lot 2, dans le perimetre du lecteur) et, pour un document, les artefacts
 * qu'il cite (un seul niveau).
 *
 * Securite :
 * - le SQL de la provenance n'est conserve que pour un administrateur de Medic Assist, dans
 *   `jeux[].provenance` comme dans les artefacts lies ;
 * - une erreur du lot 2 sur un jeu n'interrompt pas la lecture : le jeu est omis de `donnees`
 *   et seul le NOM de l'erreur est journalise (jamais le message, qui peut citer des donnees) ;
 * - un artefact cite inaccessible au lecteur est omis (meme regle d'acces que l'artefact).
 */

import { NextResponse } from 'next/server';

import { artefactsReferences, type ContexteExecution } from '@/lib/medic-assist/contrats';
import { peutAdministrerMedicAssist } from '@/lib/medic-assist/contrats/droits';

import {
  CODE_LIMITE_DEBIT_DONNEES,
} from '@/lib/medic-assist/donnees/limite-debit';
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types';

import { dependancesParDefaut } from './dependances';
import { ErreurExport, type DependancesArtefacts } from './ports';
import type { ArtefactReponse, DonneesJeuReponse, JeuLimiteReponse } from './reponse';
import { ErreurArtefact, lireArtefact } from './stockage-impl';

export interface OptionsReponseArtefact {
  version?: number;
  /** Doublure de test ; par défaut le branchement réel. */
  deps?: DependancesArtefacts;
}

const DELAI_REPLI_MS = 60_000;

/** Délai avant réessai si l'erreur est une limite de débit des rejeux (lot 2 ou export), sinon undefined. */
function delaiLimiteDebit(erreur: unknown): number | undefined {
  if (erreur instanceof ErreurDonnees && erreur.code === CODE_LIMITE_DEBIT_DONNEES) {
    return erreur.reessayerDansMs ?? DELAI_REPLI_MS;
  }
  if (erreur instanceof ErreurExport && erreur.code === 'limite_debit') {
    return erreur.reessayerDansMs ?? DELAI_REPLI_MS;
  }
  return undefined;
}

/** Secondes entières (au moins 1) avant de réessayer, pour Retry-After et le panneau. */
function secondesAvantReessai(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

async function donneesDesJeux(
  dto: Awaited<ReturnType<typeof lireArtefact>>,
  contexte: ContexteExecution,
  deps: DependancesArtefacts
): Promise<{
  donnees: Record<string, DonneesJeuReponse>;
  jeuxLimites: Record<string, JeuLimiteReponse>;
}> {
  const donnees: Record<string, DonneesJeuReponse> = {};
  const jeuxLimites: Record<string, JeuLimiteReponse> = {};
  const charger = deps.chargerLignesPourAffichage;
  if (!charger) return { donnees, jeuxLimites };
  // Recalcul dans le perimetre du lecteur seulement s'il n'est pas le proprietaire.
  const recalculer = dto.proprietaire.id !== contexte.userId;
  // Le jeu est celui du propriétaire de l'artefact (lu avec contrôle d'accès) : le lot 2 le
  // charge par { id, propriétaire } et rejoue dans le périmètre du lecteur.
  const viaArtefact = recalculer ? { proprietaireId: dto.proprietaire.id } : undefined;
  await Promise.all(
    dto.jeux.map(async jeu => {
      try {
        const lues = await charger.call(deps, jeu.jeuDeDonneesId, contexte, {
          recalculer,
          ...(viaArtefact ? { viaArtefact } : {}),
        });
        if (lues) donnees[jeu.jeuDeDonneesId] = lues;
      } catch (erreur) {
        const ms = delaiLimiteDebit(erreur);
        if (ms !== undefined) {
          // Limite de rejeux atteinte : le client explique quand réessayer (pas de tableau vide muet).
          jeuxLimites[jeu.jeuDeDonneesId] = { reessayerDansSecondes: secondesAvantReessai(ms) };
          return;
        }
        console.error(
          '[medic-assist] jeu illisible pour un artefact',
          erreur instanceof Error ? erreur.name : typeof erreur
        );
      }
    })
  );
  return { donnees, jeuxLimites };
}

async function construire(
  contexte: ContexteExecution,
  artefactId: string,
  version: number | undefined,
  deps: DependancesArtefacts,
  avecLies: boolean
): Promise<ArtefactReponse> {
  const dto = await lireArtefact(
    contexte,
    artefactId,
    version === undefined ? undefined : { version }
  );
  const admin = peutAdministrerMedicAssist(contexte.roleName, contexte.habilitations);
  const jeux = admin
    ? dto.jeux
    : dto.jeux.map(jeu => {
        const { sql: _sql, ...provenance } = jeu.provenance;
        void _sql;
        return { ...jeu, provenance };
      });

  const { donnees, jeuxLimites } = await donneesDesJeux(dto, contexte, deps);
  const reponse: ArtefactReponse = {
    ...dto,
    jeux,
    donnees,
    ...(Object.keys(jeuxLimites).length > 0 ? { jeuxLimites } : {}),
  };

  if (avecLies) {
    const lies: Record<string, ArtefactReponse> = {};
    for (const id of artefactsReferences(dto.spec)) {
      try {
        lies[id] = await construire(contexte, id, undefined, deps, false);
      } catch (erreur) {
        // Inaccessible : omis, sans reveler son existence.
        if (!(erreur instanceof ErreurArtefact)) throw erreur;
      }
    }
    if (Object.keys(lies).length > 0) reponse.artefactsLies = lies;
  }
  return reponse;
}

/** `ArtefactReponse` de la version demandée (la dernière par défaut). */
export function construireReponseArtefact(
  contexte: ContexteExecution,
  artefactId: string,
  options: OptionsReponseArtefact = {}
): Promise<ArtefactReponse> {
  return construire(
    contexte,
    artefactId,
    options.version,
    options.deps ?? dependancesParDefaut,
    true
  );
}

const SANS_CACHE = { 'Cache-Control': 'private, no-store' } as const;

/** Réponse JSON des routes d'artefacts : jamais mise en cache. */
export function reponseJsonArtefact(corps: unknown, status = 200): NextResponse {
  return NextResponse.json(corps, { status, headers: SANS_CACHE });
}

/**
 * Traduit une erreur du stockage en réponse HTTP `{ error, message }`, sans détail interne.
 * Inconnue : 500, avec le seul NOM de l'erreur dans le journal.
 */
export function reponseErreurArtefact(erreur: unknown): NextResponse {
  if (erreur instanceof ErreurArtefact) {
    switch (erreur.code) {
      case 'spec_invalide':
        return reponseJsonArtefact(
          { error: 'BadRequest', message: 'Spécification d’artefact invalide.' },
          400
        );
      case 'jeu_inaccessible':
        return reponseJsonArtefact(
          { error: 'BadRequest', message: 'Jeu de données non accessible.' },
          400
        );
      case 'introuvable':
        return reponseJsonArtefact({ error: 'NotFound', message: 'Artefact introuvable.' }, 404);
      case 'interdit':
        return reponseJsonArtefact(
          { error: 'Forbidden', message: 'Modification non autorisée.' },
          403
        );
      case 'conflit':
        return reponseJsonArtefact(
          { error: 'Conflict', message: 'Une version plus récente existe.' },
          409
        );
    }
  }
  const ms = delaiLimiteDebit(erreur);
  if (ms !== undefined) {
    // Message neutre : les appelants ne passent pas la langue, le client traduit via le code.
    const secondes = secondesAvantReessai(ms);
    return NextResponse.json(
      {
        error: 'TooManyRequests',
        code: CODE_LIMITE_DEBIT_DONNEES,
        message: 'Too many recalculations. Try again in a few minutes.',
      },
      { status: 429, headers: { ...SANS_CACHE, 'Retry-After': String(secondes) } }
    );
  }
  console.error(
    '[medic-assist] artefact en échec',
    erreur instanceof Error ? erreur.name : typeof erreur
  );
  return reponseJsonArtefact({ error: 'InternalError', message: 'Erreur interne.' }, 500);
}
