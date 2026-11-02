import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, codeFrom, parseClient } from './youtube-owner-authorize.mjs';

test('youtube owner authorize: reads a Desktop client, asks for offline youtube.force-ssl with PKCE, takes only its own code', () => {
  assert.deepEqual(parseClient(JSON.stringify({ installed: { client_id: '1-a.apps.googleusercontent.com', client_secret: 's' } })), { clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' });
  assert.throws(() => parseClient('{"installed":{}}'));
  const url = new URL(authorizationUrl('1-a.apps.googleusercontent.com', 'chal', 'st'));
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.force-ssl');
  assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8765/');
  assert.equal(codeFrom('http://127.0.0.1:8765/?state=st&code=abc', 'st'), 'abc');
  assert.equal(codeFrom('http://127.0.0.1:8765/?state=other&code=abc', 'st'), null);
  assert.equal(codeFrom('not a url', 'st'), null);
  assert.throws(() => codeFrom('http://127.0.0.1:8765/?state=st&error=access_denied', 'st'), /access_denied/);
});
