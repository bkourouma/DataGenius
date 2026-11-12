'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/** Etat affiche aux comptes qui n'ont pas le droit d'administrer Medic Assist. */
export function AccesReserve() {
  const t = useTranslations('medicAssistAdmin.acces');

  return (
    <div className="py-6">
      <div
        role="alert"
        className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <ShieldAlert className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">{t('titre')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard" prefetch={false}>
            {t('retour')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
