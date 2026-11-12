/**
 * Envoi d'e-mails (SMTP, nodemailer).
 *
 * Configuration par variables d'environnement — voir .env.example :
 *
 *   SMTP_HOST      hote du serveur (obligatoire : sans lui, rien n'est envoye)
 *   SMTP_PORT      465 pour du TLS implicite, 587 pour STARTTLS (defaut 587)
 *   SMTP_USER      identifiant, si le serveur demande une authentification
 *   SMTP_PASSWORD  mot de passe associe
 *   SMTP_SECURE    "true" force le TLS implicite ; sinon deduit du port
 *   MAIL_FROM      expediteur affiche, ex. MedicPro <no-reply@ilapharm.com>
 *
 * Tant que SMTP_HOST est absent, l'application fonctionne normalement : chaque
 * message est journalise et rien ne part. C'est ce qui permet de developper et
 * de deployer avant d'avoir les identifiants du relais.
 *
 * Aucun envoi ne doit faire echouer l'action metier qui l'a declenche : une
 * inscription reste valide meme si le serveur de messagerie est injoignable.
 * `envoyerMail` attrape donc tout et renvoie un booleen.
 */

import nodemailer, { type Transporter } from "nodemailer"

export interface MessageMail {
  to: string | string[]
  subject: string
  /** Corps HTML. */
  html: string
  /** Repli texte brut, pour les clients qui n'affichent pas le HTML. */
  text: string
  /** Pieces jointes (ex. export Excel d'un artefact de Medic Assist), relayees a nodemailer. */
  attachments?: PieceJointeMail[]
}

export interface PieceJointeMail {
  filename: string
  content: Buffer
  contentType?: string
}

// `undefined` = pas encore construit, `null` = SMTP non configure.
let transporteur: Transporter | null | undefined

function construireTransporteur(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) return null

  const port = Number(process.env.SMTP_PORT) || 587
  // Le port 465 parle TLS des la connexion ; 587 ouvre en clair puis passe en
  // STARTTLS. SMTP_SECURE permet de forcer le choix sur un relais atypique.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465

  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASSWORD

  return nodemailer.createTransport({
    host,
    port,
    secure,
    // Un relais interne accepte souvent les envois sans authentification.
    ...(user ? { auth: { user, pass } } : {}),
  })
}

function obtenirTransporteur(): Transporter | null {
  if (transporteur === undefined) {
    transporteur = construireTransporteur()
    if (!transporteur) {
      console.warn(
        "[mail] SMTP_HOST absent : les e-mails sont journalises mais ne sont pas envoyes."
      )
    }
  }
  return transporteur
}

function expediteur(): string {
  return process.env.MAIL_FROM?.trim() || "MedicPro <no-reply@localhost>"
}

/** Indique si un relais est configure — utile pour les diagnostics. */
export function mailConfigure(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim())
}

/**
 * Envoie un message. Ne leve jamais : renvoie `true` si le relais l'a accepte,
 * `false` s'il n'est pas configure ou si l'envoi a echoue.
 */
export async function envoyerMail(message: MessageMail): Promise<boolean> {
  const destinataires = Array.isArray(message.to) ? message.to : [message.to]
  if (destinataires.length === 0) return false

  const relais = obtenirTransporteur()

  if (!relais) {
    console.info(
      `[mail] (non configure) destinataire=${destinataires.join(", ")} sujet=${message.subject}`
    )
    return false
  }

  try {
    await relais.sendMail({
      from: expediteur(),
      to: destinataires.join(", "),
      subject: message.subject,
      text: message.text,
      html: message.html,
      // Absent : on n'envoie pas la cle, le message reste identique a l'existant.
      ...(message.attachments && message.attachments.length > 0
        ? { attachments: message.attachments }
        : {}),
    })
    return true
  } catch (error) {
    // Journalise sans interrompre : l'appelant a deja accompli son action.
    console.error(
      `[mail] Echec de l'envoi a ${destinataires.join(", ")} (${message.subject}) :`,
      error
    )
    return false
  }
}
