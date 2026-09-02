const MARKER_PREFIX = '<!-- gitfox:v1:';

export function markerFor(kind: string, id: number): string {
  return `${MARKER_PREFIX}${kind}:${id} -->`;
}

export function hasMarker(commentBodies: string[], kind: string, id: number): boolean {
  const marker = markerFor(kind, id);
  return commentBodies.some((body) => body.includes(marker));
}
