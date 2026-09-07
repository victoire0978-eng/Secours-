import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import {
  guessMimeTypeFromFilename,
  useOfflineManager,
  OfflineFileType,
} from '../hooks/useOfflineManager';
import { usePlatform } from '../hooks/usePlatform';
import { fetchBlobWithProgress } from '../utils/download';

interface IOSActionsProps {
  fileUrl: string;
  fileName: string;
  channelId?: string;
  messageId?: number | string;
  mimeType?: string;
  type?: OfflineFileType;
  initialBlob?: Blob | null;
  onRead?: (blobUrl: string, blob: Blob) => void;
  showRead?: boolean;
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * iOS-only actions. "Lire" keeps the user inside NLSbox and stores the same
 * blob offline; "Ouvrir" delegates to the native iOS share/open sheet.
 */
export const IOSActions: React.FC<IOSActionsProps> = ({
  fileUrl,
  fileName,
  channelId,
  messageId,
  mimeType = '',
  type,
  initialBlob = null,
  onRead,
  showRead = true,
  variant = 'compact',
  className = '',
}) => {
  const { isIOS } = usePlatform();
  const { saveOfflineBlob, getProgress } = useOfflineManager();
  const [isReading, setIsReading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [networkProgress, setNetworkProgress] = useState<number | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<'network' | 'offline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const blobCacheRef = useRef<{ key: string; blob: Blob } | null>(null);

  const fileKey = `${fileUrl}|${fileName}|${messageId ?? ''}`;
  const effectiveMimeType = mimeType || guessMimeTypeFromFilename(fileName);
  const offlineProgress = getProgress(fileName, channelId, messageId);
  const progress =
    downloadPhase === 'network'
      ? (typeof networkProgress === 'number' ? Math.round(networkProgress / 2) : null)
      : downloadPhase === 'offline'
        ? 50 + (typeof offlineProgress === 'number' ? Math.round(offlineProgress / 2) : 0)
        : null;

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    blobCacheRef.current = initialBlob ? { key: fileKey, blob: initialBlob } : null;
  }, [fileKey, initialBlob]);

  const getFileBlob = useCallback(
    async (onProgress?: (percent: number | null) => void): Promise<Blob> => {
    const cached = blobCacheRef.current;
      if (cached?.key === fileKey) {
        onProgress?.(100);
        return cached.blob;
      }

      if (!fileUrl) {
        throw new Error('Fichier indisponible');
      }

      const { blob } = await fetchBlobWithProgress(fileUrl, onProgress);
      blobCacheRef.current = { key: fileKey, blob };
      return blob;
    },
    [fileKey, fileUrl]
  );

  const handleRead = useCallback(async () => {
    if (!fileUrl || isReading) return;
    setError(null);
    setIsReading(true);
    setNetworkProgress(0);
    setDownloadPhase('network');

    try {
      const blob = await getFileBlob((percent) => {
        if (mountedRef.current) setNetworkProgress(percent);
      });

      const blobMimeType = blob.type || effectiveMimeType || 'application/octet-stream';
      const blobUrl = URL.createObjectURL(blob);

      setDownloadPhase('offline');
      try {
        await saveOfflineBlob(blob, fileUrl, fileName, blobMimeType, {
          channelId,
          messageId,
          type,
        });
      } catch (storageError) {
        // Reading remains available even on older iOS versions without OPFS.
        console.warn('[IOSActions] sauvegarde hors-ligne iOS indisponible', storageError);
        if (mountedRef.current) {
          setError('Lecture lancée, mais la sauvegarde hors-ligne est indisponible sur cet appareil.');
        }
      }

      onRead?.(blobUrl, blob);
    } catch (readError) {
      if (mountedRef.current) {
        setError(readError instanceof Error ? readError.message : 'Lecture impossible');
      }
    } finally {
      if (mountedRef.current) {
        setIsReading(false);
        setDownloadPhase(null);
        setNetworkProgress(null);
      }
    }
  }, [
    channelId,
    effectiveMimeType,
    fileName,
    fileUrl,
    getFileBlob,
    isReading,
    messageId,
    onRead,
    saveOfflineBlob,
    type,
  ]);

  const handleOpen = useCallback(async () => {
    if (!fileUrl || isOpening) return;
    setError(null);
    setIsOpening(true);
    setNetworkProgress(0);
    setDownloadPhase('network');

    try {
      const blob = await getFileBlob((percent) => {
        if (mountedRef.current) setNetworkProgress(percent);
      });
      const file = new File([blob], fileName || 'nlsbox-file', {
        type: blob.type || effectiveMimeType || 'application/octet-stream',
      });

      // iOS only shares the actual file when `files` is used. Passing `url`
      // here would reproduce the old behaviour: the share sheet receives a
      // link to the server instead of the selected media.
      const canShareFile =
        typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      if (canShareFile) {
        await navigator.share({ files: [file], title: file.name });
      } else {
        // Keep the fallback local: never send the server URL to the share
        // sheet. This opens the actual downloaded bytes when file sharing is
        // unavailable on an older iOS/WebKit version.
        const blobUrl = URL.createObjectURL(blob);
        const openedWindow = window.open(blobUrl, '_blank', 'noopener,noreferrer');
        if (!openedWindow) {
          const anchor = document.createElement('a');
          anchor.href = blobUrl;
          anchor.download = file.name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch (openError: any) {
      // Closing the native share sheet is not an application error.
      if (openError?.name !== 'AbortError' && mountedRef.current) {
        setError(openError instanceof Error ? openError.message : 'Ouverture impossible');
      }
    } finally {
      if (mountedRef.current) {
        setIsOpening(false);
        setDownloadPhase(null);
        setNetworkProgress(null);
      }
    }
  }, [effectiveMimeType, fileName, fileUrl, getFileBlob, isOpening]);

  if (!isIOS) return null;

  const compact = variant === 'compact';
  const buttonClass = compact
    ? 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
    : 'inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className={`${compact ? 'flex flex-col gap-1' : 'w-full'} ${className}`} title={error || undefined}>
      <div className="flex items-center gap-2">
        {showRead && (
          <button
            type="button"
            onClick={handleRead}
            disabled={isReading || isOpening}
            className={`${buttonClass} bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg`}
            aria-label="Lire dans NLSbox"
          >
            {isReading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
            <span>{isReading && typeof progress === 'number' ? `Lire ${progress}%` : 'Lire'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleOpen}
          disabled={isReading || isOpening}
          className={`${buttonClass} ${!showRead ? 'flex-1' : ''} bg-white/10 hover:bg-white/15 text-gray-200 border border-white/10`}
          aria-label="Ouvrir avec les options iOS"
        >
          {isOpening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          <span>{isOpening && typeof progress === 'number' ? `Ouvrir ${progress}%` : isOpening ? 'Préparation…' : 'Ouvrir'}</span>
        </button>
      </div>
      {(isReading || isOpening) && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className="h-full rounded-full bg-purple-400 transition-all duration-300"
            style={{ width: `${typeof progress === 'number' ? progress : 15}%` }}
          />
        </div>
      )}
      {error && <span className="sr-only" role="status">{error}</span>}
    </div>
  );
};