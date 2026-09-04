const MARKER_PREFIX = '<!-- gitfox:v1:';

export function markerFor(kind: string, id: number, suffix?: string): string {
  const normalizedSuffix = suffix === undefined || suffix.trim() === '' ? '' : `:${suffix.trim()}`;
  return `${MARKER_PREFIX}${kind}:${id}${normalizedSuffix} -->`;
}

export function hasMarker(commentBodies: string[], kind: string, id: number, suffix?: string): boolean {
  const marker = markerFor(kind, id, suffix);
  return commentBodies.some((body) => body.includes(marker));
}

export function hasAnyMarker(commentBodies: string[], kind: string, id: number): boolean {
  const prefix = `${MARKER_PREFIX}${kind}:${id}`;
  return commentBodies.some((body) => body.includes(`${prefix} -->`) || body.includes(`${prefix}:`));
}

export function parseReviewedSha(commentBodies: string[], id: number): string | undefined {
  const regex = new RegExp(`${MARKER_PREFIX}pr-review:${id}:([0-9a-f]{40}) -->`, 'g');
  let sha: string | undefined;
  for (const body of commentBodies) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(body)) !== null) {
      sha = match[1];
    }
  }
  return sha;
}

export function isGitfoxMention(body: string): boolean {
  const normalized = body.toLowerCase();
  return normalized.includes('/gitfox') || normalized.includes('@gitfox');
}

