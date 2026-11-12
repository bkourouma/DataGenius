'use client';

/**
 * Rangee d'actions d'une analyse (artefact) : enregistrer dans « Mes analyses »,
 * epingler au tableau de bord, partager, programmer un envoi.
 *
 * Les deux bascules sont optimistes : l'etat change tout de suite, puis revient
 * en arriere avec un toast si le serveur refuse. Sous 640 px, le libelle se
 * replie en icone seule (le nom complet reste en `aria-label` et `title`).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, CalendarClock, Pin, Share2, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  analyseEnregistree,
  artefactEpingle,
  desepinglerArtefact,
  enregistrerAnalyse,
  estProprietaireArtefact,
  epinglerArtefact,
  retirerAnalyse,
  useAfficherErreur,
} from './api-client';
import { DialoguePartage } from './dialogue-partage';
import { DialogueProgrammer } from './dialogue-programmer';

export interface ActionsArtefactProps {
  artefactId: string;
  titre: string;
}

/** null = lecture de l'etat initial en cours. */
type EtatBascule = boolean | null;

export function ActionsArtefact({ artefactId, titre }: ActionsArtefactProps) {
  const t = useTranslations('medicAssistSuivi.actionsArtefact');
  const { toast } = useToast();
  const afficherErreur = useAfficherErreur();
  const afficherErreurRef = useRef(afficherErreur);
  afficherErreurRef.current = afficherErreur;

  const [enregistree, setEnregistree] = useState<EtatBascule>(null);
  const [epinglee, setEpinglee] = useState<EtatBascule>(null);
  // Seul le proprietaire enregistre, partage ou programme ; null = droits en cours de lecture.
  const [proprietaire, setProprietaire] = useState<EtatBascule>(null);
  const [partageOuvert, setPartageOuvert] = useState(false);
  const [programmerOuvert, setProgrammerOuvert] = useState(false);
  const occupe = useRef({ enregistree: false, epinglee: false });

  // Etat initial des deux bascules.
  useEffect(() => {
    const controleur = new AbortController();
    setEnregistree(null);
    setEpinglee(null);
    setProprietaire(null);
    // En cas d'echec de lecture des droits, on bloque par prudence les trois actions.
    estProprietaireArtefact(artefactId, controleur.signal)
      .then(setProprietaire)
      .catch(e => {
        if (controleur.signal.aborted) return;
        afficherErreurRef.current(e);
        setProprietaire(false);
      });
    analyseEnregistree(artefactId, controleur.signal)
      .then(setEnregistree)
      .catch(e => {
        if (controleur.signal.aborted) return;
        afficherErreurRef.current(e);
        setEnregistree(false);
      });
    artefactEpingle(artefactId, controleur.signal)
      .then(setEpinglee)
      .catch(e => {
        if (controleur.signal.aborted) return;
        afficherErreurRef.current(e);
        setEpinglee(false);
      });
    return () => controleur.abort();
  }, [artefactId]);

  async function basculer(
    cle: 'enregistree' | 'epinglee',
    courant: EtatBascule,
    appliquer: (v: EtatBascule) => void,
    appels: { ajouter: () => Promise<void>; retirer: () => Promise<void> },
    messages: { ajoute: string; retire: string }
  ) {
    if (courant === null || occupe.current[cle]) return;
    occupe.current[cle] = true;
    const suivant = !courant;
    appliquer(suivant);
    try {
      await (suivant ? appels.ajouter() : appels.retirer());
      toast({ description: suivant ? messages.ajoute : messages.retire });
    } catch (e) {
      appliquer(courant);
      afficherErreur(e);
    } finally {
      occupe.current[cle] = false;
    }
  }

  const idAide = `${useId()}-proprietaire`;
  const reserve = proprietaire !== true;
  // Les droits sont-ils connus et refusent-ils ? (le chargement n'affiche pas d'explication)
  const refuse = proprietaire === false;
  const aide = refuse ? idAide : undefined;

  return (
    <>
      <div role="group" aria-label={t('groupe')} className="flex flex-wrap items-center gap-2">
        <BoutonAction
          icone={Bookmark}
          libelle={t('enregistrer')}
          libelleCourt={t('enregistrerCourt')}
          pressed={enregistree}
          chargementLabel={t('chargementEtat')}
          desactive={reserve}
          aideId={aide}
          onClick={() =>
            basculer(
              'enregistree',
              enregistree,
              setEnregistree,
              {
                ajouter: () => enregistrerAnalyse(artefactId),
                retirer: () => retirerAnalyse(artefactId),
              },
              { ajoute: t('enregistreOk'), retire: t('retireOk') }
            )
          }
        />
        <BoutonAction
          icone={Pin}
          libelle={t('epingler')}
          libelleCourt={t('epinglerCourt')}
          pressed={epinglee}
          chargementLabel={t('chargementEtat')}
          onClick={() =>
            basculer(
              'epinglee',
              epinglee,
              setEpinglee,
              {
                ajouter: () => epinglerArtefact(artefactId),
                retirer: () => desepinglerArtefact(artefactId),
              },
              { ajoute: t('epingleOk'), retire: t('desepingleOk') }
            )
          }
        />
        <BoutonAction
          icone={Share2}
          libelle={t('partager')}
          libelleCourt={t('partager')}
          desactive={reserve}
          aideId={aide}
          onClick={() => setPartageOuvert(true)}
        />
        <BoutonAction
          icone={CalendarClock}
          libelle={t('programmer')}
          libelleCourt={t('programmer')}
          desactive={reserve}
          aideId={aide}
          onClick={() => setProgrammerOuvert(true)}
        />
      </div>
      {refuse && (
        <p id={idAide} className="mt-2 text-xs text-muted-foreground">
          {t('proprietaireSeulement')}
        </p>
      )}

      <DialoguePartage
        cible={{ type: 'artefact', id: artefactId }}
        titre={titre}
        ouvert={partageOuvert}
        onOuvertChange={setPartageOuvert}
      />
      <DialogueProgrammer
        artefactId={artefactId}
        titre={titre}
        ouvert={programmerOuvert}
        onOuvertChange={setProgrammerOuvert}
      />
    </>
  );
}

function BoutonAction({
  icone: Icone,
  libelle,
  libelleCourt,
  pressed,
  chargementLabel,
  desactive,
  aideId,
  onClick,
}: {
  icone: LucideIcon;
  libelle: string;
  libelleCourt: string;
  /** undefined = bouton simple ; null = etat en cours de lecture. */
  pressed?: EtatBascule;
  chargementLabel?: string;
  /** Action reservee (droits en lecture ou refuses). */
  desactive?: boolean;
  /** Id du texte qui explique pourquoi le bouton est desactive. */
  aideId?: string;
  onClick: () => void;
}) {
  const bascule = pressed !== undefined;
  // WCAG 2.5.3 : le nom accessible commence par le texte visible.
  const nom = libelle.startsWith(libelleCourt) ? libelle : `${libelleCourt} (${libelle})`;
  const enLecture = pressed === null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'cible-tactile',
        pressed === true && 'border-primary bg-accent text-accent-foreground'
      )}
      aria-label={nom}
      title={enLecture && chargementLabel ? `${nom} (${chargementLabel})` : nom}
      aria-pressed={bascule ? pressed === true : undefined}
      aria-busy={enLecture || undefined}
      aria-describedby={desactive ? aideId : undefined}
      disabled={enLecture || desactive}
      onClick={onClick}
    >
      <Icone className={cn(pressed === true && 'fill-current')} aria-hidden="true" />
      <span className="hidden sm:inline">{libelleCourt}</span>
    </Button>
  );
}
