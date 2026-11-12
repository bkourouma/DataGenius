'use client';

/**
 * Dialogue de partage d'une conversation ou d'une analyse (artefact).
 *
 * Le destinataire ne recoit pas une copie des chiffres : il les voit recalcules
 * dans son propre perimetre, ce que le dialogue dit explicitement.
 */

import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import { partager, useAfficherErreur } from './api-client';
import { SelecteurUtilisateurs } from './selecteur-utilisateurs';

/** LIMITES.longueurMaxMessageAction du contrat. */
const LONGUEUR_MAX_MESSAGE = 2_000;

export interface DialoguePartageProps {
  cible: { type: 'conversation' | 'artefact'; id: string };
  titre: string;
  ouvert: boolean;
  onOuvertChange: (ouvert: boolean) => void;
}

export function DialoguePartage({ cible, titre, ouvert, onOuvertChange }: DialoguePartageProps) {
  const t = useTranslations('medicAssistSuivi.dialoguePartage');
  const listeOuverte = useRef(false);

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent
        // Echap referme d'abord la liste de suggestions, puis seulement le dialogue.
        onEscapeKeyDown={e => {
          if (listeOuverte.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('titre', { titre })}</DialogTitle>
          <DialogDescription className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <span>{t('explication')}</span>
          </DialogDescription>
        </DialogHeader>
        {/* Le formulaire vit dans un enfant : fermer le dialogue remet tout a zero. */}
        <FormulairePartage
          cible={cible}
          onFini={() => onOuvertChange(false)}
          onListeOuverteChange={o => {
            listeOuverte.current = o;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormulairePartage({
  cible,
  onFini,
  onListeOuverteChange,
}: {
  cible: DialoguePartageProps['cible'];
  onFini: () => void;
  onListeOuverteChange: (ouverte: boolean) => void;
}) {
  const t = useTranslations('medicAssistSuivi.dialoguePartage');
  const { toast } = useToast();
  const afficherErreur = useAfficherErreur();
  const [destinataires, setDestinataires] = useState<CompteJson[]>([]);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [enCours, setEnCours] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (enCours) return;
    if (destinataires.length === 0) {
      setErreur(t('aucunDestinataire'));
      return;
    }
    setErreur(undefined);
    setEnCours(true);
    try {
      const texte = message.trim();
      const nombre = await partager({
        cible,
        destinataires: destinataires.map(c => c.id),
        ...(texte ? { message: texte } : {}),
      });
      toast({ description: t('succes', { nombre }) });
      onFini();
    } catch (err) {
      afficherErreur(err);
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={envoyer} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5">
        <SelecteurUtilisateurs
          label={t('destinataires')}
          valeur={destinataires}
          onChange={c => {
            setDestinataires(c);
            if (c.length > 0) setErreur(undefined);
          }}
          disabled={enCours}
          erreur={erreur}
          onListeOuverteChange={onListeOuverteChange}
        />
        <div className="space-y-2">
          <Label htmlFor="partage-message">{t('message')}</Label>
          <Textarea
            id="partage-message"
            value={message}
            maxLength={LONGUEUR_MAX_MESSAGE}
            rows={3}
            placeholder={t('messagePlaceholder')}
            disabled={enCours}
            onChange={e => setMessage(e.target.value)}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onFini} disabled={enCours}>
          {t('annuler')}
        </Button>
        <Button type="submit" loading={enCours}>
          {enCours ? t('enCours') : t('partager')}
        </Button>
      </DialogFooter>
    </form>
  );
}
