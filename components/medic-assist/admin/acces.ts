/**
 * Droit de voir l'ecran d'administration de Medic Assist.
 *
 * Meme regle que la garde d'API `exigerAdminMedicAssist` (architecture §3) :
 * `peutAdministrerMedicAssist` de contrats/droits.ts, appliquee au role RELU en base
 * (getAccessScope), jamais au role de la session, qui peut etre en retard. Ce test ne
 * sert qu'a ne pas montrer un ecran vide : la vraie protection reste dans les routes
 * /api/medic-assist/admin/*.
 */

import { peutAdministrerMedicAssist } from '@/lib/medic-assist/contrats/droits';

export interface EntreeAcces {
  /** Role relu en base (scope.roleName). */
  roleName: string | null | undefined;
  /** Perimetre siege (scope.voitTout). */
  voitTout: boolean;
  habilitations: readonly string[] | null | undefined;
}

export function peutVoirAdministration(acces: EntreeAcces | null | undefined): boolean {
  if (!acces) return false;
  return acces.voitTout && peutAdministrerMedicAssist(acces.roleName, acces.habilitations);
}
