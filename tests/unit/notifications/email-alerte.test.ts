import { describe, expect, it } from 'vitest'
import { locales } from '@/i18n/config'
import { composerEmailAlerte, composerNotificationAlerte } from '@/lib/notifications/email-alerte'

const base = {
  tableau: 'Suivi du pilote', mesure: 'Chiffre d’affaires', unite: '€', valeur: 1234567.891, seuil: '1000',
  sens: 'au_dessus' as const, destinataireNom: 'Awa Traoré', url: 'https://app.example.test/tableaux/abc',
}

describe('e-mail d’alerte', () => {
  it('compose le message dans chacune des 6 langues', async () => {
    const messages = await Promise.all(locales.map(locale => composerEmailAlerte({ ...base, locale })))
    expect(new Set(messages.map(m => m.sujet)).size).toBe(6)
    locales.forEach((locale, i) => {
      expect(messages[i].html).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`)
      expect(messages[i].sujet).toContain('Suivi du pilote')
      expect(messages[i].texte).toContain(base.url)
      expect(messages[i].texte).toContain('Awa Traoré')
    })
    expect(messages[locales.indexOf('ar')].html).toContain('dir="rtl"')
    expect(messages[locales.indexOf('fr')].html).toContain('dir="ltr"')
  })

  it('échappe le HTML d’un titre de tableau, du libellé et du nom', async () => {
    const message = await composerEmailAlerte({ ...base, locale: 'fr', tableau: '<script>alert(1)</script> & Cie', mesure: '<b>x</b>', destinataireNom: '<i>Awa</i>' })
    expect(message.html).not.toContain('<script>')
    expect(message.html).not.toContain('<b>x</b>')
    expect(message.html).not.toContain('<i>Awa</i>')
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cie')
    expect(message.sujet).toContain('<script>')
  })

  it('formate la valeur selon la langue, 2 décimales au plus, suivie de l’unité', async () => {
    const fr = await composerNotificationAlerte({ ...base, locale: 'fr' })
    const en = await composerNotificationAlerte({ ...base, locale: 'en' })
    const norm = (t: string) => t.replace(/[  ]/g, ' ')
    expect(norm(fr.message)).toContain('1 234 567,89 €')
    expect(en.message).toContain('1,234,567.89 €')
    expect(fr.titre).toContain('Chiffre d’affaires')
    expect(fr.message).toContain('Suivi du pilote')
  })

  it('distingue le sens du seuil et se replie sur le français pour une langue inconnue', async () => {
    const haut = await composerNotificationAlerte({ ...base, locale: 'fr' })
    const bas = await composerNotificationAlerte({ ...base, locale: 'fr', sens: 'au_dessous' })
    expect(haut.message).not.toBe(bas.message)
    expect(await composerNotificationAlerte({ ...base, locale: 'xx' })).toEqual(haut)
  })

  it('affiche la valeur sans unité quand il n’y en a pas', async () => {
    const message = await composerNotificationAlerte({ ...base, locale: 'en', unite: null, valeur: '42' })
    expect(message.message).toContain('is 42.')
  })
})
