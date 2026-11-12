import { AccesReserve } from '@/components/medic-assist/admin/acces-reserve';
import { peutVoirAdministration } from '@/components/medic-assist/admin/acces';
import { AdministrationMedicAssist } from '@/components/medic-assist/admin/administration-medic-assist';
import { getAccessScope } from '@/lib/auth/access-scope';
import { getSession } from '@/lib/auth/utils';

// La session dicte l'affichage : la page n'est jamais prerendue.
export const dynamic = 'force-dynamic';

/**
 * Administration de Medic Assist (fournisseur, modeles, usages et couts, avis).
 *
 * La page ne decide que de l'affichage : un compte sans droit voit l'etat
 * « Acces reserve » et aucune donnee. Le role est relu en base (getAccessScope),
 * comme la garde d'API, parce que celui de la session peut etre en retard sur un
 * changement de role. La vraie protection est dans les routes /api/medic-assist/admin/*.
 */
export default async function AdministrationMedicAssistPage() {
  const session = await getSession();
  if (!session?.user?.id) return <AccesReserve />;

  const scope = await getAccessScope(session.user.id);
  const autorise = peutVoirAdministration(
    scope
      ? {
          roleName: scope.roleName,
          voitTout: scope.voitTout,
          habilitations: session.user.habilitations ?? null,
        }
      : null
  );
  if (!autorise) return <AccesReserve />;

  // L'identifiant ne sert qu'a reconnaitre ses propres avis (lien vers sa conversation).
  return <AdministrationMedicAssist identifiantAdmin={session.user.id} />;
}
