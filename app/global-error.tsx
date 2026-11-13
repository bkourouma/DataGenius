'use client'

import { useEffect, useState } from 'react'
import { defaultLocale, getDirection, isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/config'

interface Textes {
  titre: string
  description: string
  reessayer: string
  accueil: string
  reference: string
}

// Copie des clés common.erreur de messages/<langue>/common.json : ce composant remplace le layout racine, donc sans next-intl.
const TEXTES: Record<Locale, Textes> = {
  fr: {
    titre: "Une erreur est survenue",
    description: "Nous n'avons pas pu afficher cette page. Vous pouvez réessayer ou revenir à l'accueil.",
    reessayer: "Réessayer",
    accueil: "Retour à l'accueil",
    reference: "Référence de l'erreur",
  },
  en: {
    titre: "Something went wrong",
    description: "We could not display this page. You can try again or go back to the home page.",
    reessayer: "Try again",
    accueil: "Back to home",
    reference: "Error reference",
  },
  es: {
    titre: "Se ha producido un error",
    description: "No hemos podido mostrar esta página. Puede volver a intentarlo o regresar al inicio.",
    reessayer: "Reintentar",
    accueil: "Volver al inicio",
    reference: "Referencia del error",
  },
  ar: {
    titre: "حدث خطأ",
    description: "تعذّر علينا عرض هذه الصفحة. يمكنك إعادة المحاولة أو العودة إلى الصفحة الرئيسية.",
    reessayer: "إعادة المحاولة",
    accueil: "العودة إلى الصفحة الرئيسية",
    reference: "مرجع الخطأ",
  },
  hi: {
    titre: "कुछ गड़बड़ हो गई",
    description: "हम यह पृष्ठ नहीं दिखा सके। आप दोबारा कोशिश कर सकते हैं या मुख्य पृष्ठ पर लौट सकते हैं।",
    reessayer: "फिर से कोशिश करें",
    accueil: "मुख्य पृष्ठ पर लौटें",
    reference: "त्रुटि संदर्भ",
  },
  zh: {
    titre: "出错了",
    description: "我们无法显示此页面。您可以重试，或返回首页。",
    reessayer: "重试",
    accueil: "返回首页",
    reference: "错误编号",
  },
}

const STYLES = `
.ge{--fond:#fff;--texte:#0f172a;--doux:#475569;--bord:#e2e5ea;--accent:#0f172a;--sur-accent:#fff}
@media (prefers-color-scheme: dark){.ge{--fond:#0b1020;--texte:#f1f5f9;--doux:#94a3b8;--bord:#27304a;--accent:#f1f5f9;--sur-accent:#0b1020}}
.ge{min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--fond);color:var(--texte);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ge-carte{width:100%;max-width:28rem;border:1px solid var(--bord);border-radius:8px;padding:24px}
.ge h1{margin:0;font-size:1.125rem;font-weight:600}
.ge p{margin:8px 0 0;font-size:.875rem;line-height:1.5;color:var(--doux)}
.ge-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.ge-actions button,.ge-actions a{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:6px;font-size:.875rem;font-weight:600;cursor:pointer;text-decoration:none;box-sizing:border-box}
.ge-actions button{border:1px solid var(--accent);background:var(--accent);color:var(--sur-accent)}
.ge-actions a{border:1px solid var(--bord);background:transparent;color:var(--texte)}
.ge-actions :focus-visible{outline:2px solid var(--texte);outline-offset:2px}
`

function detecterLangue(): Locale {
  const cookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith(LOCALE_COOKIE + '='))
    ?.slice(LOCALE_COOKIE.length + 1)
  if (isLocale(cookie)) return cookie
  const navigateur = (navigator.language || '').toLowerCase().split('-')[0]
  return isLocale(navigateur) ? navigateur : defaultLocale
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Rendu initial dans la langue par défaut (celle du serveur), puis bascule après l'hydratation : pas d'écart.
  const [langue, setLangue] = useState<Locale>(defaultLocale)

  useEffect(() => {
    setLangue(detecterLangue())
  }, [])

  const t = TEXTES[langue]

  return (
    <html lang={langue} dir={getDirection(langue)}>
      <body style={{ margin: 0 }}>
        <style>{STYLES}</style>
        <main className="ge">
          <div className="ge-carte" role="alert">
            <h1>{t.titre}</h1>
            <p>{t.description}</p>
            {error.digest && (
              <p>
                {t.reference} : <code dir="ltr">{error.digest}</code>
              </p>
            )}
            <div className="ge-actions">
              <button type="button" onClick={() => reset()}>
                {t.reessayer}
              </button>
              {/* Lien natif : le routeur Next peut être indisponible dans cet état. */}
              <a href="/">{t.accueil}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
