# Notes SDK IA v7 (lot 0, 02/11/2026)

Constats faits sur les paquets **installés** dans la copie du lot 0 (types `dist/*.d.ts`, code
`dist/index.js`, documentation `node_modules/ai/docs`). À relire par les lots 1, 3, 4 et 6 : la v7
diffère de la v4/v5 sur plusieurs noms.

## Versions installées

| Paquet | Version |
|---|---|
| `ai` | 7.0.159 |
| `@ai-sdk/react` | 4.0.163 |
| `@ai-sdk/provider-utils` | 5.0.72 |
| `@ai-sdk/provider` | 4.0.35 |
| `@ai-sdk/anthropic` | 4.0.94 |
| `@ai-sdk/openai` | 4.0.106 |
| `@ai-sdk/google` | 4.0.109 |
| `@ai-sdk/deepseek` | 3.0.77 |
| `zod` | 4.1.13 (pair de `ai` : `^3.25.76 \|\| ^4.1.8`) |

## Schémas zod et `tool()`

- `tool({ description, inputSchema, execute })` : `inputSchema` est un `FlexibleSchema`
  (zod 3, zod 4, Standard Schema, ou `jsonSchema()`). On passe le schéma zod **tel quel**, importé
  depuis `'zod'` (pas `'zod/v4'`) : `provider-utils` détecte zod 4 par la présence de `_zod`.
- Conversion (`zod4Schema` de `provider-utils`) : `z.toJSONSchema(schema, { target: 'draft-7',
  io: 'input', reused: 'inline' })`, puis **`additionalProperties: false` forcé sur chaque objet**
  (sauf quand c'est un schéma, cas de `z.record`). Le modèle voit donc des objets fermés, que le
  schéma zod soit `object` ou `strictObject`.
- Validation de l'entrée d'un appel d'outil : `safeParseAsync` de zod, donc **les `refine` /
  `superRefine` s'exécutent** (anti-URL/HTML, cohérences), même s'ils n'apparaissent pas dans le
  JSON Schema. Une entrée invalide donne `InvalidToolInputError` ; en multi-étapes l'appel raté est
  renvoyé au modèle pour qu'il corrige (option `repairToolCall` si besoin). Une exception levée
  dans `execute` devient une partie `tool-error`.
- Les contrats suivent ces règles : racine objet (Anthropic et OpenAI l'exigent), ni transform,
  ni preprocess, ni default, ni coerce dans les entrées d'outils ; `.describe()` en DERNIER dans la
  chaîne (la doc du SDK le rappelle : `.min()`, `.optional()`… créent une nouvelle instance) ;
  expressions régulières sans lookaround (le fournisseur OpenAI retire un `pattern` à lookaround et
  `propertyNames`, avec un avertissement).
- `z.discriminatedUnion` devient `oneOf` dans le JSON Schema, `z.union` devient `anyOf`. Les
  fournisseurs installés transmettent `oneOf` (OpenAI le normalise sans le retirer, Google passe le
  schéma en `parametersJsonSchema`). `ArtefactSpec` et les blocs de document restent en
  `discriminatedUnion` pour des messages d'erreur ciblés.
- OpenAI : `strict` n'est envoyé que si l'outil le demande (`tool.strict`). Ne pas l'activer : le
  mode strict exige tous les champs obligatoires, or nos schémas ont des champs facultatifs.
- Les tests `tests/unit/medic-assist/lot0/contrats-outils.test.ts` vérifient chaque schéma par
  `asSchema(schema).jsonSchema` (le chemin réel du SDK) et `z.toJSONSchema`.

## Boucle d'agent : `streamText`

- `stopWhen: isStepCount(n)` (exporté aussi sous l'alias `stepCountIs`). Par défaut **une seule
  étape** : sans `stopWhen`, l'agent n'enchaîne pas les outils (`isStepCount(1)` par défaut, lu
  dans `dist/index.js`). Autre condition exportée : `hasToolCall(...noms)`. `prepareStep` permet de
  changer modèle, outils actifs ou instructions par étape.
- Le prompt système se passe par **`instructions`** (`system` est déprécié) : une chaîne, un
  `SystemModelMessage` ou un tableau de `SystemModelMessage` (utile pour le cache, voir plus bas).
  Un message `system` placé dans `messages` est refusé par défaut (`allowSystemInMessages: false`) :
  l'exemple de cache de la doc Anthropic, qui en met dans `messages`, est à transposer dans
  `instructions`.
- Rappels : `onEnd` (`onFinish` est déprécié), `onStepEnd` (`onStepFinish` déprécié), `onAbort`,
  `onError`. L'usage cumulé des étapes est `totalUsage`.
- Annulation : passer `abortSignal: req.signal`. Pour garder la réponse quand le client se
  déconnecte : `result.consumeStream()` (sans await) puis persister dans `onEnd`.

## Réponse en flux

Forme documentée en v7 :

```ts
return createUIMessageStreamResponse({
  headers: { 'Cache-Control': 'no-cache, no-transform' },
  stream: toUIMessageStream({
    stream: result.stream,
    originalMessages: messagesValides,   // mode persistance : id de réponse fourni
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    messageMetadata: ({ part }) => (part.type === 'start' ? {...} : part.type === 'finish' ? { usage: part.totalUsage } : undefined),
    onEnd: ({ messages, responseMessage, isAborted }) => { /* persister */ },
  }),
})
```

- `result.toUIMessageStreamResponse(options)` existe toujours sur le résultat de `streamText`.
- En-têtes posés par défaut (`UI_MESSAGE_STREAM_HEADERS`) : `content-type: text/event-stream`,
  `cache-control: no-cache`, `connection: keep-alive`, `x-vercel-ai-ui-message-stream: v1`,
  `x-accel-buffering: no`. L'architecture demande `no-cache, no-transform` : le lot 1 surcharge
  `Cache-Control` via `headers`.
- `onEnd` reçoit `{ messages, responseMessage, isContinuation, isAborted, isCancelled?, outcome }`.
- `createUIMessageStream({ execute: ({ writer }) => ... })` permet d'écrire des parties de
  données (`writer.write({ type: 'data-conversation', data: {...} })`) puis
  `writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false }))`.

## Messages UI

- `UIMessage<METADATA, DATA_PARTS, TOOLS>` : `{ id, role: 'system'|'user'|'assistant', metadata?,
  parts }`. Contrat : `MessageMedicAssist = UIMessage<MetadonneesMessage, PartiesDonneesMedicAssist,
  OutilsMedicAssist>`.
- Parties : `text`, `reasoning`, `file`, `source-url`, `source-document`, `step-start`, `custom`,
  `reasoning-file`, `dynamic-tool`, `data-<nom>` (`{ type, id?, data }`) et `tool-<nom>` avec
  `state` parmi `input-streaming`, `input-available`, `approval-requested`, `approval-responded`,
  `output-available`, `output-error` (avec `errorText`), `output-denied`. Gardes exportées :
  `isToolUIPart`, `getToolName`, `isDataUIPart`.
- `convertToModelMessages(messages, { tools?, ignoreIncompleteToolCalls?, convertDataPart? })`
  est **asynchrone** (`await`). Les parties `data-*` ne vont au modèle que via `convertDataPart`.
- `validateUIMessages({ messages, tools?, metadataSchema?, dataSchemas? })` (et
  `safeValidateUIMessages`) : à appeler sur l'historique relu + le nouveau message avant
  `convertToModelMessages`. **Le SDK valide aussi les messages sans métadonnées** : passer
  `MetadonneesUIMessageSchema` (variante `.optional()`), pas `MetadonneesMessageSchema`.
  `dataSchemas` : `SCHEMAS_PARTIES_DONNEES`.
- Les parties `tool-<nom>` en `output-error` peuvent porter un `rawInput` déprécié : migrer vers
  `input` si on en relit d'anciennes.

## Client : `useChat` et transport

- `useChat({ id?, messages?, transport, messageMetadataSchema?, dataPartSchemas?, onFinish,
  onData, onError, onToolCall, sendAutomaticallyWhen, throttle, resume })` renvoie `messages`,
  `status`, `sendMessage`, `regenerate`, `stop`, `setMessages`, `error`, `clearError`,
  `resumeStream`, `addToolOutput`… Il n'y a plus d'état `input` géré par le hook.
- `sendMessage({ text }, { body })` : le second argument fusionne `body` dans la requête (par
  exemple `modeProfond`, `piecesJointesIds`, `contexteEcran`). `regenerate({ messageId, body })`.
- `new DefaultChatTransport({ api, headers, body, credentials, fetch, prepareSendMessagesRequest })`.
  `prepareSendMessagesRequest` reçoit `{ id, messages, requestMetadata, body, credentials, headers,
  api, trigger: 'submit-message'|'regenerate-message', messageId }` et renvoie `{ body, headers?,
  api? }`. **Envoyer seulement le dernier message** est le schéma documenté par la page
  « Chatbot Message Persistence » : c'est la décision du contrat `CorpsRequeteChat` :

```ts
transport: new DefaultChatTransport<MessageMedicAssist>({
  api: '/api/medic-assist/chat',
  prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
    body: {
      ...body,                       // modeProfond, piecesJointesIds, contexteEcran
      conversationId,                // connu du composant
      id,
      trigger,
      messageId,
      message: trigger === 'submit-message' ? messages[messages.length - 1] : undefined,
    },
  }),
}),
```

  Côté serveur : `CorpsRequeteChatSchema.safeParse(json)`, relire l'historique de la conversation
  (avec le `where` propriétaire), y ajouter `message`, puis `validateUIMessages`.

## Usage et coûts

`LanguageModelUsage` : `inputTokens`, `inputTokenDetails: { noCacheTokens, cacheReadTokens,
cacheWriteTokens }`, `outputTokens`, `outputTokenDetails: { textTokens, reasoningTokens }`,
`totalTokens` (toutes valeurs `number | undefined`). Correspondance avec `UsageTokens` du
contrat : `entree = inputTokens`, `sortie = outputTokens`, `cacheLecture = cacheReadTokens`,
`cacheEcriture = cacheWriteTokens`, `raisonnement = reasoningTokens`.

## Cache de prompt Anthropic

Point d'arrêt par `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }`
(option `ttl: '1h'` possible) sur un message, une partie de message, un message système ou un
outil (`tool({ ..., providerOptions })`). Pour le prompt système en cache : `instructions` en
tableau de messages système, le premier (stable : rôle, règles, résumé du catalogue) porte
`cacheControl`, le second (date, périmètre, contexte d'écran) non. Les jetons lus et écrits
reviennent dans `usage.inputTokenDetails.cacheReadTokens` / `cacheWriteTokens`. Les prompts trop
courts ne sont pas mis en cache (seuil de 1 024 à 4 096 jetons selon le modèle, d'après la doc
installée, qui ne cite pas encore les modèles 5.5 : à mesurer).

## Transcription

`experimental_transcribe({ model, audio })` (et `experimental_streamTranscribe`). Modèles de
transcription exposés par `.transcription(modelId)` : `@ai-sdk/openai` (ex. `whisper-1`,
`gpt-4o-transcribe`…) et `@ai-sdk/google`. Rien chez `@ai-sdk/anthropic` ni `@ai-sdk/deepseek` :
d'où `FOURNISSEURS_TRANSCRIPTION = ['openai', 'google']`.

## Remarques pour les lots suivants (ajout du lot 0)

- **Filtres supplémentaires de `RequeteSemantique`** : les filtres propres à un jeu (déclarés par
  le catalogue) ne sont pas des champs de premier niveau, ils vont dans `filtres.autres`
  (`Record<string, scalaire | tableau de scalaires>`). Le serveur revalide ces clés contre le
  catalogue (OpenAI retire `propertyNames` du JSON Schema).
- **Garde de la page `/assistant`** : le middleware ne filtre que les comptes Agency (et les
  profils par habilitation). Un CountryLead ou un Partner atteindrait la page : le lot 3 doit
  donc la garder CÔTÉ SERVEUR (layout ou page serveur : session, `getAccessScope`,
  `peutUtiliserMedicAssist`, sinon `redirect`/`notFound`), en plus de `exigerMedicAssist()` sur
  chaque API.
- **Textes libres** : toute référence de caractère (`&#…`, `&nom;`) est refusée, car elle masque
  un lien (`/&sol;evil.com` devient `//evil.com` après analyse markdown). Les schémas refusés
  sont `javascript:`, `vbscript:`, `file:` et `data:` suivi d'un type MIME ; « Tel: 06 12 » et
  « Data: ventes » restent acceptés.
