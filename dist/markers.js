"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markerFor = markerFor;
exports.hasMarker = hasMarker;
exports.isGitfoxMention = isGitfoxMention;
const MARKER_PREFIX = '<!-- gitfox:v1:';
function markerFor(kind, id, suffix) {
    const normalizedSuffix = suffix === undefined || suffix.trim() === '' ? '' : `:${suffix.trim()}`;
    return `${MARKER_PREFIX}${kind}:${id}${normalizedSuffix} -->`;
}
function hasMarker(commentBodies, kind, id, suffix) {
    const marker = markerFor(kind, id, suffix);
    return commentBodies.some((body) => body.includes(marker));
}
function isGitfoxMention(body) {
    const normalized = body.toLowerCase();
    return normalized.includes('/gitfox') || normalized.includes('@gitfox');
}
