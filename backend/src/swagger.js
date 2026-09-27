/*
  Swagger/OpenAPI setup for InfraCusMan backend.
  - Uses swagger-jsdoc to scan JSDoc annotations under be/src
  - Exposes UI at /api-docs and raw JSON at /api-docs.json

  Quick usage:
    const express = require('express');
    const { registerSwagger } = require('./src/swagger');
    const app = express();
    registerSwagger(app, { route: '/api-docs' });
    // ... your routes
*/

import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'InfraCusMan API',
    version: '1.0.0',
    description: 'Documentazione delle API di InfraCusMan',
  },
  servers: [
    // Adjust base URL if your API is mounted under a prefix or different host
    { url: '/' },
  ],
};

const options = {
  definition: swaggerDefinition,
  // Scan all JS files under be/src for JSDoc @openapi or @swagger comments
  apis: [path.join(__dirname, '/**/*.js')],
};

const specs = swaggerJsdoc(options);

export function registerSwagger(app, { route = '/api-docs' } = {}) {
  app.use(route, swaggerUi.serve, swaggerUi.setup(specs, { explorer: true }));
  app.get(`${route}.json`, (_req, res) => res.json(specs));
}
export { specs };
