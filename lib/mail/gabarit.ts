/**
 * Mise en page commune des e-mails de Data Genius : un bandeau titre, un corps, un
 * bouton optionnel et une ligne de pied. Les styles sont en ligne, seuls compris
 * par l'ensemble des messageries.
 */

/** Racine publique de l'application, pour les liens des e-mails. */
export function urlApplication(): string {
  return (
    process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ||
    process.env.APP_URL?.replace(/\/+$/, "") ||
    "http://localhost:3100"
  )
}

/** Echappe le texte insere dans le HTML : un nom peut contenir < ou &. */
export function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export interface OptionsGabarit {
  titre: string
  /** Paragraphes, deja echappes : ils peuvent porter du HTML. */
  corps: string[]
  lien?: { url: string; libelle: string }
  /** Langue du message (attribut `lang`), le francais par defaut. */
  langue?: string
  /** `rtl` pour l'arabe. */
  direction?: "ltr" | "rtl"
  pied?: string
}

export function gabarit(options: OptionsGabarit): string {
  const langue = options.langue ?? "fr"
  const direction = options.direction ?? "ltr"
  const pied = options.pied ?? "Message automatique — merci de ne pas y répondre."

  const paragraphes = options.corps
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${p}</p>`)
    .join("")

  const bouton = options.lien
    ? `<p style="margin:24px 0 0"><a href="${echapper(options.lien.url)}" style="display:inline-block;background:#0d4ea8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">${options.lien.libelle}</a></p>`
    : ""

  return `<!doctype html>
<html lang="${langue}" dir="${direction}"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" dir="${direction}" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
    <tr><td style="padding:28px 32px">
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1f8f3c;font-weight:700">Data Genius</p>
      <h1 style="margin:0 0 20px;font-size:21px;line-height:1.3;color:#0f172a">${options.titre}</h1>
      ${paragraphes}
      ${bouton}
    </td></tr>
  </table>
  <p dir="${direction}" style="max-width:560px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center">${pied}</p>
</body></html>`
}
