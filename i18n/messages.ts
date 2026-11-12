import type { Locale } from './config'

export async function loadMessages(locale: Locale) {
  const [chat, artefacts, suivi, admin, common, mobilePivots] = await Promise.all([
    import(`../messages/${locale}/medicAssist.json`),
    import(`../messages/${locale}/medicAssistArtefacts.json`),
    import(`../messages/${locale}/medicAssistSuivi.json`),
    import(`../messages/${locale}/medicAssistAdmin.json`),
    import(`../messages/${locale}/common.json`),
    import(`../messages/${locale}/mobilePivots.json`),
  ])
  return {
    medicAssist: chat.default,
    medicAssistArtefacts: artefacts.default,
    medicAssistSuivi: suivi.default,
    medicAssistAdmin: admin.default,
    common: common.default,
    mobilePivots: mobilePivots.default,
  }
}
