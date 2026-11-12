import { Prisma } from '@prisma/client'
import { citer, configurationEntrepot, configurationFichier, empreinte, typeSql, type JeuConfigure, type JeuCompose, type JeuEntrepot } from '@/lib/warehouse/configuration'
import { ErreurJointure, lireJointures, compilerJointure, type JointureEnregistree } from '@/lib/warehouse/jointures'
import { analyserSqlDetaille } from '../sql/analyseur'
import type { DefinitionMesure, DefinitionVue, EntreeCatalogue, Libelle, Registre } from './types'

function libelle(texte: string): Libelle {
  return { fr: texte, en: texte, es: texte, zh: texte, ar: texte, hi: texte }
}

function uniques(cles: string[]) {
  return new Set(cles).size === cles.length
}

function construireEntree(j: Pick<JeuConfigure | JeuCompose, 'cle' | 'titre' | 'description' | 'grain' | 'colonnes' | 'dimensions' | 'mesures' | 'instantanePar'>, definition: Pick<DefinitionVue, 'snapshots' | 'cte' | 'signature'>): EntreeCatalogue {
  if (!uniques(j.colonnes.map(c => c.nom)) || !uniques([...j.dimensions, ...j.mesures.map(m => m.cle)])) {
    throw new Error('Clés de colonnes, dimensions ou mesures en double dans ' + j.cle)
  }
  const colonnes = new Map(j.colonnes.map(c => [c.nom, c]))
  const exigerColonne = (nom: string) => {
    const col = colonnes.get(nom)
    if (!col) throw new Error('Colonne absente du jeu ' + j.cle)
    return col
  }
  if (j.mesures.some(m => m.instantane) && (!j.instantanePar || !j.dimensions.includes(j.instantanePar) || exigerColonne(j.instantanePar).type !== 'periode')) {
    throw new Error('Le jeu ' + j.cle + ' exige une dimension mensuelle pour ses instantanés')
  }
  const vue = 'mv_' + j.cle
  const dimensions = j.dimensions.map(cle => {
    const col = exigerColonne(cle)
    return { cle, libelle: libelle(col.description), definition: col.description, type: col.type, expression: citer(cle).sql }
  })
  const mesures: DefinitionMesure[] = j.mesures.map(m => {
    const { type } = exigerColonne(m.colonne)
    const operations = {
      somme: 'SUM', moyenne: 'AVG', min: 'MIN', max: 'MAX', nombre: 'COUNT', nombre_distinct: 'COUNT',
    } as const
    const compte = m.agregat === 'nombre' || m.agregat === 'nombre_distinct'
    if (!compte && (type === 'texte' || type === 'date' || type === 'periode')) {
      throw new Error('La mesure ' + m.cle + ' exige une colonne numérique')
    }
    const expression = operations[m.agregat] + '(' +
      (m.agregat === 'nombre_distinct' ? 'DISTINCT ' : '') + citer(m.colonne).sql + ')'
    return {
      cle: m.cle,
      libelle: libelle(m.definition),
      definition: m.definition,
      type: (compte ? 'entier' : m.agregat === 'moyenne' && type === 'entier' ? 'decimal' : type) as DefinitionMesure['type'],
      agregat: m.agregat,
      expression,
      unite: m.unite,
      instantane: m.instantane,
    }
  })
  return {
    jeu: {
      cle: j.cle, libelle: libelle(j.titre), description: j.description, granularite: j.grain,
      vue, dimensions, mesures, instantanePar: j.instantanePar,
      filtres: dimensions.filter(d => d.type === 'texte' || d.type === 'periode').map(d => ({
        cle: d.cle, libelle: d.libelle, definition: 'Valeur exacte : ' + d.definition,
        type: 'texte',
        condition: valeur => Prisma.sql`${citer(d.cle)} = ${String(valeur)}`,
      })),
      regles: j.instantanePar ? [libelle('Comparer les instantanés par ' + j.instantanePar + '. Les valeurs de périodes différentes ne se somment pas.')] : [],
    },
    vue: {
      nom: vue, jeu: j.cle, description: j.description, colonnes: j.colonnes,
      ...definition,
    },
  }
}

function construireImport({ jeu, source, empreinte }: JeuEntrepot) {
  return construireEntree(jeu, {
    snapshots: [{ jeu: jeu.cle, empreinte, source: source.titre }],
    cte: () => {
      const colonnes = jeu.colonnes.map(c => Prisma.sql`${citer(c.nom)} ${typeSql(c.type)}`)
      return Prisma.sql`SELECT ${Prisma.join(jeu.colonnes.map(c => Prisma.sql`l.${citer(c.nom)}`))}
        FROM warehouse.snapshots AS s
        CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(s.contenu) AS l(${Prisma.join(colonnes)})
        WHERE s.jeu = ${jeu.cle} AND s.empreinte = ${empreinte}`
    },
  })
}

function construireCombinaison(jeu: JeuCompose, imports: EntreeCatalogue[]) {
  const parVue = new Map(imports.map(({ vue }) => [vue.nom, vue]))
  const analyse = analyserSqlDetaille(jeu.sql, [...parVue.keys()])
  if (!analyse.ok || !analyse.vues.length) throw new Error('Combinaison invalide : ' + jeu.cle)
  const vues = analyse.vues.map(nom => parVue.get(nom)!)
  const colonnes = jeu.colonnes.map(c => Prisma.sql`r.${citer(c.nom)}::${typeSql(c.type)} AS ${citer(c.nom)}`)
  return construireEntree(jeu, {
    signature: empreinte(jeu),
    snapshots: vues.flatMap(vue => vue.snapshots ?? []),
    cte: ctx => Prisma.sql`
      WITH ${Prisma.join(vues.map(vue => Prisma.sql`${citer(vue.nom)} AS (${vue.cte(ctx)})`))}
      SELECT ${Prisma.join(colonnes)} FROM (${Prisma.raw(analyse.sqlNormalise)}) AS r
    `,
  })
}

function construireJointure(spec: JointureEnregistree, registre: Registre) {
  const { entrees, snapshots, colonnes, requete } = compilerJointure(spec, registre)
  return construireEntree({
    cle: spec.cle, titre: spec.titre, description: spec.description || spec.titre,
    grain: 'Une ligne par correspondance entre les jeux',
    colonnes,
    dimensions: colonnes.slice(0, 30).map(c => c.nom), mesures: [],
  }, {
    signature: empreinte([spec, empreinteEntrees([entrees.gauche, entrees.droite])]),
    snapshots,
    cte: requete,
  })
}

export async function registrePostgres(
  jointures?: JointureEnregistree[],
  client?: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<Registre> {
  const [{ jeux, combinaisons }, enregistrees] = await Promise.all([
    configurationEntrepot(client), jointures ?? lireJointures(client),
  ])
  const imports = jeux.map(construireImport)
  const registre = [...imports, ...combinaisons.map(j => construireCombinaison(j, imports))]
  for (const spec of enregistrees) {
    if (registre.some(e => e.jeu.cle === spec.cle)) continue
    try {
      registre.push(construireJointure(spec, registre))
    } catch (erreur) {
      // Le catalogue historique peut changer indépendamment des combinaisons enregistrées.
      if (!(erreur instanceof ErreurJointure)) throw erreur
    }
  }
  return registre
}

/** Empreinte utilisée par les analyses créées avant les imports administrés. */
export function empreinteCatalogueHistorique() {
  const { jeux, combinaisons } = configurationFichier()
  if (!jeux.length && !combinaisons.length) return null
  return empreinte([jeux.map(e => [e.jeu.cle, e.empreinte, e.jeu.dimensions, e.jeu.mesures, e.jeu.instantanePar]), combinaisons])
}

export function empreinteEntrees(entrees: EntreeCatalogue[]) {
  const vues = [...entrees].sort((a, b) => a.vue.nom.localeCompare(b.vue.nom))
  return empreinte(vues.map(({ jeu, vue }) => [
    vue.nom, vue.signature,
    vue.snapshots?.map(s => s.empreinte), jeu.dimensions, jeu.mesures, jeu.instantanePar,
  ]))
}

export function empreinteRequete(source: string, requete: unknown, registre: Registre) {
  if (!requete || typeof requete !== 'object') return null
  if (source === 'semantique' && 'jeu' in requete) {
    const entree = registre.find(e => e.jeu.cle === requete.jeu)
    return entree ? empreinteEntrees([entree]) : null
  }
  if (source === 'sql' && 'sql' in requete && typeof requete.sql === 'string') {
    const parVue = new Map(registre.map(e => [e.vue.nom, e]))
    const analyse = analyserSqlDetaille(requete.sql, [...parVue.keys()])
    if (analyse.ok) return empreinteEntrees(analyse.vues.map(nom => parVue.get(nom)!))
  }
  return null
}
