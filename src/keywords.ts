const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'up', 'about',
  'into', 'over', 'after', 'this', 'that', 'these', 'those', 'it', 'its',
  'not', 'no', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'when', 'how', 'what', 'why', 'fix', 'fixes', 'add', 'adds', 'added'
]);

export function extractKeywords(text: string, maxKeywords: number = 6): string[] {
  const seen = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));

  for (const word of words) {
    const cleaned = word.replace(/[._/-]+$/, '');
    if (cleaned.length >= 4 && !seen.has(cleaned)) {
      seen.add(cleaned);
    }
    if (seen.size >= maxKeywords) {
      break;
    }
  }
  return [...seen];
}
