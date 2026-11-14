import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.fn()
const createTransport = vi.fn(() => ({ sendMail }))

vi.mock('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}))

const ADRESSE = 'personne.secrete@exemple.test'
const SUJET = 'Sujet confidentiel 4821'

function message() {
  return { to: ADRESSE, subject: SUJET, html: '<p>x</p>', text: 'x' }
}

function sortieConsole(...espions: ReturnType<typeof vi.spyOn>[]) {
  return JSON.stringify(espions.map((e) => e.mock.calls))
}

describe('envoyerMail', () => {
  const hoteInitial = process.env.SMTP_HOST
  let info: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    sendMail.mockReset()
    createTransport.mockClear()
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (hoteInitial === undefined) delete process.env.SMTP_HOST
    else process.env.SMTP_HOST = hoteInitial
  })

  it('SMTP absent : ne part pas et ne journalise ni adresse ni sujet', async () => {
    process.env.SMTP_HOST = ''
    const { envoyerMail } = await import('@/lib/mail/transport')

    expect(await envoyerMail(message())).toBe(false)
    expect(sendMail).not.toHaveBeenCalled()

    const sortie = sortieConsole(info, warn, error)
    expect(sortie).not.toContain(ADRESSE)
    expect(sortie).not.toContain(SUJET)
    const lignes = info.mock.calls.map((c) => JSON.parse(String(c[0])))
    expect(lignes).toContainEqual(expect.objectContaining({ destinataires: 1 }))
  })

  it("échec d'envoi : renvoie false, journalise le code sans adresse ni sujet", async () => {
    process.env.SMTP_HOST = 'smtp.exemple.test'
    sendMail.mockRejectedValue(
      Object.assign(new Error(`Refus pour ${ADRESSE} : ${SUJET}`), { code: 'ECONNECTION' })
    )
    const { envoyerMail } = await import('@/lib/mail/transport')

    expect(await envoyerMail(message())).toBe(false)

    const sortie = sortieConsole(info, warn, error)
    expect(sortie).not.toContain(ADRESSE)
    expect(sortie).not.toContain(SUJET)
    expect(sortie).not.toContain('Refus pour')
    expect(JSON.stringify(error.mock.calls)).toContain('ECONNECTION')
  })

  it('succès : renvoie true et transmet to et subject', async () => {
    process.env.SMTP_HOST = 'smtp.exemple.test'
    sendMail.mockResolvedValue({})
    const { envoyerMail } = await import('@/lib/mail/transport')

    expect(await envoyerMail(message())).toBe(true)
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ADRESSE, subject: SUJET })
    )
  })
})
