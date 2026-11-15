'use client'

import { useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { chargerCombinaison, jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { Soumettre } from '../formulaires'
import { enregistrerCombinaison, previsualiserJointure } from './actions'
import { ApercuJointure, type ResultatApercu } from './apercu'

type Edition = NonNullable<Awaited<ReturnType<typeof chargerCombinaison>>>
type Jeux = Awaited<ReturnType<typeof jeuxPourCombinaison>>
type Cote = 'gauche' | 'droite'
type Lien = { id: number; gauche: string; droite: string }
type Selection = { cote: Cote; nom: string }
const cotes = ['gauche', 'droite'] as const
const typesConnus = ['texte', 'entier', 'decimal', 'montant', 'pourcentage', 'date', 'periode']
const MAX_COLONNES = 50
const champ = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

export function FormulaireCombinaison({ jeux, edition }: { jeux: Jeux; edition?: Edition }) {
  const t = useTranslations('sources.combiner.formulaire')
  const tTypes = useTranslations('sources.combiner.typesColonne')
  const libelles = { gauche: t('premierJeu'), droite: t('deuxiemeJeu') }
  const libelleType = (type: string) => typesConnus.includes(type) ? tTypes(type) : type
  const [etat, action] = useFormState(enregistrerCombinaison, {})
  const initiale = edition?.definition
  const [choix, setChoix] = useState({ gauche: initiale?.gauche ?? '', droite: initiale?.droite ?? '' })
  const [type, setType] = useState<string>(initiale?.type ?? 'interne')
  const [liens, setLiens] = useState<Lien[]>(() => initiale?.liens.map((lien, id) => ({ ...lien, id })) ?? [{ id: 0, gauche: '', droite: '' }])
  const [colonnes, setColonnes] = useState<Selection[]>(initiale?.colonnes ?? [])
  const prochainId = useRef(liens.length)
  const [apercu, setApercu] = useState<{ selection: string; resultat?: ResultatApercu; erreur?: string }>()
  const [apercuEnCours, setApercuEnCours] = useState(false)
  const selection = JSON.stringify({
    ...choix, type, liens: liens.map(({ gauche, droite }) => ({ gauche, droite })), colonnes,
  })
  const apercuCourant = apercu?.selection === selection ? apercu : undefined
  const tables = {
    gauche: jeux.find(j => j.cle === choix.gauche),
    droite: jeux.find(j => j.cle === choix.droite),
  }
  const selectionComplete = !!tables.gauche && !!tables.droite
  const colonneExiste = (cote: Cote, nom: string) => tables[cote]?.colonnes.some(c => c.nom === nom) ?? false
  const indisponibles = colonnes.filter(c => !colonneExiste(c.cote, c.nom))
  const previsualisable = selectionComplete && colonnes.length > 0 && indisponibles.length === 0 &&
    liens.every(lien => cotes.every(cote => colonneExiste(cote, lien[cote])))

  async function afficherApercu() {
    setApercu(undefined)
    setApercuEnCours(true)
    try {
      const reponse = await previsualiserJointure(selection)
      setApercu({ selection, ...reponse })
    } catch {
      setApercu({ selection, erreur: t('apercuIndisponible') })
    } finally {
      setApercuEnCours(false)
    }
  }

  function changerJeu(cote: Cote, cle: string) {
    setChoix(courant => ({ ...courant, [cote]: cle }))
    setLiens(courant => courant.map(lien => ({ ...lien, [cote]: '' })))
    setColonnes(courantes => courantes.filter(c => c.cote !== cote))
  }

  function ajouterLien() {
    const id = prochainId.current++
    setLiens(courants => [...courants, { id, gauche: '', droite: '' }])
  }

  function selectionnerColonne(cote: Cote, nom: string, active: boolean) {
    setColonnes(courantes => active ? [...courantes, { cote, nom }] :
      courantes.filter(c => c.cote !== cote || c.nom !== nom))
  }

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-card p-5">
      <input type="hidden" name="choix" value={selection} />
      {edition && <>
        <input type="hidden" name="cle" value={edition.definition.cle} />
        <input type="hidden" name="revision" value={edition.revision} />
      </>}
      <div className="grid gap-4 sm:grid-cols-2">
        {cotes.map(cote => (
          <div key={cote} className="min-w-0 space-y-2">
            <Label htmlFor={'jeu-' + cote}>{libelles[cote]}</Label>
            <select id={'jeu-' + cote} className={champ} value={choix[cote]} required disabled={!!edition}
              onChange={e => changerJeu(cote, e.target.value)}>
              <option value="">{t('choisirJeu')}</option>
              {jeux.map(jeu => (
                <option key={jeu.cle} value={jeu.cle} disabled={jeu.cle === choix[cote === 'gauche' ? 'droite' : 'gauche']}>
                  {jeu.sources.length ? t('jeuAvecSources', { titre: jeu.titre, sources: jeu.sources.join(' / ') }) : jeu.titre}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {selectionComplete && <>
        <div className="space-y-2">
          <Label htmlFor="type-jointure">{t('lignesAConserver')}</Label>
          <select id="type-jointure" className={champ} value={type} onChange={e => setType(e.target.value)}>
            <option value="interne">{t('interne')}</option>
            <option value="gauche">{t('gauche')}</option>
          </select>
        </div>

        <fieldset className="space-y-3">
          <legend className="font-semibold">{t('colonnesLiaison')}</legend>
          <p className="text-sm text-muted-foreground">{t('liaisonsAide')}</p>
          {liens.map((lien, index) => (
            <div key={lien.id} className="flex flex-wrap items-end gap-3">
              {cotes.map(cote => (
                <div key={cote} className="min-w-40 flex-1 space-y-2">
                  <Label htmlFor={'lien-' + lien.id + '-' + cote}>{t('liaisonCote', { cote: libelles[cote], numero: index + 1 })}</Label>
                  <select id={'lien-' + lien.id + '-' + cote} className={champ} value={lien[cote]} required
                    onChange={e => setLiens(courants => courants.map(l => l.id === lien.id ? { ...l, [cote]: e.target.value } : l))}>
                    <option value="">{t('choisirColonne')}</option>
                    {lien[cote] && !colonneExiste(cote, lien[cote]) && (
                      <option value={lien[cote]} disabled>{t('indisponible', { valeur: lien[cote] })}</option>
                    )}
                    {tables[cote]?.colonnes.map(colonne => (
                      <option key={colonne.nom} value={colonne.nom}>{t('colonneAvecType', { description: colonne.description, type: libelleType(colonne.type) })}</option>
                    ))}
                  </select>
                </div>
              ))}
              {liens.length > 1 && <Button type="button" variant="ghost" onClick={() => setLiens(c => c.filter(l => l.id !== lien.id))}>
                {t('retirerLiaison', { numero: index + 1 })}
              </Button>}
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={ajouterLien} disabled={liens.length >= 6}>
            {t('ajouterLiaison')}
          </Button>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">{t('colonnesResultat')}</legend>
          <p className="text-sm text-muted-foreground" aria-live="polite">{t('selectionnees', { count: colonnes.length, max: MAX_COLONNES })}</p>
          {indisponibles.map(({ cote, nom }) => (
            <div key={cote + nom} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('colonneIndisponible', { cote: libelles[cote], nom })}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => selectionnerColonne(cote, nom, false)}>
                {t('retirer', { nom })}
              </Button>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            {cotes.map(cote => (
              <div key={cote} className="min-w-0 space-y-2">
                <p className="text-sm font-medium">{tables[cote]?.titre}</p>
                <ul className="max-h-64 divide-y overflow-auto rounded-md border">
                  {tables[cote]?.colonnes.map(colonne => {
                    const cochee = colonnes.some(c => c.cote === cote && c.nom === colonne.nom)
                    return (
                      <li key={colonne.nom}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                          <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={cochee}
                            disabled={!cochee && colonnes.length >= MAX_COLONNES}
                            onChange={e => selectionnerColonne(cote, colonne.nom, e.target.checked)} />
                          <span className="min-w-0 flex-1 break-words">{colonne.description}</span>
                          <span className="text-muted-foreground">{libelleType(colonne.type)}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>
      </>}

      {selectionComplete && (
        <div className="space-y-3" aria-busy={apercuEnCours}>
          <Button type="button" variant="outline" disabled={!previsualisable || apercuEnCours} onClick={afficherApercu}>
            {apercuEnCours ? t('apercuEnCours') : t('previsualiser')}
          </Button>
          {apercuCourant?.erreur && <p role="alert" className="text-sm text-destructive">{apercuCourant.erreur}</p>}
          {apercuCourant?.resultat && <ApercuJointure resultat={apercuCourant.resultat} afficherCorrespondances={type === 'gauche'} />}
        </div>
      )}

      {!edition && <>
        <div className="space-y-2"><Label htmlFor="combinaison-titre">{t('nomResultat')}</Label><Input id="combinaison-titre" name="titre" maxLength={120} required /></div>
        <div className="space-y-2"><Label htmlFor="combinaison-description">{t('descriptionFacultative')}</Label><Textarea id="combinaison-description" name="description" maxLength={300} rows={2} /></div>
      </>}
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <fieldset disabled={!previsualisable || apercuEnCours}>
        <Soumettre texte={edition ? t('enregistrerModifications') : t('enregistrerJeu')} attente={t('enregistrement')} />
      </fieldset>
    </form>
  )
}
