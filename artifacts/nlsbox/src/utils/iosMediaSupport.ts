import { OfflineFileType } from '../hooks/useOfflineManager';

export type IOSMediaPlayback = 'native' | 'external';

const EXTENSION_MIME_CANDIDATES: Record<string, string[]> = {
  mp4: ['video/mp4'],
  m4v: ['video/x-m4v', 'video/mp4'],
  mov: ['video/quicktime', 'video/mp4'],
  webm: ['video/webm'],
  mp3: ['audio/mpeg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  aac: ['audio/aac', 'audio/mp4'],
  wav: ['audio/wav', 'audio/x-wav'],
  aif: ['audio/aiff'],
  aiff: ['audio/aiff'],
  flac: ['audio/flac'],
  ogg: ['audio/ogg'],
  opus: ['audio/opus'],
};

function getExtension(filename: string): string {
  const match = filename.toLowerCase().split(/[?#]/)[0].match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

/**
 * Safari can report that a container is playable even when a particular
 * codec inside it is not. This is still the best local, no-network signal
 * available to a PWA; the media element's error handler remains authoritative.
 */
export function canPlayLocallyOnIOS(
  filename: string,
  mimeType: string,
  type: Extract<OfflineFileType, 'video' | 'audio'>
): boolean {
  if (typeof document === 'undefined') return true;

  const element = document.createElement(type);
  const extension = getExtension(filename);
  const candidates = [
    mimeType,
    ...(EXTENSION_MIME_CANDIDATES[extension] || []),
  ].filter(Boolean);

  return candidates.some((candidate) => {
    const result = element.canPlayType(candidate);
    return result === 'probably' || result === 'maybe';
  });
}

export function getIOSExternalReaderHint(
  filename: string,
  type: Extract<OfflineFileType, 'video' | 'audio'>
): string {
  const extension = getExtension(filename).toUpperCase();
  if (type === 'video') {
    return `${extension || 'Ce format'} n'est pas décodable par Safari iOS. Utilisez Ouvrir pour envoyer le fichier à VLC ou Infuse.`;
  }
  return `${extension || 'Ce format audio'} n'est pas décodable par Safari iOS. Utilisez Ouvrir pour l'envoyer à VLC ou une autre application audio.`;
}