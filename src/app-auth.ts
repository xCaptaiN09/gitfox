import { createSign } from 'node:crypto';
import { GitfoxError } from './errors';

export interface InstallationRef {
  owner: string;
  repo: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('\\n')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return trimmed;
}

export function createAppJwt(appId: string, privateKey: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const normalizedKey = normalizePrivateKey(privateKey);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: appId.trim()
    })
  );
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = base64url(signer.sign(normalizedKey));
    return `${header}.${payload}.${signature}`;
  } catch (error) {
    throw new GitfoxError('Failed to sign the GitHub App JWT — check that private-key contains the full PEM including BEGIN/END lines', { cause: error });
  }
}

async function githubAppFetch(jwt: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gitfox'
      }
    });
  } catch (error) {
    throw new GitfoxError(`Network error while authenticating the GitHub App at ${path}`, { cause: error });
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

export async function createAppToken(appId: string, privateKey: string, ref: InstallationRef): Promise<string> {
  const jwt = createAppJwt(appId, privateKey);
  const { status, body: installation } = await githubAppFetch(jwt, `/repos/${ref.owner}/${ref.repo}/installation`);
  if (status === 404) {
    throw new GitfoxError(`No GitHub App installation found for ${ref.owner}/${ref.repo} — install the app on the repository first`);
  }
  if (status !== 200) {
    const message = typeof installation.message === 'string' ? installation.message : `HTTP ${status}`;
    throw new GitfoxError(`GitHub App authentication failed at /repos/${ref.owner}/${ref.repo}/installation: ${message}`);
  }
  const installationId = installation.id;
  if (typeof installationId !== 'number') {
    throw new GitfoxError(`No GitHub App installation found for ${ref.owner}/${ref.repo} — install the app on the repository first`);
  }
  const { status: tokenStatus, body: tokenBody } = await githubAppFetch(jwt, `/app/installations/${installationId}/access_tokens`);
  if (tokenStatus !== 200 && tokenStatus !== 201) {
    const message = typeof tokenBody.message === 'string' ? tokenBody.message : `HTTP ${tokenStatus}`;
    throw new GitfoxError(`GitHub App token exchange failed: ${message}`);
  }
  const token = tokenBody.token;
  if (typeof token !== 'string' || token === '') {
    throw new GitfoxError('GitHub App token exchange returned no token');
  }
  return token;
}
