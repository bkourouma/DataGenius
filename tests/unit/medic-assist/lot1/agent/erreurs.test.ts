import { describe, expect, it } from 'vitest'
import {
  CODES_ERREUR_CHAT,
  classerErreur,
  decrireErreurPourJournal,
  masquerSecrets,
  ErreurFournisseurAbsent,
  formaterErreurFlux,
  MESSAGE_ERREUR_FLUX_PREFIXE,
} from '@/lib/medic-assist/agent/erreurs'

// Marqueur de test : ZZMA1ERR

function erreurApi(statusCode: number, message = 'Erreur', responseBody?: string) {
  return Object.assign(new Error(message), { name: 'AI_APICallError', statusCode, responseBody })
}

describe('classerErreur', () => {
  it('429 → limite_debit, retentable', () => {
    expect(classerErreur(erreurApi(429, 'Rate limit reached'))).toEqual({
      code: 'limite_debit',
      statutHttp: 429,
      retentable: true,
    })
  })

  it('429 ou 402 avec marqueur de quota → quota_epuise', () => {
    const quota429 = erreurApi(
      429,
      'You exceeded your current quota, please check your plan and billing details',
    )
    expect(classerErreur(quota429).code).toBe('quota_epuise')
    expect(classerErreur(erreurApi(402, 'Payment required')).code).toBe('quota_epuise')
    const anthropic = erreurApi(400, 'x', '{"error":{"message":"Your credit balance is too low"}}')
    expect(classerErreur(anthropic).code).toBe('quota_epuise')
    expect(classerErreur(quota429).retentable).toBe(false)
  })

  it('401 et 403 → authentification_fournisseur, jamais renvoyés tels quels', () => {
    for (const statut of [401, 403]) {
      const c = classerErreur(erreurApi(statut, 'invalid x-api-key'))
      expect(c.code).toBe('authentification_fournisseur')
      expect(c.statutHttp).not.toBe(401)
      expect(c.statutHttp).not.toBe(403)
      expect(c.retentable).toBe(false)
    }
  })

  it('503 et 529 → fournisseur_indisponible', () => {
    expect(classerErreur(erreurApi(503))).toEqual({
      code: 'fournisseur_indisponible',
      statutHttp: 503,
      retentable: true,
    })
    expect(classerErreur(erreurApi(529, 'Overloaded')).code).toBe('fournisseur_indisponible')
  })

  it('ErreurFournisseurAbsent et clé manquante → fournisseur_non_configure, non réessayable', () => {
    expect(classerErreur(new ErreurFournisseurAbsent())).toEqual({
      code: 'fournisseur_non_configure',
      statutHttp: 503,
      retentable: false,
    })
    const sdk = Object.assign(new Error('Anthropic API key is missing.'), {
      name: 'AI_LoadAPIKeyError',
    })
    expect(classerErreur(sdk).code).toBe('fournisseur_non_configure')
  })

  it('AbortError → annule', () => {
    const abandon = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    expect(classerErreur(abandon)).toEqual({ code: 'annule', statutHttp: 499, retentable: false })
  })

  it('timeouts → delai_depasse', () => {
    const delai = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
    expect(classerErreur(delai).code).toBe('delai_depasse')
    expect(classerErreur(new Error('Request timed out after 60s')).code).toBe('delai_depasse')
    expect(classerErreur(erreurApi(504)).code).toBe('delai_depasse')
    expect(classerErreur(erreurApi(408)).code).toBe('delai_depasse')
  })

  it('contexte dépassé → requete_trop_longue', () => {
    expect(classerErreur(erreurApi(413)).code).toBe('requete_trop_longue')
    expect(classerErreur(erreurApi(400, 'prompt is too long: 250000 tokens > 200000')).code).toBe(
      'requete_trop_longue',
    )
    expect(
      classerErreur(erreurApi(400, "This model's maximum context length is 128000 tokens")).code,
    ).toBe('requete_trop_longue')
  })

  it('refus de sécurité → contenu_refuse', () => {
    expect(
      classerErreur(
        erreurApi(400, 'Blocked by content filter', '{"finish_reason":"content_filter"}'),
      ).code,
    ).toBe('contenu_refuse')
  })

  it('suit la cause et RetryError (lastError)', () => {
    const enveloppe = Object.assign(new Error('Failed after 3 attempts'), {
      name: 'AI_RetryError',
      lastError: erreurApi(429, 'Rate limit'),
    })
    expect(classerErreur(enveloppe).code).toBe('limite_debit')
    const avecCause = Object.assign(new Error('boom'), { cause: erreurApi(401, 'nope') })
    expect(classerErreur(avecCause).code).toBe('authentification_fournisseur')
  })

  it('lit status et response.status', () => {
    expect(classerErreur({ status: 429 }).code).toBe('limite_debit')
    expect(classerErreur({ response: { status: 503 } }).code).toBe('fournisseur_indisponible')
  })

  it('réseau coupé → fournisseur_indisponible', () => {
    expect(classerErreur(new TypeError('fetch failed')).code).toBe('fournisseur_indisponible')
  })

  it('inconnu → interne', () => {
    for (const e of [new Error('quelque chose'), 'texte', 42, null, undefined, {}]) {
      expect(classerErreur(e)).toEqual({ code: 'interne', statutHttp: 500, retentable: false })
    }
  })

  it('500 du fournisseur → interne mais retentable', () => {
    expect(classerErreur(erreurApi(500))).toEqual({
      code: 'interne',
      statutHttp: 500,
      retentable: true,
    })
  })

  it('ne boucle pas sur une cause circulaire', () => {
    const e: Record<string, unknown> = new Error('cycle') as unknown as Record<string, unknown>
    e.cause = e
    expect(classerErreur(e).code).toBe('interne')
  })

  it('tous les codes renvoyés appartiennent à la liste publique', () => {
    for (const e of [
      erreurApi(429),
      erreurApi(401),
      new Error('x'),
      new ErreurFournisseurAbsent(),
    ]) {
      expect(CODES_ERREUR_CHAT).toContain(classerErreur(e).code)
    }
  })
})

describe('formaterErreurFlux', () => {
  it('renvoie uniquement le préfixe et le code', () => {
    expect(formaterErreurFlux(erreurApi(429))).toBe(`${MESSAGE_ERREUR_FLUX_PREFIXE}limite_debit`)
    expect(MESSAGE_ERREUR_FLUX_PREFIXE).toBe('medic_assist_erreur:')
  })

  it('ne laisse fuiter ni URL, ni clé, ni message du fournisseur', () => {
    const secret = 'sk-ant-api03-ZZMA1ERR-secret'
    const e = Object.assign(
      new Error(`401 invalid key ${secret} at https://api.anthropic.com/v1/messages`),
      {
        name: 'AI_APICallError',
        statusCode: 401,
        url: 'https://api.anthropic.com/v1/messages',
        responseBody: `{"error":"${secret}"}`,
      },
    )
    const chaine = formaterErreurFlux(e)
    expect(chaine).toBe('medic_assist_erreur:authentification_fournisseur')
    expect(chaine).not.toContain(secret)
    expect(chaine).not.toMatch(/https?:|anthropic|sk-/i)
    expect(chaine).toMatch(/^medic_assist_erreur:[a-z_]+$/)
  })

  it('renvoie interne pour une erreur inconnue sans détail', () => {
    expect(formaterErreurFlux(new Error('SELECT * FROM users'))).toBe('medic_assist_erreur:interne')
  })
})

const CORPS_SURCHARGE =
  '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'

function corpsAnthropic(type: string, message = 'x') {
  return JSON.stringify({ type: 'error', error: { type, message } })
}

describe('classerErreur : fournisseur Anthropic', () => {
  it('529 avec corps overloaded_error → fournisseur_indisponible retentable', () => {
    const e = {
      name: 'APICallError',
      statusCode: 529,
      message: 'Overloaded',
      responseBody: CORPS_SURCHARGE,
    }
    expect(classerErreur(e)).toEqual({
      code: 'fournisseur_indisponible',
      statutHttp: 503,
      retentable: true,
    })
  })

  it('erreur en flux sans statut ni message → lue par son type', () => {
    const surcharge = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    expect(classerErreur(surcharge).code).toBe('fournisseur_indisponible')
    expect(classerErreur({ type: 'error', error: { type: 'api_error', message: 'x' } }).code).toBe(
      'fournisseur_indisponible',
    )
    expect(
      classerErreur({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }).code,
    ).toBe('limite_debit')
    expect(
      classerErreur({ type: 'error', error: { type: 'timeout_error', message: 'x' } }).code,
    ).toBe('delai_depasse')
    for (const type of ['authentication_error', 'permission_error']) {
      expect(classerErreur({ type: 'error', error: { type, message: 'x' } }).code).toBe(
        'authentification_fournisseur',
      )
    }
  })

  it('RetryError : lastError 529 et errors[]', () => {
    const lastError = { name: 'APICallError', statusCode: 529, message: 'Overloaded' }
    expect(
      classerErreur({ name: 'RetryError', message: 'Failed after 3 attempts', lastError }).code,
    ).toBe('fournisseur_indisponible')
    expect(
      classerErreur({ name: 'RetryError', message: 'Failed', errors: [lastError, lastError] }).code,
    ).toBe('fournisseur_indisponible')
  })

  it('400 invalid_request_error contenant « overloaded » → interne non retentable', () => {
    const e = {
      name: 'APICallError',
      statusCode: 400,
      message: 'overloaded network',
      responseBody: corpsAnthropic('invalid_request_error', 'tools.0: overloaded network schema'),
    }
    expect(classerErreur(e)).toEqual({ code: 'interne', statutHttp: 500, retentable: false })
    // Sans statut : le type seul suffit.
    const enFlux = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Overloaded' },
    }
    expect(classerErreur(enFlux)).toEqual({ code: 'interne', statutHttp: 500, retentable: false })
    for (const statut of [404, 422]) {
      expect(classerErreur(erreurApi(statut, 'fetch failed')).code).toBe('interne')
    }
  })

  it('500 api_error → fournisseur_indisponible retentable', () => {
    const e = {
      name: 'APICallError',
      statusCode: 500,
      message: 'Internal',
      responseBody: corpsAnthropic('api_error', 'Internal server error'),
    }
    expect(classerErreur(e)).toMatchObject({ code: 'fournisseur_indisponible', retentable: true })
  })

  it('fetch failed et ECONNRESET (cause) → fournisseur_indisponible', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const e = Object.assign(new TypeError('fetch failed'), { cause })
    expect(classerErreur(e).code).toBe('fournisseur_indisponible')
    expect(classerErreur(new Error('read ECONNRESET')).code).toBe('fournisseur_indisponible')
  })

  it('429 et 401 avec corps Anthropic', () => {
    const limite = {
      statusCode: 429,
      message: 'x',
      responseBody: corpsAnthropic('rate_limit_error'),
    }
    expect(classerErreur(limite).code).toBe('limite_debit')
    const auth = {
      statusCode: 401,
      message: 'x',
      responseBody: corpsAnthropic('authentication_error', 'invalid x-api-key'),
    }
    expect(classerErreur(auth).code).toBe('authentification_fournisseur')
  })
})

describe('masquerSecrets', () => {
  it('masque clés, Bearer, en-têtes et longues suites alphanumériques', () => {
    const texte =
      'sk-ant-api03-ABCDEF123 Bearer abc.def-ghi x-api-key: monsecret authorization=jeton ' +
      'api_key="valeur" ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 court'
    const masque = masquerSecrets(texte)
    const secrets = [
      'ABCDEF123',
      'abc.def-ghi',
      'monsecret',
      'jeton',
      'valeur',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    ]
    for (const secret of secrets) expect(masque).not.toContain(secret)
    expect(masque).toContain('court')
    expect(masque).toContain('[masqué]')
  })

  it('laisse intact un texte sans secret', () => {
    expect(masquerSecrets('invalid x-api-key task-force')).toBe('invalid x-api-key task-force')
  })
})

describe('decrireErreurPourJournal', () => {
  it('décrit une 529 sur une ligne', () => {
    const e = {
      name: 'APICallError',
      statusCode: 529,
      message: 'Overloaded',
      responseBody: CORPS_SURCHARGE,
    }
    expect(decrireErreurPourJournal(e)).toBe(
      'code=fournisseur_indisponible statut=529 retentable=oui nom=APICallError typeFournisseur=overloaded_error message="Overloaded"',
    )
  })

  it('décrit une erreur en flux sans statut', () => {
    const ligne = decrireErreurPourJournal({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })
    expect(ligne).toContain('code=fournisseur_indisponible')
    expect(ligne).toContain('typeFournisseur=overloaded_error')
    expect(ligne).not.toContain('statut=')
    expect(ligne).toContain('message="Overloaded"')
  })

  it('indique la cause, tronque le message et reste sur une ligne', () => {
    const e = Object.assign(new TypeError(`fetch failed\n${'x'.repeat(500)}`), {
      cause: Object.assign(new Error('boom'), { name: 'ConnectTimeoutError' }),
    })
    const ligne = decrireErreurPourJournal(e)
    expect(ligne).not.toMatch(/[\r\n]/)
    expect(ligne).toContain('cause=ConnectTimeoutError')
    expect(ligne.length).toBeLessThan(400)
  })

  it('ne journalise ni clé, ni en-tête, ni corps de requête, ni URL', () => {
    const secret = 'sk-ant-api03-ZZMA1ERR-secret'
    const e = Object.assign(new Error(`401 invalid key ${secret} Bearer jeton123`), {
      name: 'APICallError',
      statusCode: 401,
      url: 'https://api.anthropic.com/v1/messages?cle=1',
      requestBodyValues: { messages: ['donnee-sensible'] },
      responseHeaders: { authorization: 'Bearer xyz' },
    })
    const ligne = decrireErreurPourJournal(e)
    expect(ligne).toContain('code=authentification_fournisseur')
    for (const interdit of [secret, 'jeton123', 'donnee-sensible', 'api.anthropic.com', 'xyz']) {
      expect(ligne).not.toContain(interdit)
    }
  })

  it('supporte les valeurs non-objet', () => {
    expect(decrireErreurPourJournal('texte')).toContain('code=interne')
    expect(decrireErreurPourJournal(undefined)).toContain('code=interne')
  })
})
