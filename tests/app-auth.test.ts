import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { createAppJwt, createAppToken, normalizePrivateKey } from '../src/app-auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('normalizePrivateKey', () => {
  it('converts literal backslash-n sequences into newlines', () => {
    const raw = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
    const normalized = normalizePrivateKey(raw);
    assert.ok(normalized.includes('-----BEGIN PRIVATE KEY-----\nabc\n'));
    assert.ok(!normalized.includes('\\n'));
  });

  it('trims whitespace and leaves real PEM untouched', () => {
    const pem = `  ${PRIVATE_PEM}  `;
    assert.equal(normalizePrivateKey(pem), PRIVATE_PEM.trim());
  });
});

describe('createAppJwt', () => {
  it('produces a verifiable RS256 JWT with correct claims', () => {
    const now = 1_700_000_000;
    const jwt = createAppJwt('12345', PRIVATE_PEM, now);
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    assert.ok(headerB64 !== undefined && payloadB64 !== undefined && signatureB64 !== undefined);

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(payload.iss, '12345');
    assert.equal(payload.iat, now - 60);
    assert.equal(payload.exp, now + 540);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    assert.equal(verifier.verify(PUBLIC_PEM, Buffer.from(signatureB64, 'base64url')), true);
  });

  it('throws a helpful error on an invalid key', () => {
    assert.throws(() => createAppJwt('12345', 'not a pem'), /private-key/i);
  });
});

describe('createAppToken', () => {
  it('exchanges the JWT for an installation token', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      const path = String(url).replace('https://api.github.com', '');
      const body = path.includes('access_tokens')
        ? { token: 'ghs_installation_token' }
        : { id: 42, slug: 'gitfox' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const token = await createAppToken('12345', PRIVATE_PEM, { owner: 'o', repo: 'r' });
      assert.equal(token, 'ghs_installation_token');
      assert.deepEqual(calls, ['https://api.github.com/repos/o/r/installation', 'https://api.github.com/app/installations/42/access_tokens']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails with a clear message when the app is not installed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      await assert.rejects(() => createAppToken('12345', PRIVATE_PEM, { owner: 'o', repo: 'r' }), /install the app/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
