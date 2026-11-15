import { Prisma } from '@prisma/client'
import type { DroitsDonnees, RegleDonnees } from '@/lib/auth/data-access'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import type { EntreeCatalogue, Libelle, Registre } from '@/lib/medic-assist/donnees/catalogue/types'

export const libelle = (fr: string, en = fr): Libelle => ({ fr, en, es: fr, ar: fr, hi: fr, zh: fr })

export const GROUPE = '11111111-1111-4111-8111-111111111111'

/** Jeu `ventes` : une mesure simple, un rapport avec conditions, et une mesure qui dépend de la colonne `mois`. */
export function registreVentes(cle = 'ventes'): Registre {
  const entree = {
    jeu: {
      cle, libelle: libelle('Ventes', 'Sales'), description: 'Ventes', granularite: 'Une ligne par vente', vue: `mv_${cle}`,
      dimensions: [], filtres: [], regles: [],
      mesures: [
        {
          cle: 'ca', libelle: libelle('Chiffre d’affaires', 'Revenue'), definition: 'Montant hors taxe vendu.', type: 'decimal',
          unite: 'EUR', agregat: 'somme', colonnesRequises: ['montant_ht'], expression: Prisma.sql`SUM(montant_ht)`,
        },
        {
          cle: 'taux_marge', libelle: libelle('Taux de marge'), definition: 'Marge sur chiffre d’affaires.', type: 'decimal',
          devise: 'EUR', agregat: 'rapport', colonnesRequises: ['marge', 'montant_ht', 'agence'], expression: Prisma.sql`SUM(1)`,
          regles: [libelle('agence = Lagune', 'agency = Lagune')],
        },
        {
          cle: 'mois_max', libelle: libelle('Dernier mois'), definition: 'Dernier mois observé.', type: 'entier',
          agregat: 'max', colonnesRequises: ['mois'], expression: Prisma.sql`MAX(mois)`,
        },
      ],
    },
    vue: {
      nom: `mv_${cle}`, jeu: cle, description: 'Ventes', cte: () => Prisma.sql`SELECT 1`,
      colonnes: ['montant_ht', 'marge', 'agence', 'mois'].map(nom => ({ nom, type: 'texte', description: nom })),
    },
  } as unknown as EntreeCatalogue
  return [entree]
}

export function droits(options: { administrateur?: boolean; groupes?: string[]; regle?: Partial<RegleDonnees> & { jeu?: string } }): DroitsDonnees {
  const regles = new Map<string, RegleDonnees>()
  if (options.regle) {
    regles.set(options.regle.jeu ?? 'ventes', { groupes: [GROUPE], masquer: [], filtre: null, ...options.regle })
  }
  return {
    revision: '1', depuis: new Date(0), administrateur: options.administrateur ?? false,
    groupes: new Set(options.groupes ?? []), regles, espaces: new Map(),
  }
}

export function contexte(roleName: string, donnees?: DroitsDonnees, locale: ContexteExecution['locale'] = 'fr'): ContexteExecution {
  return {
    userId: 'utilisateur-test', roleName, locale, habilitations: null, maintenant: new Date(),
    scope: { roleName, voitTout: true, donnees },
  }
}
