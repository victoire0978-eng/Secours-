import React from 'react';
import {
  Download,
  Play,
  Trash2,
  HardDrive,
  CheckCircle2,
  XCircle,
  Film,
  Zap,
  Clock,
  ExternalLink,
  Tv,
  FolderDown,
  Smartphone,
} from 'lucide-react';
import { DownloadTask, Episode } from '../types';
import { sanitizeDisplayTitle, sanitizeFileName } from '../utils/sanitizeTitle';
import {
  getInternalStorageDownloadUrl,
  getVlcStreamUrl,
  getAndroidIntentUrl,
} from '../utils/download';
import { CombinedDownloadButton } from './CombinedDownloadButton';
import { IOSActions } from './IOSActions';
import { usePlatform } from '../hooks/usePlatform';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
};

interface DownloadsScreenProps {
  activeDownloads: Record<number, DownloadTask>;
  savedDownloads: DownloadTask[];
  onPlayEpisode: (episode: Episode, isOffline: boolean) => void;
  onCancelDownload: (messageId: number) => void;
  onDeleteDownload: (messageId: number) => void;
  backendUrl?: string;
}

export const DownloadsScreen: React.FC<DownloadsScreenProps> = ({
  activeDownloads,
  savedDownloads,
  onPlayEpisode,
  onCancelDownload,
  onDeleteDownload,
  backendUrl = '/',
}) => {
  const { isIOS } = usePlatform();
  const activeList: DownloadTask[] = Object.values(activeDownloads);
  const totalStorageMb = savedDownloads.reduce((acc, curr) => acc + (curr.episode.size_mb || 0), 0);
  const formattedStorage = totalStorageMb >= 1024
    ? `${(totalStorageMb / 1024).toFixed(2)} Go`
    : `${totalStorageMb.toFixed(1)} Mo`;

  const isEmpty = activeList.length === 0 && savedDownloads.length === 0;

  return (
    <main className="nls-page-enter pb-28 pt-3 px-4 sm:px-5 max-w-4xl mx-auto">
      {/* Title & Storage stats banner */}
      <div className="flex items-center justify-between py-3 border-b border-white/5 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Download className="w-5 h-5 text-[hsl(var(--primary))]" />
            Gestionnaire de Téléchargement
          </h1>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
            Vos vidéos enregistrées pour lecture hors-ligne
          </p>
        </div>

        {savedDownloads.length > 0 && (
          <div className="text-right">
            <span className="text-[11px] text-gray-400 block font-medium">Stockage utilisé</span>
             <span className="text-xs font-bold text-[hsl(var(--primary))] font-mono bg-[hsl(var(--primary)/.10)] px-2 py-0.5 rounded border border-[hsl(var(--primary)/.24)]">
              {formattedStorage}
            </span>
          </div>
        )}
      </div>

      {isEmpty ? (
         <div className="py-20 text-center">
           <div className="w-20 h-20 rounded-3xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] mx-auto flex items-center justify-center mb-4 shadow-inner">
             <Film className="w-10 h-10 text-[hsl(var(--muted-foreground)/.62)]" />
          </div>
           <h2 className="font-display text-base font-bold text-[hsl(var(--foreground))]">Aucun téléchargement</h2>
           <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-sm mx-auto mt-1 leading-relaxed">
            Téléchargez des épisodes depuis l'accueil pour pouvoir les visionner n'importe où sans connexion Internet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Téléchargements en cours */}
          {activeList.length > 0 && (
            <div>
              <h2 className="text-xs font-extrabold text-purple-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 animate-pulse" />
                En cours ({activeList.length})
              </h2>

              <div className="space-y-3">
                {activeList.map((task) => (
                  <div
                    key={task.episode.message_id}
                     className="bg-[hsl(var(--card))] rounded-2xl p-3.5 border border-[hsl(var(--primary)/.32)] shadow-lg relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                         <h3 className="text-sm font-bold text-[hsl(var(--foreground))] truncate">
                          {sanitizeDisplayTitle(task.episode.title, task.episode.file_name)}
                        </h3>
                        <p className="text-xs text-gray-400 truncate mt-0.5 font-mono text-[11px]">
                          {sanitizeFileName(task.episode.file_name, task.episode.title)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                         <span className="text-xs font-extrabold text-purple-300 font-mono">
                           {task.totalBytes > 0 ? `${task.progress.toFixed(1)}%` : 'Taille inconnue'}
                        </span>
                        <button
                          onClick={() => onCancelDownload(task.episode.message_id)}
                          className="p-1 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                          title="Annuler le téléchargement"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                      <div
                        className="mt-3 relative h-2 bg-[hsl(var(--background)/.72)] rounded-full overflow-hidden border border-[hsl(var(--border)/.65)]"
                        role="progressbar"
                        aria-label={task.totalBytes > 0 ? `Progression ${task.progress.toFixed(1)} %` : 'Progression indéterminée'}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={task.totalBytes > 0 ? task.progress : undefined}
                      >
                       {task.totalBytes > 0 ? (
                         <div
                           className="h-full bg-[hsl(var(--primary))] transition-[width] duration-75 rounded-full"
                           style={{ width: `${task.progress}%` }}
                         />
                       ) : (
                         <div className="h-full w-1/4 bg-[hsl(var(--primary))] rounded-full animate-pulse" />
                       )}
                    </div>

                     {/* Meta info from the current real phase */}
                    <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                      <span className="flex items-center gap-1 font-mono text-purple-300/80">
                        <Zap className="w-3 h-3 text-purple-400" />
                         {task.speedMbPerSec > 0 ? `${task.speedMbPerSec.toFixed(1)} Mo/s` : '— Mo/s'}
                      </span>
                       <span className="font-mono text-right">
                         <span className="block text-purple-300/80">
                           {task.phase === 'offline' ? 'Écriture hors-ligne' : 'Téléchargement réseau'}
                         </span>
                         {formatBytes(task.downloadedBytes)} / {task.totalBytes > 0 ? formatBytes(task.totalBytes) : 'taille inconnue'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Vidéos Disponibles Hors-Ligne & Mémoire de l'appareil */}
          {savedDownloads.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Disponibles ({savedDownloads.length})
                </h2>
                <span className="text-[11px] text-gray-400">
                  Dossier Téléchargements du smartphone
                </span>
              </div>

              {/* Internal storage indicator banner */}
              <div className="mb-3 p-3 rounded-xl bg-purple-950/30 border border-purple-500/20 flex items-start gap-2.5 text-xs text-gray-300">
                <FolderDown className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  {isIOS ? (
                    <>
                      Les fichiers sont disponibles dans le stockage hors-ligne de NLSbox. Utilisez
                      <strong className="text-white"> Lire</strong> pour les ouvrir dans NLSbox ou
                      <strong className="text-white"> Ouvrir</strong> pour les envoyer vers Fichiers,
                      Livres ou une application iOS compatible.
                    </>
                  ) : (
                    <>
                      Chaque fichier est automatiquement téléchargé dans la mémoire de votre téléphone (dossier
                      <strong className="text-white"> Téléchargements / Download</strong>). Vous pouvez le retrouver
                      dans l'explorateur de fichiers de votre téléphone ou l'ouvrir directement dans VLC / MX Player.
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                {savedDownloads.map((task) => {
                  const deviceDownloadUrl = getInternalStorageDownloadUrl(task.episode, backendUrl);
                  const vlcUrl = getVlcStreamUrl(task.episode, backendUrl);
                  const androidIntentUrl = getAndroidIntentUrl(task.episode, backendUrl);
                  return (
                    <div
                      key={task.episode.message_id}
                       className="bg-[hsl(var(--card))] hover:bg-[hsl(var(--card-foreground)/.05)] rounded-2xl p-3.5 border border-[hsl(var(--border)/.72)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors shadow-md group"
                    >
                      {/* Play button & Episode Info */}
                      <div
                        onClick={() => onPlayEpisode(task.episode, true)}
                        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="w-11 h-11 rounded-lg bg-emerald-500/10 group-hover:bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20 transition-all">
                          <Play className="w-5 h-5 ml-0.5 fill-current" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-gray-100 group-hover:text-white truncate">
                            {sanitizeDisplayTitle(task.episode.title, task.episode.file_name)}
                          </h3>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                            <span className="font-mono text-purple-300">
                              {task.episode.size_mb >= 1024
                                ? `${(task.episode.size_mb / 1024).toFixed(2)} Go`
                                : `${task.episode.size_mb.toFixed(1)} Mo`}
                            </span>
                            <span>•</span>
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Fichier local
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5 w-full sm:w-auto justify-end">
                        {isIOS ? (
                          <IOSActions
                            fileUrl={deviceDownloadUrl}
                            fileName={sanitizeFileName(task.episode.file_name, task.episode.title)}
                            channelId={task.episode.channel}
                            messageId={task.episode.message_id}
                            variant="compact"
                            onRead={() => onPlayEpisode(task.episode, true)}
                          />
                        ) : (
                          <>
                            {/* Open in VLC */}
                          <a
                              href={vlcUrl}
                              className="p-2 rounded-lg bg-[#1f1f2e] hover:bg-[#28283d] text-orange-400 border border-orange-500/30 transition-all cursor-pointer"
                              title="Ouvrir dans VLC"
                            >
                              <Tv className="w-3.5 h-3.5" />
                            </a>

                            {/* Open in Android native player */}
                            {androidIntentUrl && (
                              <a
                                href={androidIntentUrl}
                                className="p-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 transition-all cursor-pointer"
                                title="Ouvrir dans MX Player / Galerie"
                              >
                                <Smartphone className="w-3.5 h-3.5" />
                              </a>
                            )}

                            <CombinedDownloadButton
                              url={deviceDownloadUrl}
                              filename={sanitizeFileName(task.episode.file_name, task.episode.title)}
                              channelId={task.episode.channel}
                              messageId={task.episode.message_id}
                              variant="full"
                              className="!w-auto px-2.5 py-1.5 rounded-lg text-[11px]"
                            />
                          </>
                        )}

                        {/* Delete action */}
                        <button
                          onClick={() => onDeleteDownload(task.episode.message_id)}
                          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
                          title="Supprimer de la liste"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
};
