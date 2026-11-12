'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toIntlTag } from '@/i18n/config';
import { cn } from '@/lib/utils';

export interface ColonneTableau<L> {
  id: string;
  entete: string;
  /** Chiffres : alignes a la fin, en chiffres tabulaires. */
  numerique?: boolean;
  /** Valeur de tri (nombre ou texte). */
  valeur: (ligne: L) => string | number;
  /** Rendu de la cellule ; par defaut la valeur. */
  rendu?: (ligne: L) => ReactNode;
}

export interface TriTableau {
  id: string;
  desc: boolean;
}

/**
 * Petit tableau dense a tri par clic sur l'en-tete (bouton, aria-sort).
 * Les egalites se departagent par le premier texte de la ligne (ordre de la langue).
 */
export function TableauTrie<L>({
  libelle,
  colonnes,
  lignes,
  cleLigne,
  triInitial,
}: {
  libelle: string;
  colonnes: ColonneTableau<L>[];
  lignes: L[];
  cleLigne: (ligne: L) => string;
  triInitial: TriTableau;
}) {
  const t = useTranslations('medicAssistAdmin.usages.tableaux');
  const intlTag = toIntlTag(useLocale());
  const [tri, setTri] = useState<TriTableau>(triInitial);

  const lignesTriees = useMemo(() => {
    const colonne = colonnes.find(c => c.id === tri.id) ?? colonnes[0];
    const collateur = new Intl.Collator(intlTag, { numeric: true, sensitivity: 'base' });
    const premiereTexte = colonnes.find(c => !c.numerique);
    const copie = [...lignes];
    copie.sort((a, b) => {
      const va = colonne.valeur(a);
      const vb = colonne.valeur(b);
      let ordre =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : collateur.compare(String(va), String(vb));
      if (tri.desc) ordre = -ordre;
      if (ordre !== 0) return ordre;
      return premiereTexte
        ? collateur.compare(String(premiereTexte.valeur(a)), String(premiereTexte.valeur(b)))
        : 0;
    });
    return copie;
  }, [colonnes, lignes, tri, intlTag]);

  function basculer(id: string, numerique: boolean | undefined) {
    setTri(courant =>
      courant.id === id
        ? { id, desc: !courant.desc }
        : // Premier clic : les chiffres du plus grand au plus petit, les textes de A a Z.
          { id, desc: Boolean(numerique) }
    );
  }

  return (
    <Table libelle={libelle} indicationDefilement premiereColonneCollante>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {colonnes.map(colonne => {
            const actif = tri.id === colonne.id;
            const Icone = !actif ? ArrowUpDown : tri.desc ? ArrowDown : ArrowUp;
            return (
              <TableHead
                key={colonne.id}
                scope="col"
                aria-sort={actif ? (tri.desc ? 'descending' : 'ascending') : 'none'}
                className={cn(colonne.numerique && 'text-end')}
              >
                <button
                  type="button"
                  onClick={() => basculer(colonne.id, colonne.numerique)}
                  aria-label={t('triPar', { colonne: colonne.entete })}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    colonne.numerique && 'flex-row-reverse'
                  )}
                >
                  <span>{colonne.entete}</span>
                  <Icone
                    className={cn('h-3.5 w-3.5 shrink-0', !actif && 'opacity-50')}
                    aria-hidden="true"
                  />
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lignesTriees.map(ligne => (
          <TableRow key={cleLigne(ligne)}>
            {colonnes.map(colonne => (
              <TableCell
                key={colonne.id}
                className={cn(
                  colonne.numerique && 'text-end tabular-nums',
                  !colonne.numerique && 'font-medium'
                )}
              >
                {colonne.rendu ? colonne.rendu(ligne) : colonne.valeur(ligne)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
