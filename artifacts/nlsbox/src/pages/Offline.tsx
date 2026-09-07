import React, { useCallback, useMemo, useState } from 'react';
import {
  HardDriveDownload,
  Clapperboard,
  Disc,
  BookOpen,
  Image as ImageIcon,
  FileArchive,
  FileText,
  FileQuestion,
  Play,
  Eye,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Episode } from '../types';
import {
  useOfflineManager,
  OfflineFileRecord,
  OfflineFileType,
  formatOfflineSize,
} from '../hooks/useOfflineManager';
import { OfflineFileViewer } from '../components/OfflineFileViewer';

interface OfflineProps {
  /** Ouvre le lecteur vidéo/audio natif de l'app avec un blob hors-ligne. */
  onPlayVideo: (episode: Episode, videoUrl: string) => void;
}

type FilterKey = 'all' | OfflineFileType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'video', label: 'Vidéos' },
  { key: 'audio', label: 'Audios' },
  { key: 'manga', label: 'Mangas-BD' },
  { key: 'image', label: 'Images' },
  { key: 'archive', label: 'Archives' },
  { key: 'doc', label: 'Docs' },
];

const TYPE_ICON: Record<OfflineFileType, React.ReactNode> = {
  video: <Clapperboard className="w-5 h-5" />,
  audio: <Disc className="w-5 h-5" />,
  manga: <BookOpen className="w-5 h-5" />,
  image: <ImageIcon className="w-5 h-5" />,
  archive: <FileArchive className="w-5 h-5" />,
  doc: <FileText className="w-5 h-5" />,
  other: <FileQuestion className="w-5 h-5" />,
};

const TYPE_LABEL: Record<OfflineFileType, string> = {
  video: 'Vidéo',
  audio: 'Audio',
  manga: 'Manga / BD',
  image: 'Image',
  archive: 'Archive',
  doc: 'Document',
  other: 'Fichier',
};

const TYPE_STYLES: Record<OfflineFileType, { iconWrap: string; badge: string }> = {
  video: {
    iconWrap: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  audio: {
    iconWrap: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    badge: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  },
  manga: {
    iconWrap: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    badge: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  },
  image: {
    iconWrap: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  archive: {
    iconWrap: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  doc: {
    iconWrap: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  other: {
    iconWrap: 'bg-white/10 text-gray-300 border-white/10',
    badge: 'bg-white/10 text-gray-300 border-white/10',
  },
};

function formatOfflineDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Construit un Episode synthétique à partir d'un enregistrement hors-ligne pour réutiliser VideoPlayerModal. */
function buildSyntheticEpisode(record: OfflineFileRecord): Episode {
  return {
    message_id: typeof record.messageId === 'number' ? record.messageId : Date.now(),
    title: record.filename,
    file_name: record.filename,
    size_mb: record.size / (1024 * 1024),
    download_url: '',
    channel: record.channelId || 'hors-ligne',
  };
}

interface OfflineFileCardProps {
  record: OfflineFileRecord;
  isBusy: boolean;
  onPlayOrView: (record: OfflineFileRecord) => void;
  onDelete: (record: OfflineFileRecord) => void;
}

const OfflineFileCard: React.FC<OfflineFileCardProps> = ({ record, isBusy, onPlayOrView, onDelete }) => {
  const isPlayable = record.type === 'video' || record.type === 'audio';
  const styles = TYPE_STYLES[record.type];

  return (
    <div className="bg-[#1A1A22] hover:bg-[#20202A] rounded-xl p-3.5 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors shadow-md group">
      <div
        onClick={() => !isBusy && onPlayOrView(record)}
        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
      >
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 border ${styles.iconWrap}`}>
          {TYPE_ICON[record.type]}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-100 group-hover:text-white truncate">{record.filename}</h3>
          <div className="flex items-center flex-wrap gap-2 mt-1 text-[11px] text-gray-400">
            <span
              className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${styles.badge}`}
            >
              {TYPE_LABEL[record.type]}
            </span>
            <span className="font-mono text-purple-300">{formatOfflineSize(record.size)}</span>
            <span>•</span>
            <span>{formatOfflineDate(record.savedAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5 w-full sm:w-auto justify-end">
        <button
          onClick={() => onPlayOrView(record)}
          disabled={isBusy}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border-sky-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isPlayable ? (
            <Play className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          <span>{isPlayable ? 'Lire' : 'Voir'}</span>
        </button>
        <button
          onClick={() => onDelete(record)}
          disabled={isBusy}
          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Supprimer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Page /offline : centralise TOUS les fichiers enregistrés hors-ligne (OPFS),
 * peu importe leur type (vidéo, audio, manga/BD, image, archive, document…).
 */
export const Offline: React.FC<OfflineProps> = ({ onPlayVideo }) => {
  const { isSupported, files, storageUsage, playOffline, deleteOffline, clearAll, refresh } = useOfflineManager();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [activeViewer, setActiveViewer] = useState<{ record: OfflineFileRecord; blob: Blob; blobUrl: string } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const base: Record<FilterKey, number> = {
      all: files.length,
      video: 0,
      audio: 0,
      manga: 0,
      image: 0,
      archive: 0,
      doc: 0,
      other: 0,
    };
    for (const f of files) {
      base[f.type] = (base[f.type] || 0) + 1;
    }
    return base;
  }, [files]);

  const filteredFiles = useMemo(() => {
    const sorted = [...files].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    if (activeFilter === 'all') return sorted;
    return sorted.filter((f) => f.type === activeFilter);
  }, [files, activeFilter]);

  const handlePlayOrView = useCallback(
    async (record: OfflineFileRecord) => {
      setActionError(null);
      setBusyId(record.id);
      try {
        const result = await playOffline(record.filename);
        if (!result) {
          setActionError('Fichier introuvable, il a peut-être déjà été supprimé.');
          refresh();
          return;
        }
        if (record.type === 'video' || record.type === 'audio') {
          onPlayVideo(buildSyntheticEpisode(record), result.blobUrl);
        } else {
          setActiveViewer({ record, blob: result.blob, blobUrl: result.blobUrl });
        }
      } catch (err) {
        console.warn('[Offline] Lecture impossible', err);
        setActionError(err instanceof Error ? err.message : 'Lecture impossible.');
      } finally {
        setBusyId(null);
      }
    },
    [playOffline, onPlayVideo, refresh]
  );

  const handleDelete = useCallback(
    async (record: OfflineFileRecord) => {
      if (!confirm(`Supprimer "${record.filename}" du stockage hors-ligne ?`)) return;
      setBusyId(record.id);
      try {
        await deleteOffline(record.filename);
      } catch (err) {
        console.warn('[Offline] Suppression impossible', err);
        setActionError(err instanceof Error ? err.message : 'Suppression impossible.');
      } finally {
        setBusyId(null);
      }
    },
    [deleteOffline]
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm('Supprimer TOUS les fichiers hors-ligne ? Cette action est irréversible.')) return;
    try {
      await clearAll();
    } catch (err) {
      console.warn('[Offline] Vidage impossible', err);
    }
  }, [clearAll]);

  const formattedUsage = storageUsage.usage > 0 ? formatOfflineSize(storageUsage.usage) : null;

  return (
    <div className="pb-28 pt-2 px-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between py-3 border-b border-white/5 mb-4 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <HardDriveDownload className="w-5 h-5 text-sky-400" />
            Hors-ligne
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Fichiers enregistrés sur cet appareil pour une lecture 100% sans connexion
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {formattedUsage && (
            <div className="text-right">
              <span className="text-[11px] text-gray-400 block font-medium">Espace utilisé</span>
              <span className="text-xs font-bold text-sky-300 font-mono bg-sky-950/40 px-2 py-0.5 rounded border border-sky-500/20">
                {formattedUsage}
              </span>
            </div>
          )}
          <button
            onClick={() => refresh()}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-all cursor-pointer"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isSupported && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Le stockage hors-ligne (OPFS) n'est pas disponible sur ce navigateur. Utilisez un navigateur récent
            (Chrome, Edge, Safari 16.4+) pour enregistrer des fichiers hors-ligne.
          </p>
        </div>
      )}

      {actionError && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {actionError}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3 mb-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              activeFilter === filter.key
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 border-white/5'
            }`}
          >
            {filter.label}
            {counts[filter.key] > 0 && <span className="ml-1 opacity-70">({counts[filter.key]})</span>}
          </button>
        ))}
      </div>

      {filteredFiles.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#1A1A22] border border-white/5 mx-auto flex items-center justify-center mb-4 shadow-inner">
            <HardDriveDownload className="w-10 h-10 text-gray-600" />
          </div>
          <h2 className="text-base font-bold text-white">
            {files.length === 0 ? 'Aucun fichier hors-ligne' : 'Aucun fichier dans ce filtre'}
          </h2>
          <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1 leading-relaxed">
             Utilisez le bouton « Hors-ligne » à côté de n'importe quel épisode, image, manga ou document pour
            l'enregistrer ici.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredFiles.map((record) => (
            <OfflineFileCard
              key={record.id}
              record={record}
              isBusy={busyId === record.id}
              onPlayOrView={handlePlayOrView}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleClearAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer border border-white/5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Tout supprimer</span>
          </button>
        </div>
      )}

      {activeViewer && (
        <OfflineFileViewer
          record={activeViewer.record}
          blob={activeViewer.blob}
          blobUrl={activeViewer.blobUrl}
          onClose={() => setActiveViewer(null)}
        />
      )}
    </div>
  );
};
