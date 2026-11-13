/**
 * Message d'identifiants : adresse de connexion, mot de passe temporaire et lien
 * de l'application. Texte en francais, comme les autres messages systeme.
 */

import { echapper, gabarit } from "@/lib/mail/gabarit"
import { envoyerMail } from "@/lib/mail/transport"

interface Destinataire {
  firstName: string
  email: string
}

export async function envoyerIdentifiants(
  destinataire: Destinataire,
  motDePasse: string,
  lienApplication: string
): Promise<boolean> {
  const prenom = echapper(destinataire.firstName)

  return envoyerMail({
    to: destinataire.email,
    subject: "Vos identifiants de connexion Data Genius",
    text: [
      `Bonjour ${destinataire.firstName},`,
      "",
      "Voici vos identifiants pour vous connecter à Data Genius :",
      "",
      `Identifiant (e-mail) : ${destinataire.email}`,
      `Mot de passe         : ${motDePasse}`,
      "",
      `Application : ${lienApplication}`,
      "",
      "Ce mot de passe est temporaire : il vous sera demandé d'en choisir un nouveau à votre première connexion.",
    ].join("\n"),
    html: gabarit({
      titre: "Vos identifiants de connexion",
      corps: [
        `Bonjour ${prenom},`,
        "Voici vos identifiants pour vous connecter à Data Genius :",
        `Identifiant (e-mail) : <strong>${echapper(destinataire.email)}</strong><br>Mot de passe : <strong style="font-family:Consolas,Menlo,monospace;font-size:16px">${echapper(motDePasse)}</strong>`,
        "Ce mot de passe est temporaire : il vous sera demandé d'en choisir un nouveau à votre première connexion.",
      ],
      lien: { url: lienApplication, libelle: "Ouvrir Data Genius" },
    }),
  })
}
