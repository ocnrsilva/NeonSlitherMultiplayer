#!/usr/bin/env node
/**
 * scripts/sanitize-db-url.cjs
 * Validates, repairs, and sanitizes DATABASE_URL for Prisma and PostgreSQL.
 * Fixes common Portainer environment variable issues:
 * - Unencoded special characters in passwords (#, ?, /, @, :, %, etc.)
 * - Accidental whitespace before/after port numbers
 * - Unexpanded placeholders (e.g. :port, :${POSTGRES_PORT})
 * - Automatic construction from POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB if needed
 */

function sanitize() {
  const rawUrl = process.env.DATABASE_URL;
  const userEnv = process.env.POSTGRES_USER;
  const passEnv = process.env.POSTGRES_PASSWORD;
  const dbEnv = process.env.POSTGRES_DB;

  let url = (rawUrl || '').trim().replace(/^['"]|['"]$/g, '').trim();

  // If DATABASE_URL is missing or contains template placeholders, construct from POSTGRES_* env vars
  const isPlaceholderUrl = !url || url.includes('${') || url.includes('undefined');
  if (isPlaceholderUrl && userEnv && passEnv && dbEnv) {
    const safeU = encodeURIComponent(userEnv.trim());
    const safeP = encodeURIComponent(passEnv.trim());
    const safeDb = dbEnv.trim();
    const constructed = `postgresql://${safeU}:${safeP}@postgres:5432/${safeDb}?schema=public`;
    console.error(`[Entrypoint] Built DATABASE_URL from POSTGRES_* environment variables.`);
    console.error(`[Entrypoint] Target database: postgresql://${safeU}:***@postgres:5432/${safeDb}`);
    process.stdout.write(constructed);
    return;
  }

  if (!url) {
    console.error(`[Entrypoint] CRITICAL ERROR: Neither DATABASE_URL nor POSTGRES_* variables were found.`);
    console.error(`[Entrypoint] Please set DATABASE_URL or (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB) in Portainer.`);
    process.exit(1);
  }

  // Ensure protocol is postgresql://
  let protocol = 'postgresql://';
  if (url.startsWith('postgres://')) {
    url = 'postgresql://' + url.slice('postgres://'.length);
  } else if (!url.startsWith('postgresql://')) {
    url = 'postgresql://' + url;
  }

  const afterProto = url.slice('postgresql://'.length);
  const lastAtIdx = afterProto.lastIndexOf('@');

  let userInfo = '';
  let hostAndRest = afterProto;

  if (lastAtIdx !== -1) {
    userInfo = afterProto.slice(0, lastAtIdx);
    hostAndRest = afterProto.slice(lastAtIdx + 1);
  }

  // Parse and percent-encode username and password
  let encodedAuth = '';
  let displayUser = 'unknown';
  if (userInfo) {
    const colonIdx = userInfo.indexOf(':');
    let u = userInfo;
    let p = '';
    if (colonIdx !== -1) {
      u = userInfo.slice(0, colonIdx);
      p = userInfo.slice(colonIdx + 1);
    }

    // Decode first in case parts were already encoded, then cleanly encode
    let safeU = u;
    try { safeU = decodeURIComponent(u); } catch {}
    let safeP = p;
    try { safeP = decodeURIComponent(p); } catch {}

    displayUser = safeU;
    encodedAuth = encodeURIComponent(safeU);
    if (p !== '') {
      encodedAuth += ':' + encodeURIComponent(safeP);
    }
    encodedAuth += '@';
  }

  // Normalize hostAndRest: remove extraneous spaces around ':' and '/'
  hostAndRest = hostAndRest.trim();
  hostAndRest = hostAndRest.replace(/\s*:\s*/, ':').replace(/\s*\//, '/');

  // Match host, port, database, and query params
  const hostMatch = hostAndRest.match(/^([^:\/?#\s]+)(?::([^\/?#\s]*))?(\/[^?#\s]*)?(\?[^#\s]*)?(#.*)?$/);

  let host = 'postgres';
  let port = '5432';
  let dbPath = '/neon_slither';
  let query = '?schema=public';

  if (hostMatch) {
    host = hostMatch[1].trim();
    const rawPort = (hostMatch[2] || '').trim();
    dbPath = hostMatch[3] || '/neon_slither';
    query = hostMatch[4] || '';

    // If host was given as localhost or 127.0.0.1 in Docker network, redirect to postgres service
    if (host === 'localhost' || host === '127.0.0.1') {
      console.error(`[Entrypoint] Notice: Changed host '${host}' to internal docker service 'postgres'.`);
      host = 'postgres';
    }

    // Validate port
    if (!rawPort || rawPort === 'port' || rawPort.startsWith('${') || isNaN(Number(rawPort))) {
      console.error(`[Entrypoint] Notice: Invalid port '${rawPort}' detected; defaulted to '5432'.`);
      port = '5432';
    } else {
      port = rawPort;
    }

    // Ensure schema parameter
    if (!query) {
      query = '?schema=public';
    } else if (!query.includes('schema=')) {
      query += (query.includes('?') ? '&' : '?') + 'schema=public';
    }
  }

  const finalUrl = `postgresql://${encodedAuth}${host}:${port}${dbPath}${query}`;

  console.error(`[Entrypoint] Sanitized DATABASE_URL successfully.`);
  console.error(`[Entrypoint] Target: postgresql://${displayUser}:***@${host}:${port}${dbPath}`);

  process.stdout.write(finalUrl);
}

try {
  sanitize();
} catch (err) {
  console.error(`[Entrypoint] Fatal error while sanitizing DATABASE_URL:`, err.message);
  process.exit(1);
}
