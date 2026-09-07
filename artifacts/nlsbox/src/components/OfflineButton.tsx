import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, DownloadCloud, Loader2 } from 'lucide-react';
import { useOfflineManager, OfflineFileType, OfflineSaveMeta, OfflinePlaybackResult } from '../hooks/useOfflineManager';

/**
 * Bouton universel "Hors-ligne", à ajouter À CÔTÉ des actions existantes
 * (Télécharger / Lire / Stream) sans jamais les remplacer.
 *
 * Fonctionne pour n'importe quel mime-type (vidéo, audio, image, manga
 * CBZ/CBR, archives ZIP/RAR/7Z, PDF/EPUB, etc.) puisqu'il délègue tout le
 * travail de stockage à useOfflineManager (OPFS).
 */
export interface OfflineButtonProps {
  /** URL à partir de laquelle télécharger le fichier (proxy interne). */
  url: string;
  /** Nom de fichier (utilisé pour la détection de type + l'index). */
  filename: string;
  mimeType?: string;
  /** Force un type au lieu de le déduire automatiquement. */
  type?: OfflineFileType;
  channelId?: string;
  messageId?: number | string;
  /** 'icon' = bouton compact pour les rangées d'actions denses, 'full' = bouton avec libellé + barre de progression. */
  variant?: 'icon' | 'full';
  className?: string;
  /**
   * Appelé quand le fichier est DÉJÀ hors-ligne et que l'utilisateur clique sur le
    * bouton (icône de validation) : doit ouvrir/lire le fichier. Si absent, ouvre le blob dans
   * un nouvel onglet par défaut.
   * Ce bouton ne supprime JAMAIS le fichier hors-ligne : la suppression n'est
   * possible que depuis la page /offline, avec confirmation.
   */
  onPlayOffline?: (result: OfflinePlaybackResult) => void;
}

const LABEL_SAVE = 'Hors-ligne';
const LABEL_SAVED = 'Hors-ligne';

export const OfflineButton: React.FC<OfflineButtonProps> = ({
  url,
  filename,
  mimeType,
  type,
  channelId,
  messageId,
  variant = 'icon',
  className = '',
  onPlayOffline,
}) => {
  const { isSupported, saveOffline, playOffline, isFileOffline, getProgress } = useOfflineManager();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const isSaved = isFileOffline(filename, channelId, messageId);
  const progress = getProgress(filename, channelId, messageId);
  const isSaving = typeof progress === 'number' && progress < 100;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isSupported || isBusy || isSaving) return;
      setError(null);
      setIsBusy(true);
      try {
        if (isSaved) {
          // Le fichier est DÉJÀ hors-ligne : on l'OUVRE/LIT, on ne le supprime
          // JAMAIS depuis ce bouton. La suppression n'existe que sur /offline,
          // avec une confirmation explicite de l'utilisateur.
          const result = await playOffline(filename);
          if (!result) {
            if (mountedRef.current) setError('Fichier hors-ligne introuvable.');
            return;
          }
          if (onPlayOffline) {
            onPlayOffline(result);
          } else if (typeof window !== 'undefined') {
            window.open(result.blobUrl, '_blank', 'noopener,noreferrer');
          }
        } else {
          if (!url) return;
          const meta: OfflineSaveMeta = { channelId, messageId, type };
          await saveOffline(url, filename, mimeType || '', meta);
        }
      } catch (err) {
        console.warn('[OfflineButton] action hors-ligne échouée', err);
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Action hors-ligne impossible');
        }
      } finally {
        if (mountedRef.current) setIsBusy(false);
      }
    },
    [
      isSupported,
      isBusy,
      isSaving,
      isSaved,
      url,
      playOffline,
      filename,
      saveOffline,
      mimeType,
      channelId,
      messageId,
      type,
      onPlayOffline,
    ]
  );

  const label = isSaved ? LABEL_SAVED : LABEL_SAVE;
  const title = !isSupported
    ? "Stockage hors-ligne (OPFS) indisponible sur ce navigateur"
    : error
      ? error
      : isSaved
        ? 'Copie hors-ligne disponible — cliquer pour lire'
        : 'Enregistrer une copie hors-ligne (lecture sans connexion ensuite)';

  if (variant === 'full') {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <button
          onClick={handleClick}
          disabled={!isSupported || isBusy || isSaving}
          title={title}
          aria-label={label}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
            isSaved
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
              : 'bg-white/5 hover:bg-white/15 text-gray-200 border-white/10 hover:border-sky-500/40'
          }`}
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{isSaving ? `Hors-ligne… ${Math.round(progress ?? 0)}%` : label}</span>
        </button>
        {isSaving && (
          <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all duration-300"
              style={{ width: `${Math.round(progress ?? 0)}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Variante icône compacte, pour les rangées d'actions denses (EpisodeCard, toolbars…)
  if (isSaving) {
    return (
      <div
        className={`relative w-7 h-7 flex items-center justify-center shrink-0 ${className}`}
        title={`Sauvegarde hors-ligne… ${Math.round(progress ?? 0)}%`}
      >
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <path
            className="text-white/10"
            strokeWidth="3.5"
            stroke="currentColor"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            className="text-sky-400 transition-all duration-300"
            strokeDasharray={`${progress ?? 0}, 100`}
            strokeWidth="3.5"
            strokeLinecap="round"
            stroke="currentColor"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>
        <span className="absolute text-[8px] font-extrabold text-sky-300">{Math.round(progress ?? 0)}%</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={!isSupported || isBusy}
      title={title}
      aria-label={label}
      className={`p-1.5 rounded-lg transition-all cursor-pointer border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
        isSaved
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
          : 'bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white border-white/5 hover:border-sky-500/40'
      } ${className}`}
    >
      {isSaved ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <DownloadCloud className="w-3.5 h-3.5" aria-hidden="true" />}
    </button>
  );
};
