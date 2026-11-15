'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { chargerTableau, optionsTableau } from '@/lib/warehouse/tableaux'
import type { AlerteTuile, DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'
import { Soumettre } from '../sources/formulaires'
import { enregistrer } from './actions'

type Tuile = DefinitionTableau['tuiles'][number]
type Tableau = Awaited<ReturnType<typeof chargerTableau>>
type ReglagesAlerte = { sens: AlerteTuile['sens']; seuil: string; destinataires?: string[]; email?: boolean; webhook?: string }

/** Reconstruit l'alerte en retirant les réglages vides (le schéma strict refuse `[]`, `false` et `''`). */
function normaliserAlerte(base: ReglagesAlerte): AlerteTuile {
  const { destinataires, email, webhook, ...socle } = base
  return {
    ...socle,
    ...(destinataires?.length ? { destinataires } : {}),
    ...(email ? { email: true } : {}),
    ...(webhook?.trim() ? { webhook: webhook.trim() } : {}),
  }
}

const selection = 'block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

export function FormulaireTableau({ tableau, options, comptes, analyses, estAdmin }: {
  tableau: Tableau
  options: Awaited<ReturnType<typeof optionsTableau>>
  comptes: { id: string; nom: string; email: string }[]
  analyses: { id: string; titre: string }[]
  estAdmin: boolean
}) {
  const t = useTranslations('notifications')
  const tf = useTranslations('tableaux.formulaire')
  const [tuiles, setTuiles] = useState(tableau?.definition.tuiles ?? [])
  const [lecteurs, setLecteurs] = useState(tableau?.definition.lecteurs ?? [])
  const [etat, action] = useFormState(enregistrer.bind(null, tableau ? { id: tableau.id, version: tableau.version } : null), {})

  function modifier(tuile: Tuile) {
    setTuiles(courantes => courantes.map(courante => courante.id === tuile.id ? tuile : courante))
  }

  function ajouter(type: Tuile['type']) {
    const id = crypto.randomUUID()
    const tuile: Tuile = type === 'artefact' ? { id, type, artefact: '' } : { id, type, jeu: '', mesure: '', dimensions: [] }
    setTuiles(courantes => [...courantes, tuile])
  }

  return <form action={action} className="space-y-5">
    <input type="hidden" name="configuration" value={JSON.stringify({ tuiles, lecteurs })} />
    <label className="block space-y-1 text-sm font-medium">{tf('nom')}
      <Input name="titre" required maxLength={120} defaultValue={tableau?.definition.titre} />
    </label>
    <section className="space-y-4" aria-labelledby="tuiles-titre">
      <h2 id="tuiles-titre" className="text-lg font-semibold">{tf('tuiles')}</h2>
      {tuiles.map((tuile, index) => {
        const jeu = tuile.type === 'mesure' ? options.find(o => o.cle === tuile.jeu) : undefined
        return <fieldset key={tuile.id} className="space-y-3 rounded-lg border bg-card p-4">
          <legend className="px-1 font-medium">{tuile.type === 'mesure' ? tf('indicateurNumero', { n: index + 1 }) : tf('artefactNumero', { n: index + 1 })}</legend>
          {tuile.type === 'artefact' ? <>
            {analyses.length > 0 && <label className="block space-y-1 text-sm">{tf('choisirAnalyse')}
              <select className={selection} value={analyses.some(a => a.id === tuile.artefact) ? tuile.artefact : ''}
                onChange={event => modifier({ ...tuile, artefact: event.target.value })}>
                <option value="">{tf('selectionnerAnalyse')}</option>
                {analyses.map(a => <option key={a.id} value={a.id}>{a.titre}</option>)}
              </select>
            </label>}
            <label className="block space-y-1 text-sm">{tf('identifiantAnalyse')}
              <Input required maxLength={300} value={tuile.artefact}
                onChange={event => {
                  const texte = event.target.value.trim()
                  const lien = /\/analyses\/([^/?#]+)\/?(?:[?#].*)?$/.exec(texte)
                  modifier({ ...tuile, artefact: lien?.[1] ?? texte })
                }} />
            </label>
          </> : <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">{tf('jeu')}
                <select required className={selection} value={tuile.jeu}
                  onChange={event => modifier({ ...tuile, jeu: event.target.value, mesure: '', dimensions: [] })}>
                  <option value="">{tf('choisirJeu')}</option>
                  {tuile.jeu && !jeu && <option value={tuile.jeu}>{tf('jeuIndisponible')}</option>}
                  {options.map(o => <option key={o.cle} value={o.cle}>{o.libelle}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm">{tf('mesure')}
                <select required className={selection} value={tuile.mesure}
                  onChange={event => modifier({ ...tuile, mesure: event.target.value })}>
                  <option value="">{tf('choisirMesure')}</option>
                  {tuile.mesure && !jeu?.mesures.some(m => m.cle === tuile.mesure) && <option value={tuile.mesure}>{tf('mesureIndisponible')}</option>}
                  {jeu?.mesures.map(m => <option key={m.cle} value={m.cle}>{m.libelle}</option>)}
                </select>
              </label>
            </div>
            {Boolean(jeu?.dimensions.length) && <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{tf('dimensions')}</legend>
              <div className="flex flex-wrap gap-3">{jeu?.dimensions.map(d => {
                const selectionnee = tuile.dimensions.includes(d.cle)
                return <label key={d.cle} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={selectionnee} disabled={!selectionnee && tuile.dimensions.length >= 3}
                    onChange={event => modifier({ ...tuile, dimensions: event.target.checked ? [...tuile.dimensions, d.cle] : tuile.dimensions.filter(c => c !== d.cle) })} />
                  {d.libelle}
                </label>
              })}</div>
            </fieldset>}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1 text-sm">{tf('objectif')}
                <Input inputMode="decimal" value={tuile.objectif ?? ''} onChange={event => modifier({ ...tuile, objectif: event.target.value.replace(',', '.') || undefined })} />
              </label>
              <label className="block space-y-1 text-sm">{tf('alerte')}
                <select className={selection} value={tuile.alerte?.sens ?? ''} onChange={event => {
                  const sens = event.target.value
                  modifier({ ...tuile, alerte: sens === 'au_dessus' || sens === 'au_dessous' ? normaliserAlerte({ ...tuile.alerte, sens, seuil: tuile.alerte?.seuil ?? '' }) : undefined })
                }}>
                  <option value="">{tf('alerteDesactivee')}</option><option value="au_dessus">{tf('alerteAuDessus')}</option><option value="au_dessous">{tf('alerteAuDessous')}</option>
                </select>
              </label>
              {tuile.alerte && <label className="block space-y-1 text-sm">{tf('seuil')}
                <Input inputMode="decimal" required value={tuile.alerte.seuil} onChange={event => {
                  if (tuile.alerte) modifier({ ...tuile, alerte: normaliserAlerte({ ...tuile.alerte, seuil: event.target.value.replace(',', '.') }) })
                }} />
              </label>}
            </div>
            {tuile.alerte && (() => {
              const alerte = tuile.alerte
              const lecteursCoches = lecteurs.map(id => {
                const compte = comptes.find(c => c.id === id)
                return { id, nom: compte ? compte.nom || compte.email : tf('compteIndisponible') }
              })
              const majAlerte = (reglages: Partial<Pick<AlerteTuile, 'destinataires' | 'email' | 'webhook'>>) =>
                modifier({ ...tuile, alerte: normaliserAlerte({ ...alerte, ...reglages }) })
              return <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('editeur.legende')}</legend>
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('editeur.destinatairesTitre')}</p>
                  <p className="text-sm text-muted-foreground">{t('editeur.destinatairesAide')}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked disabled readOnly />
                    {t('editeur.moi')}
                  </label>
                  {lecteursCoches.length === 0
                    ? <p className="text-sm text-muted-foreground">{t('editeur.aucunLecteur')}</p>
                    : <div className="grid gap-2 sm:grid-cols-2">{lecteursCoches.map(lecteur => <label key={lecteur.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={alerte.destinataires?.includes(lecteur.id) ?? false}
                        onChange={event => majAlerte({ destinataires: event.target.checked ? [...(alerte.destinataires ?? []), lecteur.id] : (alerte.destinataires ?? []).filter(id => id !== lecteur.id) })} />
                      {lecteur.nom}
                    </label>)}</div>}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={alerte.email ?? false} onChange={event => majAlerte({ email: event.target.checked })} />
                  {t('editeur.email')}
                </label>
                {estAdmin
                  ? <label className="block space-y-1 text-sm">{t('editeur.webhook')}
                    <Input type="url" maxLength={2048} value={alerte.webhook ?? ''} placeholder={t('editeur.webhookPlaceholder')}
                      onChange={event => majAlerte({ webhook: event.target.value })} />
                    <span className="block text-xs text-muted-foreground">{t('editeur.webhookAide')}</span>
                  </label>
                  : alerte.webhook && <p className="text-sm text-muted-foreground">{t('editeur.webhookReserve')}</p>}
              </fieldset>
            })()}
          </>}
          <Button type="button" variant="outline" size="sm" onClick={() => setTuiles(courantes => courantes.filter(t => t.id !== tuile.id))}>{tf('retirerTuile')}</Button>
        </fieldset>
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!options.length || tuiles.length >= 12} onClick={() => ajouter('mesure')}>{tf('ajouterIndicateur')}</Button>
        <Button type="button" variant="outline" disabled={tuiles.length >= 12} onClick={() => ajouter('artefact')}>{tf('ajouterArtefact')}</Button>
      </div>
      {!options.length && <p className="text-sm text-muted-foreground">{tf('aucunIndicateur')}</p>}
    </section>
    {(comptes.length > 0 || lecteurs.length > 0) && <fieldset className="space-y-2 rounded-lg border bg-card p-4">
      <legend className="px-1 font-medium">{tf('partagerTitre')}</legend>
      <p className="text-sm text-muted-foreground">{tf('partagerAide')}</p>
      <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
        {[...comptes, ...lecteurs.filter(id => !comptes.some(c => c.id === id)).map(id => ({ id, nom: tf('compteIndisponible'), email: '' }))].map(compte => {
          const coche = lecteurs.includes(compte.id)
          return <label key={compte.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={coche} disabled={!coche && lecteurs.length >= 30}
              onChange={event => {
                if (event.target.checked) { setLecteurs(actuels => [...actuels, compte.id]); return }
                setLecteurs(actuels => actuels.filter(id => id !== compte.id))
                setTuiles(courantes => courantes.map(courante => courante.type === 'mesure' && courante.alerte?.destinataires?.includes(compte.id)
                  ? { ...courante, alerte: normaliserAlerte({ ...courante.alerte, destinataires: courante.alerte.destinataires.filter(id => id !== compte.id) }) }
                  : courante))
              }} />
            {compte.nom || compte.email}
          </label>
        })}
      </div>
    </fieldset>}
    {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte={tf('enregistrer')} attente={tf('enregistrement')} />
  </form>
}
