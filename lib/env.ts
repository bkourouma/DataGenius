import { z } from 'zod'
import { journal } from '@/lib/journal'

export class ErreurEnvironnement extends Error {
  readonly variables: string[]

  constructor(variables: string[], details: string[]) {
    super(`Configuration invalide :\n- ${details.join('\n- ')}`)
    this.name = 'ErreurEnvironnement'
    this.variables = variables
  }
}

// Une chaîne vide équivaut à une variable absente.
const vide = (valeur: unknown) =>
  typeof valeur === 'string' && valeur.trim() === '' ? undefined : valeur
const facultative = <T extends z.ZodType>(schema: T) => z.preprocess(vide, schema.optional())

const texteNonVide = z.string().min(1, 'vide')

function urlAvec(protocoles: string[], attendu: string) {
  return z.string().refine((v) => {
    try {
      return protocoles.includes(new URL(v).protocol)
    } catch {
      return false
    }
  }, `URL ${attendu} invalide`)
}

const secretMin = (min: number) => z.string().min(min, `trop court (${min} caractères minimum)`)

const schemaBase = {
  DATABASE_URL: urlAvec(['postgres:', 'postgresql:'], 'postgres'),
  DATAGENIUS_SOURCE_KEY: facultative(
    z.string().regex(/^[0-9a-fA-F]{64}$/, 'format invalide (64 caractères hexadécimaux attendus)')
  ),
  DATAGENIUS_WAREHOUSE_READ_URL: facultative(
    z.string().refine((v) => {
      try {
        new URL(v)
        return true
      } catch {
        return false
      }
    }, 'URL invalide')
  ),
  SMTP_HOST: facultative(texteNonVide),
  SMTP_PORT: facultative(
    z
      .string()
      .regex(/^\d+$/, 'entier attendu')
      .refine((v) => Number(v) >= 1 && Number(v) <= 65535, 'hors plage (1 à 65535)')
  ),
  SMTP_USER: facultative(texteNonVide),
  SMTP_PASSWORD: facultative(texteNonVide),
  MAIL_FROM: facultative(texteNonVide),
  JETON_TACHES_PLANIFIEES: facultative(secretMin(32)),
  ANTHROPIC_API_KEY: facultative(texteNonVide),
  OPENAI_API_KEY: facultative(texteNonVide),
  GOOGLE_GENERATIVE_AI_API_KEY: facultative(texteNonVide),
  DEEPSEEK_API_KEY: facultative(texteNonVide),
  DATAGENIUS_SOURCES_HOTES_AUTORISES: facultative(z.string()),
  // Nombre de sauts de proxy de confiance devant l'application (0 : en-têtes d'IP ignorés).
  DATAGENIUS_PROXY_DE_CONFIANCE: facultative(
    z
      .string()
      .regex(/^\d+$/, 'entier attendu')
      .refine((v) => Number(v) <= 10, 'hors plage (0 à 10)')
  ),
  DATAGENIUS_OIDC_ISSUER: facultative(texteNonVide),
  DATAGENIUS_OIDC_CLIENT_ID: facultative(texteNonVide),
  DATAGENIUS_OIDC_CLIENT_SECRET: facultative(texteNonVide),
  DATAGENIUS_EMBED_ORIGINS: facultative(z.string()),
  DATAGENIUS_REST_ORIGINES_PRIVEES: facultative(z.string()),
  DATAGENIUS_CATALOGUE: facultative(texteNonVide),
  SMTP_SECURE: facultative(z.enum(['true', 'false'], { message: '« true » ou « false » attendu' })),
  APP_URL: facultative(urlAvec(['http:', 'https:'], 'http ou https')),
  UPLOAD_DIR: facultative(texteNonVide),
  MEDIC_ASSIST_POLICES_PDF: facultative(texteNonVide),
  NEXT_PUBLIC_TIMEZONE: facultative(
    z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('fr', { timeZone: v })
        return true
      } catch {
        return false
      }
    }, 'fuseau IANA invalide')
  ),
}

const schemaWeb = z.object({
  ...schemaBase,
  NEXTAUTH_SECRET: secretMin(32),
  NEXTAUTH_URL: urlAvec(['http:', 'https:'], 'http ou https'),
})

const schemaWorker = z.object({
  ...schemaBase,
  NEXTAUTH_SECRET: facultative(secretMin(32)),
  NEXTAUTH_URL: facultative(urlAvec(['http:', 'https:'], 'http ou https')),
})

export type EnvironnementValide = z.infer<typeof schemaWeb>
export type ContexteEnvironnement = 'web' | 'worker'

export function verifierEnvironnement(
  contexte: ContexteEnvironnement,
  env: Record<string, string | undefined> = process.env
): EnvironnementValide {
  const resultat = (contexte === 'web' ? schemaWeb : schemaWorker).safeParse(env)

  if (!resultat.success) {
    // Seul le message de règle est repris, jamais la valeur reçue.
    const details = new Map<string, string>()
    for (const probleme of resultat.error.issues) {
      const nom = String(probleme.path[0] ?? 'environnement')
      if (details.has(nom)) continue
      const valeur = env[nom]
      details.set(
        nom,
        valeur === undefined || valeur.trim() === '' ? 'manquante' : probleme.message
      )
    }
    throw new ErreurEnvironnement(
      [...details.keys()],
      [...details].map(([nom, motif]) => `${nom} : ${motif}`)
    )
  }

  const valeurs = resultat.data as EnvironnementValide
  avertirFacultatives(contexte, valeurs)
  return valeurs
}

function avertirFacultatives(contexte: ContexteEnvironnement, v: EnvironnementValide) {
  if (!v.SMTP_HOST) journal.avertissement('SMTP absent : les e-mails ne partiront pas')
  if (!v.DATAGENIUS_SOURCE_KEY) {
    journal.avertissement(
      'DATAGENIUS_SOURCE_KEY absente : les connexions ajoutées dans l’interface sont impossibles'
    )
  }
  if (!v.DATAGENIUS_WAREHOUSE_READ_URL) {
    journal.avertissement('DATAGENIUS_WAREHOUSE_READ_URL absente : lecture de l’entrepôt non isolée')
  }
  if (contexte === 'web' && !v.DATAGENIUS_PROXY_DE_CONFIANCE) {
    journal.avertissement(
      'DATAGENIUS_PROXY_DE_CONFIANCE absente : seule la limite de connexion par e-mail s’applique'
    )
  }
  if (!v.JETON_TACHES_PLANIFIEES) {
    journal.avertissement('JETON_TACHES_PLANIFIEES absent : tâches planifiées désactivées')
  }
  const cleIa = [
    v.ANTHROPIC_API_KEY,
    v.OPENAI_API_KEY,
    v.GOOGLE_GENERATIVE_AI_API_KEY,
    v.DEEPSEEK_API_KEY,
  ].some(Boolean)
  if (!cleIa && contexte === 'web') journal.avertissement('Aucune clé IA : assistant indisponible')
}
