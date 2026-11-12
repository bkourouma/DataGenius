'use client';

/**
 * Compte de la personne connectee, pour le choix « Moi » du selecteur de
 * personnes. Le selecteur de recherche exclut l'utilisateur courant (voulu pour
 * le partage) : ici on le resout a part, par son identifiant de session.
 *
 * Renvoie `null` tant que le compte n'est pas charge, ou si le chargement
 * echoue : le choix « Moi » n'apparait alors simplement pas (aucune erreur).
 * `actif` = false : aucun appel (carte deja traitee, rien a choisir).
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import { resoudreComptes } from './api-client';

export function useMoi(actif = true): CompteJson | null {
  const { data: session } = useSession();
  const id = session?.user?.id;
  const [moi, setMoi] = useState<CompteJson | null>(null);

  useEffect(() => {
    if (!id || !actif) {
      setMoi(null);
      return;
    }
    const controleur = new AbortController();
    resoudreComptes([id], controleur.signal)
      .then(comptes => {
        if (controleur.signal.aborted) return;
        setMoi(comptes.find(c => c.id === id) ?? null);
      })
      .catch(() => {
        if (!controleur.signal.aborted) setMoi(null);
      });
    return () => controleur.abort();
  }, [id, actif]);

  return moi;
}
