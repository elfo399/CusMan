Swagger/OpenAPI per InfraCusMan

Installazione (nella cartella `be` o nel root del progetto in cui si trova il `package.json` del BE):

1) Installare le dipendenze:

   npm i swagger-ui-express swagger-jsdoc

2) Montare lo Swagger nell'app Express (tipicamente in `be/src/index.js`, `be/src/server.js` o file equivalente):

   const express = require('express');
   const { registerSwagger } = require('./src/swagger');

   const app = express();
   // ... middleware e rotte
   registerSwagger(app, { route: '/api-docs' });
   // Ora UI disponibile su /api-docs e JSON su /api-docs.json

3) Annotare le API con JSDoc in-line per il tracciamento automatico (file in `be/src/**/*.js`). Esempio:

   /**
    * @openapi
    * /api/partners:
    *   get:
    *     summary: Lista partner
    *     tags: [Partners]
    *     responses:
    *       200:
    *         description: OK
    */
   app.get('/api/partners', (req, res) => { /* ... */ });

   /**
    * @openapi
    * /api/partners/{id}:
    *   get:
    *     summary: Dettaglio partner
    *     tags: [Partners]
    *     parameters:
    *       - in: path
    *         name: id
    *         required: true
    *         schema: { type: string }
    *     responses:
    *       200: { description: OK }
    *       404: { description: Non trovato }
    */
   app.get('/api/partners/:id', (req, res) => { /* ... */ });

Note
- Se le rotte sono montate su un `Router`, le annotazioni vanno nello stesso file in cui è definita la path finale (incluso il prefisso). In alternativa, nel blocco `@openapi` scrivere la path completa come verrà esposta.
- Aggiornare `servers.url` in `be/src/swagger.js` se l'API è servita dietro un prefisso o hostname diverso.
