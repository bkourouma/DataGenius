/**
 * Messages envoyes autour d'une demande d'inscription.
 *
 * Trois moments :
 *   1. demande deposee  -> accuse de reception au demandeur
 *   2. demande deposee  -> alerte a chaque SuperAdmin actif
 *   3. decision prise   -> reponse au demandeur (validee ou refusee)
 *
 * Les textes sont en francais, langue par defaut de l'application. Le demandeur
 * n'a pas encore de langue enregistree (`User.locale` se remplit a la premiere
 * connexion) ; les alertes aux SuperAdmin pourraient en revanche suivre la leur,
 * comme le fait l'annonce de la revue du mois.
 */

import { echapper, gabarit, urlApplication } from "@/lib/mail/gabarit"
import { envoyerMail } from "@/lib/mail/transport"

interface Demandeur {
  firstName: string
  lastName: string
  email: string
}

/** 1. Accuse de reception au demandeur. */
export async function envoyerAccuseInscription(demandeur: Demandeur): Promise<boolean> {
  const prenom = echapper(demandeur.firstName)

  return envoyerMail({
    to: demandeur.email,
    subject: "Votre demande de compte Data Genius a bien été reçue",
    text: [
      `Bonjour ${demandeur.firstName},`,
      "",
      "Nous avons bien reçu votre demande de compte sur Data Genius.",
      "Un administrateur doit la valider avant votre première connexion : vous recevrez un e-mail dès que ce sera fait.",
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join("\n"),
    html: gabarit({
      titre: "Demande bien reçue",
      corps: [
        `Bonjour ${prenom},`,
        "Nous avons bien reçu votre demande de compte sur Data Genius.",
        "Un administrateur doit la valider avant votre première connexion. Vous recevrez un e-mail dès que ce sera fait.",
        "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.",
      ],
    }),
  })
}

/**
 * 2. Alerte aux SuperAdmins.
 *
 * Un seul envoi pour tous : ils se voient mutuellement dans l'en-tete `To`, ce
 * qui convient entre collegues de la meme organisation. A passer en copie
 * cachee le jour ou des destinataires externes seraient ajoutes.
 */
export async function alerterAdministrateurs(
  destinataires: string[],
  demandeur: Demandeur,
  rattachement: string
): Promise<boolean> {
  if (destinataires.length === 0) return false

  const nom = `${demandeur.firstName} ${demandeur.lastName}`
  const lien = `${urlApplication()}/dashboard/admin/users/inscriptions`

  return envoyerMail({
    to: destinataires,
    subject: `Nouvelle demande d'inscription — ${nom}`,
    text: [
      "Une nouvelle demande de compte attend une validation.",
      "",
      `Nom          : ${nom}`,
      `E-mail       : ${demandeur.email}`,
      `Rattachement : ${rattachement}`,
      "",
      `Examiner la demande : ${lien}`,
    ].join("\n"),
    html: gabarit({
      titre: "Nouvelle demande d'inscription",
      corps: [
        "Une demande de compte attend une validation.",
        `<strong>${echapper(nom)}</strong><br>${echapper(demandeur.email)}<br>Rattachement : ${echapper(rattachement)}`,
      ],
      lien: { url: lien, libelle: "Examiner la demande" },
    }),
  })
}

/** 3. Reponse au demandeur apres la decision de l'administrateur. */
export async function envoyerDecisionInscription(
  demandeur: Demandeur,
  decision: "valider" | "refuser"
): Promise<boolean> {
  const prenom = echapper(demandeur.firstName)
  const lien = `${urlApplication()}/login`

  if (decision === "refuser") {
    return envoyerMail({
      to: demandeur.email,
      subject: "Votre demande de compte Data Genius n'a pas été retenue",
      text: [
        `Bonjour ${demandeur.firstName},`,
        "",
        "Votre demande de compte sur Data Genius n'a pas été retenue.",
        "Si vous pensez qu'il s'agit d'une erreur, rapprochez-vous de votre correspondant Data Genius.",
      ].join("\n"),
      html: gabarit({
        titre: "Demande non retenue",
        corps: [
          `Bonjour ${prenom},`,
          "Votre demande de compte sur Data Genius n'a pas été retenue.",
          "Si vous pensez qu'il s'agit d'une erreur, rapprochez-vous de votre correspondant Data Genius.",
        ],
      }),
    })
  }

  return envoyerMail({
    to: demandeur.email,
    subject: "Votre compte Data Genius est actif",
    text: [
      `Bonjour ${demandeur.firstName},`,
      "",
      "Votre compte Data Genius vient d'être validé : vous pouvez maintenant vous connecter",
      "avec l'adresse e-mail et le mot de passe choisis à l'inscription.",
      "",
      `Se connecter : ${lien}`,
    ].join("\n"),
    html: gabarit({
      titre: "Votre compte est actif",
      corps: [
        `Bonjour ${prenom},`,
        "Votre compte Data Genius vient d'être validé. Vous pouvez vous connecter avec l'adresse e-mail et le mot de passe choisis à l'inscription.",
      ],
      lien: { url: lien, libelle: "Se connecter" },
    }),
  })
}
