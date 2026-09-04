import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from './errors';
import type { GitfoxConfig } from './types';

const RULES_MAX_CHARS = 8000;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function parseBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new ConfigError(`Environment variable ${key} must be a boolean (true/false), got: ${raw}`);
}

function parseIntEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`Environment variable ${key} must be an integer between ${min} and ${max}, got: ${raw}`);
  }
  return parsed;
}

function loadRulesContent(rulesPath: string): string {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (workspace === undefined || workspace.trim() === '') {
    return '';
  }
  const absolutePath = join(workspace, rulesPath);
  if (!existsSync(absolutePath)) {
    return '';
  }
  try {
    return readFileSync(absolutePath, 'utf8').slice(0, RULES_MAX_CHARS);
  } catch (error) {
    throw new ConfigError(`Failed to read rules file at ${absolutePath}`, { cause: error });
  }
}

export function loadConfig(): GitfoxConfig {
  const ollamaUrl = (process.env.GITFOX_OLLAMA_URL ?? 'http://127.0.0.1:11434').trim();
  try {
    const parsedUrl = new URL(ollamaUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new ConfigError(`GITFOX_OLLAMA_URL must use http or https, got: ${parsedUrl.protocol}`);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`GITFOX_OLLAMA_URL is not a valid URL: ${ollamaUrl}`, { cause: error });
  }

  const rulesPath = (process.env.GITFOX_RULES_PATH ?? '.gitfox/rules.md').trim();

  return {
    token: requireEnv('GITFOX_GITHUB_TOKEN'),
    model: requireEnv('GITFOX_MODEL'),
    rulesPath,
    rulesContent: loadRulesContent(rulesPath),
    scanAll: parseBoolEnv('GITFOX_SCAN_ALL', false),
    maxScanItems: parseIntEnv('GITFOX_MAX_SCAN_ITEMS', 10, 1, 100),
    maxComments: parseIntEnv('GITFOX_MAX_COMMENTS', 10, 1, 50),
    ollamaUrl: ollamaUrl.replace(/\/+$/, ''),
    postSuggestions: parseBoolEnv('GITFOX_POST_SUGGESTIONS', true),
    searchFixed: parseBoolEnv('GITFOX_SEARCH_FIXED', true),
    inlineComments: parseBoolEnv('GITFOX_INLINE_COMMENTS', true),
    requestChanges: parseBoolEnv('GITFOX_REQUEST_CHANGES', false),
    repoContext: parseBoolEnv('GITFOX_REPO_CONTEXT', true),
    progressReactions: parseBoolEnv('GITFOX_PROGRESS_REACTIONS', true),
    incrementalReview: parseBoolEnv('GITFOX_INCREMENTAL_REVIEW', true)
  };
}
