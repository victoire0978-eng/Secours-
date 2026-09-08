import { Episode } from '../types';
import type { DownloadProgressUpdate } from '../types';
import { sanitizeFileName } from './sanitizeTitle';

/**
 * Extracts channel and messageId from an episode
 */
export function extractEpisodeMediaIds(episode: Episode): { channel: string; messageId: string | number } {
  let channel = (episode.channel || '').trim().replace(/^@/, '');
  let messageId: string | number = episode.message_id;

  if (!channel && episode.download_url) {
    const match = episode.download_url.match(/\/download\/([^/]+)\/(\d+)/);
    if (match) {
      channel = match[1];
      if (!messageId) messageId = match[2];
    }
  }

  if (!channel) {
    channel = 'animes_vostfr';
  }

  return { channel, messageId };
}

/**
 * Generates the local backend download URL which sets Content-Disposition: attachment
 * to force mobile & desktop browsers to save the file into device internal storage (Downloads folder).
 */
export function getInternalStorageDownloadUrl(episode: Episode, _backendUrl?: string): string {
  const { channel, messageId } = extractEpisodeMediaIds(episode);
  const fileName = sanitizeFileName(episode.file_name, episode.title);
  return `/api/download/${encodeURIComponent(channel)}/${encodeURIComponent(messageId)}?filename=${encodeURIComponent(fileName)}`;
}

/**
 * Generates the local inline view URL for PDFs, images, manga scans, and documents
 */
export function getFileViewUrl(episode: Episode, _backendUrl?: string): string {
  const { channel, messageId } = extractEpisodeMediaIds(episode);
  const fileName = sanitizeFileName(episode.file_name, episode.title);
  return `/api/view/${encodeURIComponent(channel)}/${encodeURIComponent(messageId)}?filename=${encodeURIComponent(fileName)}`;
}

/**
 * Secure stream/download URL that never leaks the raw remote backend host
 */
export function getDirectRemoteDownloadUrl(episode: Episode, _backendUrl?: string): string {
  return getInternalStorageDownloadUrl(episode);
}

/**
 * VLC URL scheme to open stream directly in VLC app through local proxy
 */
export function getVlcStreamUrl(episode: Episode, _backendUrl?: string): string {
  const { channel, messageId } = extractEpisodeMediaIds(episode);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const streamUrl = `${origin}/api/stream/${encodeURIComponent(channel)}/${encodeURIComponent(messageId)}`;
  return `vlc://${streamUrl}`;
}

/**
 * Android Intent to open stream directly in any native Android video player (MX Player, VLC, Samsung Video, etc.)
 */
export function getAndroidIntentUrl(episode: Episode, _backendUrl?: string): string {
  const { channel, messageId } = extractEpisodeMediaIds(episode);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const streamUrl = `${origin}/api/stream/${encodeURIComponent(channel)}/${encodeURIComponent(messageId)}`;
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
}

/**
 * Triggers an actual browser download that places the video file directly into the device's storage.
 */
export function triggerDeviceDownload(episode: Episode, _backendUrl?: string): boolean {
  try {
    const downloadUrl = getInternalStorageDownloadUrl(episode);
    const fileName = sanitizeFileName(episode.file_name, episode.title);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', fileName);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 2000);

    return true;
  } catch (err) {
    console.error('[Download] Failed to trigger device download:', err);
    // Fallback: window.open
    try {
      const fallbackUrl = getInternalStorageDownloadUrl(episode);
      window.open(fallbackUrl, '_blank');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Triggers a device download from an already-fetched blob.
 * Callers can reuse the same blob for another destination without fetching it again.
 */
export function triggerBlobDeviceDownload(blob: Blob, fileName: string): boolean {
  try {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.setAttribute('download', fileName);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 2000);

    return true;
  } catch (err) {
    console.error('[Download] Failed to trigger blob device download:', err);
    return false;
  }
}

/**
 * Reads a response progressively so download UIs can show network progress
 * before the blob is handed to device/offline storage.
 */
export async function fetchBlobWithProgress(
  url: string,
  onProgress?: (progress: DownloadProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Téléchargement impossible (HTTP ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  const totalBytes = Number(response.headers.get('content-length') || 0);

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      phase: 'network',
      loadedBytes: blob.size,
      totalBytes: blob.size,
      percent: 100,
      bytesPerSecond: 0,
    });
    return { blob, contentType: contentType || blob.type };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  onProgress?.({
    phase: 'network',
    loadedBytes: 0,
    totalBytes,
    percent: totalBytes > 0 ? 0 : null,
    bytesPerSecond: 0,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      chunks.push(value);
      receivedBytes += value.length;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
      onProgress?.({
        phase: 'network',
        loadedBytes: receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null,
        bytesPerSecond: receivedBytes / elapsedSeconds,
      });
    }
  }

  const blob = new Blob(chunks as BlobPart[], { type: contentType || undefined });
  onProgress?.({
    phase: 'network',
    loadedBytes: receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    percent: 100,
    bytesPerSecond: 0,
  });
  return { blob, contentType: contentType || blob.type };
}
