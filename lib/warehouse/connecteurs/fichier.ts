import { extraireCsv } from '@/lib/medic-assist/pieces-jointes/extraction/csv'
import { extraireExcel } from '@/lib/medic-assist/pieces-jointes/extraction/excel'
import { correspondRecherche, publierLignes, type Connecteur, type TableSource } from './contrat'

export type ConfigurationFichier = { nom: string; contenu: Uint8Array }
export const MAX_FICHIER = 5 * 1024 * 1024

async function feuilles(config: ConfigurationFichier) {
  const nom = config.nom.trim()
  if (nom.length === 0 || nom.length > 180 || !config.contenu.length || config.contenu.length > MAX_FICHIER) {
    throw new Error('Choisissez un fichier de 5 Mio maximum.')
  }
  const options = { preserverTexte: true }
  if (/\.xlsx$/i.test(nom)) return (await extraireExcel(config.contenu, options)).feuilles
  if (!/\.csv$/i.test(nom)) throw new Error('Choisissez un fichier CSV ou Excel .xlsx.')
  const [feuille] = extraireCsv(config.contenu, nom, options).feuilles
  return [{ ...feuille, nom: 'donnees' }]
}

async function feuille(config: ConfigurationFichier, table: TableSource) {
  const resultat = (await feuilles(config)).find(c => table.schema === 'fichier' && c.nom === table.table)
  if (!resultat || resultat.tronque) throw new Error('Feuille indisponible ou au-delà de 5 000 lignes.')
  return resultat
}

export async function testerFichier(config: ConfigurationFichier) {
  if (!(await feuilles(config)).some(f => f.colonnes.length && !f.tronque)) throw new Error('Le fichier doit contenir au moins une feuille importable.')
}

export const fichier: Connecteur<ConfigurationFichier> = {
  async tables(config, recherche) {
    const tables = (await feuilles(config)).filter(f => f.colonnes.length && !f.tronque)
      .map(f => ({ schema: 'fichier', table: f.nom })).filter(t => correspondRecherche(t, recherche))
    return { tables, tronque: false }
  },
  async colonnes(config, table) {
    return (await feuille(config, table)).colonnes.map(({ cle, type, libelle }) => ({ nom: cle, type, typePostgres: libelle + ' · ' + type }))
  },
  async lire(config, jeu) {
    const donnees = await feuille(config, jeu)
    if (jeu.colonnes.some(c => !donnees.colonnes.some(d => d.cle === (c.origine ?? c.nom)))) throw new Error('Colonne du fichier indisponible.')
    return publierLignes(jeu, donnees.lignes)
  },
}
