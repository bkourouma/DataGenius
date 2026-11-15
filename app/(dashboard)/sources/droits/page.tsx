import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { Boxes } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { toIntlTag } from '@/i18n/config'
import { configurationDroits } from '@/lib/warehouse/droits-admin'
import { NouveauGroupe, TableauGroupes, TableauJeux } from './formulaires'

export const dynamic = 'force-dynamic'

const vide = 'text-sm text-muted-foreground'

/** Action d'audit enregistrée par lib (texte français stocké) -> clé `sources.droits.journal.actions.<clé>`. */
const CLES_ACTION_AUDIT: Record<string, string> = {
  'Groupe créé': 'groupeCree',
  'Groupe renommé': 'groupeRenomme',
  'Membres modifiés': 'membresModifies',
  'Accès ouvert': 'accesOuvert',
  'Accès restreint': 'accesRestreint',
  'Espace créé': 'espaceCree',
  'Espace modifié': 'espaceModifie',
}

export default async function DroitsSourcesPage() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const [t, locale] = await Promise.all([getTranslations('sources.droits.page'), getLocale()])
  const { groupes, membres, regles, jeux, audit } = await configurationDroits()
  const noms = new Map<string, string>([
    ...groupes.map(g => [g.id, g.nom] as const), ...jeux.map(j => [j.cle, j.titre] as const),
  ])
  const horodatage = new Intl.DateTimeFormat(toIntlTag(locale), { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return <section className="mx-auto max-w-4xl space-y-8">
    <EnTetePage retour={{ href: '/sources', libelle: t('retour') }} titre={t('titre')}
      description={t('description')}
      actions={<><Link href="/sources/droits/espaces" className={buttonVariants({ variant: 'outline' })}><Boxes aria-hidden />{t('gererEspaces')}</Link><NouveauGroupe /></>} />
    <section className="space-y-3" aria-labelledby="groupes-acces">
      <h2 id="groupes-acces" className="text-lg font-semibold">{t('groupesTitre')}</h2>
      <p className={vide}>{t('groupesDescription')}</p>
      {groupes.length === 0 ? <p className={vide}>{t('groupesVide')}</p> : <TableauGroupes groupes={groupes} membres={membres} />}
    </section>
    <section className="space-y-3" aria-labelledby="regles-jeu">
      <h2 id="regles-jeu" className="text-lg font-semibold">{t('reglesTitre')}</h2>
      <p className={vide}>{t('reglesDescription')}</p>
      {jeux.length === 0 ? <p className={vide}>{t('jeuxVide')}</p> : <TableauJeux jeux={jeux} groupes={groupes} regles={regles} />}
    </section>
    <section className="space-y-3" aria-labelledby="journal-acces">
      <h2 id="journal-acces" className="text-lg font-semibold">{t('journalTitre')}</h2>
      {audit.length ? <ul className="divide-y rounded-lg border bg-card">
        {audit.map(e => <li key={e.id} className="flex flex-wrap gap-x-3 p-3 text-sm">
          <time dateTime={e.fait_a.toISOString()} className="text-muted-foreground">{horodatage.format(e.fait_a)} UTC</time>
          <span>{Object.hasOwn(CLES_ACTION_AUDIT, e.action) ? t('actions.' + CLES_ACTION_AUDIT[e.action]) : e.action}</span><span>{noms.get(e.objet) ?? e.objet}</span><span className="text-muted-foreground">{e.acteur}</span>
        </li>)}
      </ul> : <p className={vide}>{t('journalVide')}</p>}
    </section>
  </section>
}
