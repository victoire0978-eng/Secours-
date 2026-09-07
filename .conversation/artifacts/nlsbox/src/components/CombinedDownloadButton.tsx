import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import {
  OfflineFileType,
  OfflineSaveMeta,
  useOfflineManager,
} from '../hooks/useOfflineManager';
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
  onCompleted?: () => void;
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
  onCompleted,
}) => {
  const { isSupported, saveOfflineBlob, isFileOffline, getProgress } = useOfflineManager();
  const [isBusy, setIsBusy] = useState(false);
  const [networkProgress, setNetworkProgress] = useState<number | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<'network' | 'offline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const isSaved = isFileOffline(filename, channelId, messageId);
  const offlineProgress = getProgress(filename, channelId, messageId);
  const progress = downloadPhase === 'network'
    ? (typeof networkProgress === 'number' ? Math.round(networkProgress / 2) : null)
    : downloadPhase === 'offline'
      ? 50 + (typeof offlineProgress === 'number' ? Math.round(offlineProgress / 2) : 0)
      : null;

  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isSupported || isBusy || isSaved || !url) return;

      setError(null);
      setIsBusy(true);
      setNetworkProgress(0);
      setDownloadPhase('network');

      try {
        // The only network request. The same blob goes to both destinations.
        const { blob, contentType: responseContentType } = await fetchBlobWithProgress(url, (percent) => {
          if (mountedRef.current) setNetworkProgress(percent);
        });
        const contentType = responseContentType || blob.type || mimeType;

        // Trigger this immediately after the user gesture so mobile browsers
        // do not block the programmatic device download after an async wait.
        if (!triggerBlobDeviceDownload(blob, filename)) {
          throw new Error("Le téléchargement vers l'appareil a échoué.");
        }

        setDownloadPhase('offline');
        await saveOfflineBlob(blob, url, filename, contentType, {
          channelId,
          messageId,
          type,
        } satisfies OfflineSaveMeta);

        onCompleted?.();
      } catch (downloadError) {
        console.warn('[CombinedDownloadButton] téléchargement combiné échoué', downloadError);
        if (mountedRef.current) {
          setError(downloadError instanceof Error ? downloadError.message : 'Téléchargement impossible');
        }
      } finally {
        if (mountedRef.current) {
          setIsBusy(false);
          setDownloadPhase(null);
          setNetworkProgress(null);
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
      onCompleted,
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
    ? `Téléchargement en cours : ${progress}%`
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
              ? `Téléchargement…${typeof progress === 'number' ? ` ${progress}%` : ''}`
              : "Télécharger sur l'appareil"}
          </span>
        </button>
        {isBusy && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div
              className="h-full rounded-full bg-purple-400 transition-all duration-300"
              style={{ width: `${typeof progress === 'number' ? progress : 15}%` }}
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