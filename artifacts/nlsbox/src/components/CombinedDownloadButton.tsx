import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import {
  OfflineFileType,
  OfflineSaveMeta,
  useOfflineManager,
} from '../hooks/useOfflineManager';
import type { DownloadProgressUpdate } from '../types';
import { fetchBlobWithProgress, triggerBlobDeviceDownload } from '../utils/download';

interface CombinedDownloadButtonProps {
  url: string;
  filename: string;
  mimeType?: string;
  type?: OfflineFileType;
  channelId?: string;
  messageId?: number | string;
  variant?: 'icon' | 'full';
  className?: string;
  onStarted?: (cancel: () => void) => void;
  onProgress?: (progress: DownloadProgressUpdate) => void;
  onCompleted?: () => void;
  onError?: (error: Error) => void;
  onFinished?: () => void;
}

/**
 * One download action for both destinations:
 * one network fetch -> device download + OPFS offline copy.
 */
export const CombinedDownloadButton: React.FC<CombinedDownloadButtonProps> = ({
  url,
  filename,
  mimeType = '',
  type,
  channelId,
  messageId,
  variant = 'icon',
  className = '',
  onStarted,
  onProgress,
  onCompleted,
  onError,
  onFinished,
}) => {
  const { isSupported, saveOfflineBlob, isFileOffline, getProgress } = useOfflineManager();
  const [isBusy, setIsBusy] = useState(false);
  const [networkProgress, setNetworkProgress] = useState<number | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<'network' | 'offline' | null>(null);
  const [currentProgress, setCurrentProgress] = useState<DownloadProgressUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const isSaved = isFileOffline(filename, channelId, messageId);
  const offlineProgress = getProgress(filename, channelId, messageId);
  const progress = currentProgress?.percent ?? null;

  const reportProgress = useCallback(
    (update: DownloadProgressUpdate) => {
      onProgress?.(update);
      if (mountedRef.current) {
        setCurrentProgress(update);
        if (update.phase === 'network') {
          setNetworkProgress(update.percent);
        }
      }
    },
    [onProgress]
  );

  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isSupported || isBusy || isSaved || !url) return;

      setError(null);
      setIsBusy(true);
      setNetworkProgress(0);
      setDownloadPhase('network');
      setCurrentProgress({
        phase: 'network',
        loadedBytes: 0,
        totalBytes: 0,
        percent: null,
        bytesPerSecond: 0,
      });
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      onStarted?.(() => abortController.abort());

      try {
        // The only network request. The same blob goes to both destinations.
        const { blob, contentType: responseContentType } = await fetchBlobWithProgress(
          url,
          reportProgress,
          abortController.signal
        );
        const contentType = responseContentType || blob.type || mimeType;

        // Trigger this immediately after the user gesture so mobile browsers
        // do not block the programmatic device download after an async wait.
        if (!triggerBlobDeviceDownload(blob, filename)) {
          throw new Error("Le téléchargement vers l'appareil a échoué.");
        }

        setDownloadPhase('offline');
        reportProgress({
          phase: 'offline',
          loadedBytes: 0,
          totalBytes: blob.size,
          percent: 0,
          bytesPerSecond: 0,
        });
        await saveOfflineBlob(
          blob,
          url,
          filename,
          contentType,
          {
            channelId,
            messageId,
            type,
          } satisfies OfflineSaveMeta,
          reportProgress
        );

        onCompleted?.();
      } catch (downloadError) {
        console.warn('[CombinedDownloadButton] téléchargement combiné échoué', downloadError);
        const normalizedError = downloadError instanceof Error
          ? downloadError
          : new Error('Téléchargement impossible');
        onError?.(normalizedError);
        if (mountedRef.current) {
          setError(normalizedError.message);
        }
      } finally {
        abortControllerRef.current = null;
        onFinished?.();
        if (mountedRef.current) {
          setIsBusy(false);
          setDownloadPhase(null);
          setNetworkProgress(null);
          setCurrentProgress(null);
        }
      }
    },
    [
      channelId,
      filename,
      isBusy,
      isSaved,
      isSupported,
      messageId,
      mimeType,
      onStarted,
      onProgress,
      onCompleted,
      onError,
      onFinished,
      reportProgress,
      saveOfflineBlob,
      type,
      url,
    ]
  );

  if (isSaved) {
    return (
      <span
        className={`inline-flex items-center justify-center p-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0 ${className}`}
        title="Fichier disponible hors-ligne et téléchargé sur l'appareil"
        aria-label="Fichier téléchargé et disponible hors-ligne"
      >
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
      </span>
    );
  }

  const title = error || (isBusy && typeof progress === 'number'
    ? `${currentProgress?.phase === 'network' ? 'Téléchargement' : 'Écriture hors-ligne'} : ${progress}%`
    : !isSupported
    ? "Le stockage hors-ligne n'est pas disponible sur ce navigateur"
    : 'Télécharger sur l’appareil et enregistrer pour le mode hors-ligne');

  if (variant === 'full') {
    return (
      <div className="w-full">
        <button
          onClick={handleClick}
          disabled={!isSupported || isBusy}
          title={title}
          aria-label="Télécharger sur l'appareil et hors-ligne"
          className={`inline-flex w-full items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span>
            {isBusy
              ? `${currentProgress?.phase === 'network' ? 'Téléchargement' : 'Enregistrement hors-ligne'}…${typeof progress === 'number' ? ` ${progress}%` : ''}`
              : "Télécharger sur l'appareil"}
          </span>
        </button>
        {isBusy && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div
              className="h-full rounded-full bg-purple-400 transition-all duration-300"
              style={{ width: `${typeof progress === 'number' ? progress : 0}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={!isSupported || isBusy}
      title={title}
      aria-label="Télécharger sur l'appareil et hors-ligne"
      className={`p-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/30 transition-all cursor-pointer shrink-0 disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 ${className}`}
    >
      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {isBusy && typeof progress === 'number' && (
        <span className="text-[9px] font-mono leading-none">{progress}%</span>
      )}
    </button>
  );
};