import type { ContexteExecution, Provenance } from '@/lib/medic-assist/contrats'
import { REGLES, libelleDe } from '../catalogue/communs'
import type { DefinitionJeu, EntreeCatalogue, Libelle } from '../catalogue/types'
import type { RequeteValidee } from '../catalogue/validation'
import { TEXTES_MOTEUR } from './libelles'
import { DIMENSIONS_TEMPORELLES, libellePeriode } from './temps'

/** Filtres de la requete, dans l'ordre du catalogue, avec des noms et des valeurs lisibles. */
export async function filtresLisibles(
  jeu: DefinitionJeu,
  filtres: RequeteValidee['filtres'],
  ctx: ContexteExecution
): Promise<Provenance['filtres']> {
  const actifs = jeu.filtres.filter(f => filtres[f.cle] !== undefined)

  return actifs.map(f => {
    const valeur = filtres[f.cle]
    const libelle = libelleDe(f.libelle, ctx.locale)
    switch (f.type) {
      case 'ids':
        return {
          libelle,
          valeur: (valeur as string[]).join(', '),
        }
      case 'liste':
        return { libelle, valeur: (valeur as string[]).join(', ') }
      case 'texte':
        return { libelle, valeur: `"${String(valeur)}"` }
      case 'booleen':
        return {
          libelle,
          valeur: libelleDe(valeur ? TEXTES_MOTEUR.oui : TEXTES_MOTEUR.non, ctx.locale),
        }
      default:
        return { libelle, valeur: String(valeur) }
    }
  })
}

export async function perimetreLisible(_ctx: ContexteExecution): Promise<Provenance['perimetre']> {
  return { pays: 'tous', libelle: 'Entrepôt Data Genius' }
}

/** Lien interne seulement : chemin absolu du site, sans protocole ni « // ». */
function estLienInterne(href: string): boolean {
  return /^\/(?![/\\])[^\s]*$/.test(href)
}

export interface EntreeProvenance {
  entree: EntreeCatalogue
  normalisee: RequeteValidee
  ctx: ContexteExecution
  /** Vrai si des lignes n'ont pas ete rendues. */
  tronque: boolean
  /** Vrai si des totaux accompagnent le resultat. */
  avecTotaux: boolean
  /** Vrai si la dimension trimestre generique (civile) a ete rendue. */
  trimestreCivil: boolean
}

/** Assemble la provenance complete (sans SQL : le moteur semantique ne l'expose pas). */
export async function construireProvenance(e: EntreeProvenance): Promise<Provenance> {
  const { entree, normalisee, ctx } = e
  const { jeu } = entree
  const locale = ctx.locale

  const regles: string[] = []
  const ajouter = (regle: Libelle) => {
    const texte = libelleDe(regle, locale)
    if (!regles.includes(texte)) regles.push(texte)
  }
  jeu.regles.forEach(ajouter)
  for (const cle of normalisee.mesures)
    jeu.mesures.find(m => m.cle === cle)?.regles?.forEach(ajouter)
  if (!ctx.scope.voitTout) ajouter(REGLES.perimetre)
  if (normalisee.periodeParDefaut && normalisee.periode?.origine === 'dernier_mois_clos') {
    ajouter(REGLES.dernierMoisClos)
  }
  if (e.trimestreCivil) ajouter(TEXTES_MOTEUR.trimestreCivil)
  if (e.tronque && e.avecTotaux) ajouter(TEXTES_MOTEUR.totauxSurEnsemble)

  let lienEcran: Provenance['lienEcran']
  try {
    const lien = jeu.lienEcran?.(normalisee, ctx)
    if (lien && estLienInterne(lien.href)) {
      lienEcran = { href: lien.href, libelle: libelleDe(lien.libelle, locale) }
    }
  } catch {
    // Un lien est un confort : son echec ne doit pas faire echouer le calcul.
    lienEcran = undefined
  }

  const [perimetre, filtres] = await Promise.all([
    perimetreLisible(ctx),
    filtresLisibles(jeu, normalisee.filtres, ctx),
  ])

  return {
    source: 'semantique',
    jeu: jeu.cle,
    libelleSource: libelleDe(jeu.libelle, locale),
    ...(normalisee.periode
      ? {
          periode: {
            debut: normalisee.periode.debut,
            fin: normalisee.periode.fin,
            libelle: libellePeriode(normalisee.periode.debut, normalisee.periode.fin, locale),
          },
        }
      : {}),
    perimetre,
    filtres,
    regles,
    ...(lienEcran ? { lienEcran } : {}),
    calculeA: new Date().toISOString(),
  }
}

/** Vrai si la dimension trimestre rendue est la generique (trimestre civil). */
export function trimestreGeneriqueRendu(dimensions: readonly { expression: string }[]): boolean {
  return dimensions.some(d => d.expression === DIMENSIONS_TEMPORELLES.trimestre.expression)
}
