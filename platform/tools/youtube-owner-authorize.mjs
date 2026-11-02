#!/usr/bin/env node
/**
 * One-time grant for removing handled items from the 加入直播 playlist (youtube.live.playlist).
 *
 *   node tools/youtube-owner-authorize.mjs --client=/path/client_secret_XXX.json --out=/path/youtube-owner.json
 *
 * --client: the OAuth client JSON downloaded from Google Cloud Console (type "Desktop app").
 * --out:    where to write {client_id, client_secret, refresh_token}; created 0600 and never overwritten.
 * --channel (optional, default the 有影儀表板 channel): the grant must belong to this channel, or nothing is written.
 *
 * Open the printed URL, sign in, choose the 有影儀表板 channel and allow access. When the browser runs on this machine the
 * redirect is caught on 127.0.0.1; otherwise copy the address of the page the browser lands on (it fails to load) and paste it
 * here. The refresh token is written only to --out and never printed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const DEFAULT_CHANNEL = 'UCexfBb1TxA35MHOGF8WgknQ';
const PORT = 8765, REDIRECT = `http://127.0.0.1:${PORT}/`;

export function parseClient(text) {
  const json = JSON.parse(text), c = json.installed ?? json.web ?? json;
  if (typeof c.client_id !== 'string' || !/\.apps\.googleusercontent\.com$/.test(c.client_id) || typeof c.client_secret !== 'string' || !c.client_secret) throw new Error('Not an OAuth client JSON (expected a Desktop app client with client_id and client_secret)');
  return { clientId: c.client_id, clientSecret: c.client_secret };
}
export function authorizationUrl(clientId, challenge, state) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state });
}
/** The code from a pasted redirect address, only when its state matches. */
export function codeFrom(address, state) {
  let url; try { url = new URL(address.trim()); } catch { return null; }
  if (url.searchParams.get('state') !== state) return null;
  if (url.searchParams.get('error')) throw new Error('Authorization refused: ' + url.searchParams.get('error'));
  return url.searchParams.get('code');
}

async function main() {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const clientFile = arg('client'), out = arg('out'), channel = arg('channel') ?? DEFAULT_CHANNEL;
  if (!clientFile || !out || !out.startsWith('/')) throw new Error('Usage: --client=<client JSON> --out=<absolute output path> [--channel=UC…]');
  const { clientId, clientSecret } = parseClient(await readFile(clientFile, 'utf8'));
  const verifier = randomBytes(48).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url'), state = randomBytes(16).toString('hex');
  // Fail early if the output exists, before anyone signs in.
  const handle = await open(out, 'wx', 0o600);
  let done = false;
  // Ctrl-C or a kill skips `finally`: remove the unfinished file so the next attempt can create it.
  const abort = () => { if (!done) { try { unlinkSync(out); } catch { /* already gone */ } } process.exit(130); };
  process.once('SIGINT', abort); process.once('SIGTERM', abort); process.once('SIGHUP', abort);
  try {
    console.log('\nOpen this address, sign in, choose the 有影儀表板 channel and allow access:\n\n' + authorizationUrl(clientId, challenge, state) + '\n');
    console.log('If the browser is on another machine, paste the address it lands on (http://127.0.0.1:8765/?state=…) here:');
    let close = () => undefined;
    const code = await new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        try {
          const found = codeFrom(new URL(req.url ?? '/', REDIRECT).toString(), state);
          if (!found) { res.writeHead(400).end('Unexpected request'); return; }
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('已收到授權，可以關閉這個分頁。');
          resolve(found);
        } catch (error) { res.writeHead(400).end('Authorization refused'); reject(error); }
      });
      server.on('error', () => { /* port busy: pasting still works */ });
      server.listen(PORT, '127.0.0.1');
      const rl = createInterface({ input: process.stdin });
      rl.on('line', line => { try { const found = codeFrom(line, state); if (found) resolve(found); else console.log('That address does not carry this request\'s code; try again.'); } catch (error) { reject(error); } });
      const timer = setTimeout(() => reject(new Error('Timed out after 10 minutes')), 600000);
      close = () => { clearTimeout(timer); server.close(); rl.close(); };
    }).finally(() => close());
    const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT }) }).then(r => r.json());
    if (typeof token.refresh_token !== 'string' || typeof token.access_token !== 'string') throw new Error('No refresh token returned' + (token.error ? ': ' + token.error : ''));
    if (!String(token.scope ?? '').split(' ').includes(SCOPE)) throw new Error('The grant does not include ' + SCOPE + ' (was the box left unticked?)');
    const me = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { Authorization: `Bearer ${token.access_token}` } }).then(r => r.json());
    const mine = (me.items ?? []).map(item => ({ id: item.id, title: item.snippet?.title }));
    if (!mine.some(item => item.id === channel)) throw new Error(`The grant belongs to ${JSON.stringify(mine)}, not ${channel}. Sign in again and choose the 有影儀表板 channel.`);
    await handle.writeFile(JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: token.refresh_token }) + '\n');
    done = true;
    console.log(`\nGranted by ${mine.find(item => item.id === channel).title} (${channel}). Credentials written to ${out} (0600).`);
  } finally {
    await handle.close();
    if (!done) { const { unlink } = await import('node:fs/promises'); await unlink(out).catch(() => undefined); }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().then(() => process.exit(0), error => { console.error(String(error.message ?? error)); process.exit(1); });
