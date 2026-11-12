import { jsonPrive, limiterIntegration } from '@/lib/integration/http'
import { exigerLectureApi } from '@/lib/integration/cles-api'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const acces = await exigerLectureApi(request)
  if (!acces.ok) return acces.reponse
  const limite = limiterIntegration(acces.contexte.userId)
  if (limite) return limite
  const { locale } = acces.contexte
  const registre = await registreAutorise(acces.contexte)
  return jsonPrive({ jeux: registre.map(({ jeu }) => ({
    cle: jeu.cle, titre: jeu.libelle[locale], description: jeu.description, granularite: jeu.granularite,
    version: jeu.versionMetier,
    dimensions: jeu.dimensions.map(d => ({ cle: d.cle, libelle: d.libelle[locale], type: d.type })),
    mesures: jeu.mesures.map(m => ({ cle: m.cle, libelle: m.libelle[locale], definition: m.definition,
      type: m.type, unite: m.unite, devise: m.devise })),
    filtres: jeu.filtres.filter(f => f.type === 'texte').map(f => f.cle),
  })) })
}
