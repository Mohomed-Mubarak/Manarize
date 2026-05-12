'use strict';
/**
 * Lightweight request-body schema validator — no external deps.
 * Replaces zod/joi for Vercel serverless functions.
 *
 * Usage:
 *   const { body, error } = validate(rawBody, SCHEMA);
 *   if (error) return res.status(400).json({ error });
 */

const MAX_STRING_LEN = 10_000;
const MAX_BODY_BYTES = 64_000; // 64 KB hard limit

/**
 * Validate `data` against `schema`.
 * @param {object} data   - Parsed JSON body
 * @param {object} schema - Field definitions: { field: { type, required, max, min, enum } }
 * @returns {{ body: object|null, error: string|null }}
 */
function validate(data, schema) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { body: null, error: 'Request body must be a JSON object' };
  }

  const body = {};

  for (const [field, rules] of Object.entries(schema)) {
    const val = data[field];
    const missing = val === undefined || val === null || val === '';

    if (rules.required && missing) {
      return { body: null, error: `Missing required field: ${field}` };
    }
    if (missing) { body[field] = rules.default ?? undefined; continue; }

    // Type check
    if (rules.type === 'string') {
      if (typeof val !== 'string') return { body: null, error: `${field} must be a string` };
      const max = rules.max ?? MAX_STRING_LEN;
      if (val.length > max) return { body: null, error: `${field} exceeds max length of ${max}` };
      if (rules.min && val.length < rules.min) return { body: null, error: `${field} too short (min ${rules.min})` };
      body[field] = val.trim();
    } else if (rules.type === 'number') {
      const n = Number(val);
      if (isNaN(n)) return { body: null, error: `${field} must be a number` };
      if (rules.min !== undefined && n < rules.min) return { body: null, error: `${field} must be >= ${rules.min}` };
      if (rules.max !== undefined && n > rules.max) return { body: null, error: `${field} must be <= ${rules.max}` };
      body[field] = n;
    } else if (rules.type === 'boolean') {
      if (typeof val !== 'boolean') return { body: null, error: `${field} must be a boolean` };
      body[field] = val;
    } else if (rules.type === 'array') {
      if (!Array.isArray(val)) return { body: null, error: `${field} must be an array` };
      if (rules.max && val.length > rules.max) return { body: null, error: `${field} array too long (max ${rules.max})` };
      body[field] = val;
    } else if (rules.type === 'object') {
      if (typeof val !== 'object' || Array.isArray(val)) return { body: null, error: `${field} must be an object` };
      body[field] = val;
    } else {
      body[field] = val; // passthrough for unknown types
    }

    // Enum check
    if (rules.enum && !rules.enum.includes(body[field])) {
      return { body: null, error: `${field} must be one of: ${rules.enum.join(', ')}` };
    }
  }

  return { body, error: null };
}

/**
 * Guard: ensure JSON body is under MAX_BODY_BYTES.
 * Call before readJson() for write endpoints.
 */
function checkBodySize(req) {
  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (len > MAX_BODY_BYTES) return `Request body too large (max ${MAX_BODY_BYTES / 1000} KB)`;
  return null;
}

module.exports = { validate, checkBodySize };
