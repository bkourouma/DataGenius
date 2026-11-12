import { createServer } from 'node:http'

const hote = '127.0.0.1'
const port = 3130
const application = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3120')
if (!['http:', 'https:'].includes(application.protocol)) throw new Error('NEXTAUTH_URL doit utiliser HTTP ou HTTPS.')
const origineDataGenius = application.origin

const script = `
const formulaire = document.querySelector('#demande')
const statut = document.querySelector('#statut')
const origine = formulaire.dataset.origine
let demande

formulaire.addEventListener('submit', event => {
  event.preventDefault()
  const champs = new FormData(formulaire)
  const filtre = champs.get('filtre').trim()
  const valeur = champs.get('valeur')
  if (Boolean(filtre) !== Boolean(valeur)) {
    statut.textContent = 'Renseignez la clé et la valeur du filtre ensemble.'
    return
  }
  const nonce = crypto.randomUUID()
  const autorisation = new URL('/integration/autoriser', origine)
  autorisation.search = new URLSearchParams({ tableau: champs.get('tableau'), origine: location.origin, nonce })
  demande?.popup.close()
  demande = undefined
  const popup = window.open(autorisation, 'datagenius-autorisation', 'popup,width=580,height=620')
  if (!popup) {
    statut.textContent = 'Autorisez les fenêtres contextuelles pour continuer.'
    return
  }
  demande = { popup, nonce, filtre, valeur }
  statut.textContent = 'Confirmez l’autorisation dans la fenêtre Data Genius.'
})

window.addEventListener('message', event => {
  if (!demande || event.origin !== origine || event.source !== demande.popup) return
  const { type, nonce, jeton } = event.data ?? {}
  if (type !== 'datagenius:autorisation' || nonce !== demande.nonce ||
      typeof jeton !== 'string' || !/^[0-9a-f]{64}$/.test(jeton)) return
  const champs = { jeton }
  if (demande.filtre) Object.assign(champs, { filtre: demande.filtre, valeur: demande.valeur })
  demande = undefined
  const envoi = document.createElement('form')
  envoi.method = 'POST'
  envoi.action = new URL('/api/v1/integration/tableau', origine)
  envoi.target = 'datagenius-tableau'
  for (const [nom, valeur] of Object.entries(champs)) {
    const champ = document.createElement('input')
    champ.type = 'hidden'
    champ.name = nom
    champ.value = valeur
    envoi.append(champ)
  }
  document.body.append(envoi)
  envoi.submit()
  envoi.remove()
  statut.textContent = 'Tableau demandé à Data Genius.'
})
`

const html = `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portail de démonstration Data Genius</title>
<style>
body{font:16px system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#162637}
form{display:flex;flex-wrap:wrap;align-items:end;gap:1rem}
label{display:grid;gap:.3rem}input,button{padding:.5rem;font:inherit}
iframe{width:100%;min-height:22rem;border:1px solid #ccd5df;border-radius:.5rem}
</style>
<h1>Portail de démonstration Data Genius</h1>
<form id="demande" data-origine="${origineDataGenius}">
  <label>Identifiant du tableau <input name="tableau" size="38" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"></label>
  <label>Clé du filtre <input name="filtre" maxlength="63"></label>
  <label>Valeur du filtre <input name="valeur" maxlength="300"></label>
  <button>Afficher le tableau</button>
</form>
<p id="statut" role="status">Indiquez l’identifiant d’un tableau existant.</p>
<iframe name="datagenius-tableau" title="Tableau Data Genius"></iframe>
<script src="/integration.js" defer></script>
</html>`

createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/integration.js'].includes(request.url)) {
    response.writeHead(404).end()
    return
  }
  const javascript = request.url === '/integration.js'
  response.writeHead(200, {
    'Content-Type': javascript ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src ${origineDataGenius}; form-action 'self' ${origineDataGenius}; base-uri 'none'; frame-ancestors 'none'`,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  }).end(javascript ? script : html)
}).listen(port, hote, () => console.log(`Portail de démonstration sur http://${hote}:${port}`))
