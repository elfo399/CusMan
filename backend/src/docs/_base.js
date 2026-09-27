/**
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         code:
 *           type: string
 */

// Questo file esiste solo per contenere componenti OpenAPI comuni.
// swagger-jsdoc raccoglie i blocchi @openapi anche se il file non esporta nulla.

