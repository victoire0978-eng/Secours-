import { useCallback, useEffect, useState } from 'react';

/**
 * Système de stockage hors-ligne universel basé sur OPFS
 * (Origin Private File System - navigator.storage.getDirectory()).
 *
 * Fonctionne pour TOUS les types de fichiers : vidéos, audios, mangas/BD
 * (CBZ/CBR), images, archives (ZIP/RAR/7Z), documents (PDF/EPUB), etc.
 *
 * Volontairement, ce hook n'utilise JAMAIS showSaveFilePicker() ni
 * showDirectoryPicker() : uniquement l'API OPFS (navigator.storage.getDirectory()).
 */

export type OfflineFileType = 'video' | 'audio' | 'image' | 'manga' | 'archive' | 'doc' | 'other';

export interface OfflineFileRecord {
  id: string;
  filename: string;
  originalUrl: string;
  mimeType: string;
  type: OfflineFileType;
  size: number;
  channelId?: string;
  messageId?: number | string;
  savedAt: string;
}

export interface OfflineSaveMeta {
  channelId?: string;
  messageId?: number | string;
  /** Force un type au lieu de le détecter automatiquement. */
  type?: OfflineFileType;
}

export interface OfflinePlaybackResult {
  blobUrl: string;
  blob: Blob;
  type: OfflineFileType;
}

export interface OfflineStorageUsage {
  usage: number;
  quota: number;
  percent: number;
}

const STORAGE_KEY = 'offline_files';
const OPFS_ROOT_DIR = 'nlsbox_offline';
const OPFS_WRITE_CHUNK_SIZE = 512 * 1024; // 512KB, comme demandé par le cahier des charges
const OPFS_UNSUPPORTED_MESSAGE = "Le stockage hors-ligne (OPFS) n'est pas disponible sur ce navigateur.";

const FILES_CHANGED_EVENT = 'nlsbox:offline-files-changed';
const PROGRESS_EVENT = 'nlsbox:offline-progress';

interface OfflineProgressDetail {
  id: string;
  percent: number | null;
}

// ---------------------------------------------------------------------------
// Détection automatique du type à partir de l'extension / du mime-type
// ---------------------------------------------------------------------------

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', '3gp', 'ogv', 'm2ts', 'vob', 'mpg', 'mpeg',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'wma', 'alac', 'aiff',
]);
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic', 'tiff', 'tif', 'ico', 'jfif', 'avif',
]);
const MANGA_EXTENSIONS = new Set(['cbz', 'cbr', 'cb7', 'cbt']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'iso']);
const DOC_EXTENSIONS = new Set([
  'pdf', 'epub', 'txt', 'mobi', 'azw3', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf',
]);

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
  webm: 'video/webm', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', m4v: 'video/x-m4v',
  ts: 'video/mp2t', '3gp': 'video/3gpp', ogv: 'video/ogg', m2ts: 'video/mp2t', vob: 'video/dvd',
  mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', opus: 'audio/opus', wma: 'audio/x-ms-wma', alac: 'audio/alac', aiff: 'audio/aiff',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', tiff: 'image/tiff', tif: 'image/tiff',
  ico: 'image/x-icon', jfif: 'image/jpeg', avif: 'image/avif',
  cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar',
  cb7: 'application/x-cb7', cbt: 'application/x-cbt',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip', iso: 'application/x-iso9660-image',
  pdf: 'application/pdf', epub: 'application/epub+zip', txt: 'text/plain',
  mobi: 'application/x-mobipocket-ebook', azw3: 'application/vnd.amazon.ebook',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
};

function getFileExtension(filename: string): string {
  if (!filename) return '';
  const clean = filename.split(/[?#]/)[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

/** Devine un mime-type plausible à partir du nom de fichier (utile quand le mime n'est pas connu). */
export function guessMimeTypeFromFilename(filename: string): string {
  const ext = getFileExtension(filename);
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Détecte automatiquement le type (vidéo/audio/manga/etc.) depuis l'extension puis le mime-type. */
export function detectOfflineFileType(filename: string, mimeType?: string): OfflineFileType {
  const ext = getFileExtension(filename);

  if (ext) {
    // Les mangas/BD (.cbz/.cbr) sont vérifiés avant les archives génériques
    // car un .cbz est techniquement un zip mais doit rester classé "manga".
    if (MANGA_EXTENSIONS.has(ext)) return 'manga';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
    if (DOC_EXTENSIONS.has(ext)) return 'doc';
  }

  const mime = (mimeType || '').toLowerCase();
  if (mime) {
    if (mime.includes('comicbook') || mime.includes('cbz') || mime.includes('cbr')) return 'manga';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
    if (
      mime.includes('zip') || mime.includes('rar') || mime.includes('7z') ||
      mime.includes('tar') || mime.includes('gzip') || mime.includes('iso')
    ) {
      return 'archive';
    }
    if (
      mime === 'application/pdf' || mime.includes('epub') || mime.startsWith('text/') ||
      mime.includes('word') || mime.includes('excel') || mime.includes('powerpoint') ||
      mime.includes('opendocument') || mime.includes('rtf') || mime.includes('mobipocket') || mime.includes('ebook')
    ) {
      return 'doc';
    }
  }

  return 'other';
}

/** Formatte une taille en octets vers une chaîne lisible (Mo/Go), cohérent avec le reste de l'app. */
export function formatOfflineSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Mo';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} Go`;
  }
  return `${mb.toFixed(1)} Mo`;
}

/** Vrai si l'API OPFS (navigator.storage.getDirectory) est disponible. */
export function isOfflineStorageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sanitizeForOPFS(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_').trim() || 'file';
}

/**
 * Construit un identifiant unique et stable pour un fichier hors-ligne.
 * On ne se contente pas du filename brut car deux fichiers de channels/messages
 * différents peuvent porter le même nom.
 */
export function buildOfflineId(filename: string, channelId?: string, messageId?: number | string): string {
  const base = `${channelId ?? 'x'}_${messageId ?? 'x'}_${filename}`;
  const safeName = sanitizeForOPFS(filename).slice(0, 60);
  return `${simpleHash(base)}_${safeName}`;
}

// ---------------------------------------------------------------------------
// Index localStorage ("offline_files")
// ---------------------------------------------------------------------------

function readOfflineIndex(): OfflineFileRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[useOfflineManager] offline_files index illisible', err);
    return [];
  }
}

function notifyFilesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
  }
}

function writeOfflineIndex(list: OfflineFileRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch (err) {
    console.warn('[useOfflineManager] Impossible de sauvegarder offline_files', err);
  }
  notifyFilesChanged();
}

function upsertOfflineRecord(record: OfflineFileRecord): void {
  const list = readOfflineIndex();
  const idx = list.findIndex((f) => f.id === record.id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }
  writeOfflineIndex(list);
}

function removeOfflineRecord(id: string): void {
  const list = readOfflineIndex().filter((f) => f.id !== id);
  writeOfflineIndex(list);
}

function findOfflineRecord(idOrFilename: string): OfflineFileRecord | null {
  const list = readOfflineIndex();
  return (
    list.find((f) => f.id === idOrFilename) ||
    list.find((f) => f.filename === idOrFilename) ||
    null
  );
}

// ---------------------------------------------------------------------------
// Bus d'évènements (progression + synchronisation multi-composants dans le
// même onglet ; l'évènement natif "storage" ne se déclenche que pour les
// AUTRES onglets, il faut donc notre propre évènement pour le même onglet).
// ---------------------------------------------------------------------------

const progressStore: Record<string, number> = {};

function emitProgress(id: string, percent: number | null): void {
  if (percent === null) {
    delete progressStore[id];
  } else {
    progressStore[id] = percent;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<OfflineProgressDetail>(PROGRESS_EVENT, { detail: { id, percent } }));
  }
}

// ---------------------------------------------------------------------------
// OPFS : accès au répertoire dédié + écriture par chunks de 512KB
// ---------------------------------------------------------------------------

async function getOfflineDirectoryHandle(create: boolean): Promise<FileSystemDirectoryHandle> {
  if (!isOfflineStorageSupported()) {
    throw new Error(OPFS_UNSUPPORTED_MESSAGE);
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_ROOT_DIR, { create });
}

async function writeStreamInChunks(
  stream: ReadableStream<Uint8Array>,
  writable: FileSystemWritableFileStream,
  onProgress?: (loadedBytes: number) => void
): Promise<number> {
  const reader = stream.getReader();
  let pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  let writtenBytes = 0;

  const flush = async (size: number) => {
    const merged = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pendingChunks) {
      merged.set(part, offset);
      offset += part.length;
    }
    const toWrite = merged.subarray(0, size);
    const remainder = merged.subarray(size);
    await writable.write(toWrite);
    writtenBytes += toWrite.length;
    pendingChunks = remainder.length > 0 ? [remainder] : [];
    pendingBytes = remainder.length;
    onProgress?.(writtenBytes);
  };

  // On ne fait pas confiance aux frontières de chunks réseau : on bufferise
  // puis on écrit par blocs de exactement 512KB (sauf le tout dernier).
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      pendingChunks.push(value);
      pendingBytes += value.length;
      while (pendingBytes >= OPFS_WRITE_CHUNK_SIZE) {
        await flush(OPFS_WRITE_CHUNK_SIZE);
      }
    }
  }

  if (pendingBytes > 0) {
    await flush(pendingBytes);
  }

  return writtenBytes;
}

const activeSaves = new Map<string, Promise<OfflineFileRecord>>();

async function performSaveStream(
  id: string,
  url: string,
  filename: string,
  mimeType: string,
  meta: OfflineSaveMeta,
  stream: ReadableStream<Uint8Array>,
  totalBytes: number
): Promise<OfflineFileRecord> {
  emitProgress(id, 0);
  let dirHandle: FileSystemDirectoryHandle | null = null;
  let writable: FileSystemWritableFileStream | null = null;

  try {
    const type = meta.type || detectOfflineFileType(filename, mimeType);

    dirHandle = await getOfflineDirectoryHandle(true);
    const fileHandle = await dirHandle.getFileHandle(id, { create: true });
    writable = await fileHandle.createWritable();

    const writtenBytes = await writeStreamInChunks(stream, writable, (loaded) => {
      const percent = totalBytes > 0 ? Math.min(99, Math.round((loaded / totalBytes) * 100)) : 0;
      emitProgress(id, percent);
    });

    await writable.close();
    writable = null;

    const record: OfflineFileRecord = {
      id,
      filename,
      originalUrl: url,
      mimeType: mimeType || guessMimeTypeFromFilename(filename),
      type,
      size: totalBytes || writtenBytes,
      channelId: meta.channelId,
      messageId: meta.messageId,
      savedAt: new Date().toISOString(),
    };

    upsertOfflineRecord(record);
    emitProgress(id, 100);
    return record;
  } catch (err) {
    if (writable) {
      await writable.abort().catch(() => {});
    }
    if (dirHandle) {
      await dirHandle.removeEntry(id).catch(() => {});
    }
    throw err;
  } finally {
    setTimeout(() => emitProgress(id, null), 400);
  }
}

async function performSave(
  id: string,
  url: string,
  filename: string,
  mimeType: string,
  meta: OfflineSaveMeta
): Promise<OfflineFileRecord> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement impossible (HTTP ${response.status})`);
  }

  return performSaveStream(
    id,
    url,
    filename,
    mimeType,
    meta,
    response.body,
    Number(response.headers.get('content-length') || 0)
  );
}

async function saveOfflineCore(
  url: string,
  filename: string,
  mimeType: string,
  meta: OfflineSaveMeta = {}
): Promise<OfflineFileRecord> {
  if (!isOfflineStorageSupported()) {
    throw new Error(OPFS_UNSUPPORTED_MESSAGE);
  }

  const id = buildOfflineId(filename, meta.channelId, meta.messageId);

  const existingTask = activeSaves.get(id);
  if (existingTask) return existingTask;

  const task = performSave(id, url, filename, mimeType, meta);
  activeSaves.set(id, task);
  try {
    return await task;
  } finally {
    activeSaves.delete(id);
  }
}

async function saveOfflineBlobCore(
  blob: Blob,
  originalUrl: string,
  filename: string,
  mimeType: string,
  meta: OfflineSaveMeta = {}
): Promise<OfflineFileRecord> {
  if (!isOfflineStorageSupported()) {
    throw new Error(OPFS_UNSUPPORTED_MESSAGE);
  }

  const id = buildOfflineId(filename, meta.channelId, meta.messageId);
  const existingTask = activeSaves.get(id);
  if (existingTask) return existingTask;

  const task = performSaveStream(
    id,
    originalUrl,
    filename,
    mimeType,
    meta,
    blob.stream(),
    blob.size
  );
  activeSaves.set(id, task);
  try {
    return await task;
  } finally {
    activeSaves.delete(id);
  }
}

async function playOfflineCore(filename: string): Promise<OfflinePlaybackResult | null> {
  const record = findOfflineRecord(filename);
  if (!record) return null;
  const dirHandle = await getOfflineDirectoryHandle(false);
  const fileHandle = await dirHandle.getFileHandle(record.id);
  const file = await fileHandle.getFile();

  // `FileSystemFileHandle.getFile()` ne garantit PAS un `file.type` fiable :
  // selon le navigateur (en particulier iOS Safari), le type MIME déduit
  // d'un fichier OPFS est souvent vide. Un blob sans type (ou mal typé)
  // provoque "le navigateur n'a pas pu décoder" sur <video>/<audio>, et sur
  // iOS le prompt système "Voulez-vous télécharger ou lire cette URL ?" au
  // lieu d'une lecture inline. On force donc le vrai mime-type mémorisé à
  // l'enregistrement (déterminé de façon fiable depuis l'extension au moment
  // de la sauvegarde).
  const mimeType = record.mimeType || guessMimeTypeFromFilename(record.filename);
  const blob = file.type === mimeType ? file : new Blob([file], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, blob, type: record.type };
}

async function deleteOfflineCore(filename: string): Promise<boolean> {
  const record = findOfflineRecord(filename);
  if (!record) return false;
  try {
    const dirHandle = await getOfflineDirectoryHandle(false);
    await dirHandle.removeEntry(record.id);
  } catch (err) {
    console.warn('[useOfflineManager] Suppression OPFS impossible', err);
  }
  removeOfflineRecord(record.id);
  emitProgress(record.id, null);
  return true;
}

async function getStorageUsageCore(): Promise<OfflineStorageUsage> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      return { usage, quota, percent: quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0 };
    } catch (err) {
      console.warn('[useOfflineManager] storage.estimate() indisponible', err);
    }
  }
  // Repli : on additionne les tailles connues de l'index localStorage.
  const usage = readOfflineIndex().reduce((acc, item) => acc + (item.size || 0), 0);
  return { usage, quota: 0, percent: 0 };
}

// ---------------------------------------------------------------------------
// Hook React
// ---------------------------------------------------------------------------

export function useOfflineManager() {
  const [files, setFiles] = useState<OfflineFileRecord[]>(() => readOfflineIndex());
  const [progressMap, setProgressMap] = useState<Record<string, number>>(() => ({ ...progressStore }));
  const [storageUsage, setStorageUsage] = useState<OfflineStorageUsage>({ usage: 0, quota: 0, percent: 0 });
  const [isSupported] = useState<boolean>(() => isOfflineStorageSupported());

  const refresh = useCallback(() => {
    setFiles(readOfflineIndex());
  }, []);

  const refreshStorageUsage = useCallback(async (): Promise<OfflineStorageUsage> => {
    const usage = await getStorageUsageCore();
    setStorageUsage(usage);
    return usage;
  }, []);

  useEffect(() => {
    refreshStorageUsage();
  }, [refreshStorageUsage]);

  useEffect(() => {
    const onFilesChanged = () => refresh();
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<OfflineProgressDetail>).detail;
      if (!detail) return;
      setProgressMap((prev) => {
        if (detail.percent === null) {
          if (!(detail.id in prev)) return prev;
          const next = { ...prev };
          delete next[detail.id];
          return next;
        }
        return { ...prev, [detail.id]: detail.percent };
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) refresh();
    };

    window.addEventListener(FILES_CHANGED_EVENT, onFilesChanged);
    window.addEventListener(PROGRESS_EVENT, onProgress as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FILES_CHANGED_EVENT, onFilesChanged);
      window.removeEventListener(PROGRESS_EVENT, onProgress as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  /**
   * Télécharge `url` en flux (ReadableStream) et l'écrit par chunks de 512KB
   * dans OPFS. Détecte automatiquement le type depuis l'extension/mime.
   */
  const saveOffline = useCallback(
    async (url: string, filename: string, mimeType: string, meta?: OfflineSaveMeta): Promise<OfflineFileRecord> => {
      const record = await saveOfflineCore(url, filename, mimeType, meta);
      refresh();
      refreshStorageUsage();
      return record;
    },
    [refresh, refreshStorageUsage]
  );

  /**
   * Écrit un blob déjà téléchargé dans OPFS sans refaire de requête réseau.
   * Utilisé par le bouton combiné appareil + hors-ligne.
   */
  const saveOfflineBlob = useCallback(
    async (
      blob: Blob,
      originalUrl: string,
      filename: string,
      mimeType: string,
      meta?: OfflineSaveMeta
    ): Promise<OfflineFileRecord> => {
      const record = await saveOfflineBlobCore(blob, originalUrl, filename, mimeType, meta);
      refresh();
      refreshStorageUsage();
      return record;
    },
    [refresh, refreshStorageUsage]
  );

  /** Retourne { blobUrl, blob, type } prêt à être utilisé dans un <video>/<audio>/<img>. */
  const playOffline = useCallback((filename: string): Promise<OfflinePlaybackResult | null> => {
    return playOfflineCore(filename);
  }, []);

  /** Supprime le fichier d'OPFS et son entrée dans l'index localStorage. */
  const deleteOffline = useCallback(
    async (filename: string): Promise<boolean> => {
      const removed = await deleteOfflineCore(filename);
      refresh();
      refreshStorageUsage();
      return removed;
    },
    [refresh, refreshStorageUsage]
  );

  /** Liste complète des fichiers hors-ligne (lecture directe de l'index). */
  const getOfflineFiles = useCallback((): OfflineFileRecord[] => readOfflineIndex(), []);

  /** Espace utilisé/quota via navigator.storage.estimate(). */
  const getStorageUsage = useCallback((): Promise<OfflineStorageUsage> => refreshStorageUsage(), [refreshStorageUsage]);

  const isFileOffline = useCallback(
    (filename: string, channelId?: string, messageId?: number | string): boolean => {
      const id = buildOfflineId(filename, channelId, messageId);
      return files.some((f) => f.id === id || f.filename === filename);
    },
    [files]
  );

  const getProgress = useCallback(
    (filename: string, channelId?: string, messageId?: number | string): number | undefined => {
      const id = buildOfflineId(filename, channelId, messageId);
      return progressMap[id];
    },
    [progressMap]
  );

  /** Supprime tous les fichiers hors-ligne (utilisé par la page /offline). */
  const clearAll = useCallback(async (): Promise<void> => {
    const list = readOfflineIndex();
    for (const record of list) {
      await deleteOfflineCore(record.filename);
    }
    refresh();
    refreshStorageUsage();
  }, [refresh, refreshStorageUsage]);

  return {
    isSupported,
    files,
    storageUsage,
    saveOffline,
    saveOfflineBlob,
    playOffline,
    deleteOffline,
    getOfflineFiles,
    getStorageUsage,
    refresh,
    isFileOffline,
    getProgress,
    buildOfflineId,
    clearAll,
  };
}
