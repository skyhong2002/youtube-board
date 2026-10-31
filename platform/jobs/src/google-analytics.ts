// Read-only Google client for the GA4 Data API and Search Console, signed with a service-account key (JWT bearer
// grant; no SDK dependency). Ported from tag.observe.tw app/src/analytics/google.ts.
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'] as const;

export interface GoogleConfig { credentialsFile: string; propertyId: string; siteUrl: string }

/** Service-account file, GA4 property and Search Console property from the environment; null when any is unset
 * (the jobs then skip). A value that is set but malformed is a configuration error. */
export function googleConfigFromEnv(env: NodeJS.ProcessEnv): GoogleConfig | null {
  const credentialsFile = env.GOOGLE_APPLICATION_CREDENTIALS?.trim(), propertyId = env.GA4_PROPERTY_ID?.trim(), siteUrl = env.GSC_SITE_URL?.trim();
  if (!credentialsFile || !propertyId || !siteUrl) return null;
  if (!/^\d{1,20}$/.test(propertyId)) throw new Error('GA4_PROPERTY_ID must be numeric');
  if (!/^sc-domain:[a-z0-9.-]{1,253}$/.test(siteUrl) && !/^https:\/\/[a-z0-9.-]{1,253}\/$/.test(siteUrl)) throw new Error('GSC_SITE_URL must be https://host/ or sc-domain:host');
  if (!credentialsFile.startsWith('/')) throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be an absolute path');
  return { credentialsFile, propertyId, siteUrl };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

// biome-ignore lint/suspicious/noExplicitAny: Google's report JSON is read field by field by the callers.
export type GoogleFetch = (url: string, body?: object) => Promise<any>;

/** Never logs tokens, the assertion or response bodies: errors carry only the HTTP status and the URL path. */
export function googleClient(config: GoogleConfig, fetchImpl: typeof fetch = fetch, now = () => Date.now()): GoogleFetch {
  let token: { value: string; expires: number } | null = null;
  async function accessToken() {
    if (token && token.expires > now() + 60e3) return token.value;
    let key: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
    try { key = JSON.parse(await readFile(config.credentialsFile, 'utf8')); } catch { throw new Error('Google service-account file is unreadable'); }
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') throw new Error('Google service-account file is incomplete');
    const aud = typeof key.token_uri === 'string' && /^https:\/\/oauth2\.googleapis\.com\/token$/.test(key.token_uri) ? key.token_uri : 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iss: key.client_email, scope: GOOGLE_SCOPES.join(' '), aud, iat, exp: iat + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
    const response = await fetchImpl(aud, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }),
      signal: AbortSignal.timeout(30e3),
    });
    // Never read the body of a failure: auth errors can echo the assertion.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Google token HTTP ${response.status}`); }
    const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string') throw new Error('Google token response is malformed');
    token = { value: json.access_token, expires: now() + Number(json.expires_in ?? 0) * 1000 };
    return token.value;
  }
  return async (url, body) => {
    const response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60e3),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Google API HTTP ${response.status} for ${new URL(url).pathname}`); }
    return response.json();
  };
}
