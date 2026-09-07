import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Loader2,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import JSZip from 'jszip';
import { OfflineFileRecord, guessMimeTypeFromFilename } from '../hooks/useOfflineManager';
import { usePlatform } from '../hooks/usePlatform';
import { IOSActions } from './IOSActions';

interface OfflineFileViewerProps {
  record: OfflineFileRecord;
  blob: Blob;
  blobUrl: string;
  onClose: () => void;
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 250;
const ZOOM_STEP = 25;
const ZOOM_DEFAULT = 100;

/** Vrai si ce type de fichier hors-ligne doit être extrait via JSZip (CBZ/CBR/ZIP/RAR). */
function isZipExtractableType(type: OfflineFileRecord['type']): boolean {
  return type === 'manga' || type === 'archive';
}

/**
 * Visionneuse universelle pour les fichiers hors-ligne qui ne sont ni vidéo
 * ni audio (image, manga/BD, PDF, archives, etc.). Fonctionne uniquement à
 * partir du Blob local (OPFS) — aucune requête réseau n'est nécessaire.
 *
 * Volontairement séparée de ScanMangaViewerModal : ce dernier ne gère pas
 * la lecture hors-ligne (il recharge toujours depuis le réseau), on ne le
 * modifie donc pas pour rester dans le périmètre de la tâche.
 */
export const OfflineFileViewer: React.FC<OfflineFileViewerProps> = ({ record, blob, blobUrl, onClose }) => {
  const [pages, setPages] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [isLoading, setIsLoading] = useState(isZipExtractableType(record.type));
  const [mangaError, setMangaError] = useState<string | null>(null);
  const { isIOS } = usePlatform();

  // Libère le blob URL principal quand la visionneuse se ferme
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // Extraction des images pour les mangas/BD (CBZ) et archives (ZIP) : on ne
  // fait JAMAIS de createObjectURL sur le zip entier, uniquement sur chaque
  // image extraite. Les CBR/RAR/7z ne peuvent pas être décompressés
  // nativement dans le navigateur : on retombe alors sur le panneau
  // universel de secours (télécharger / ouvrir).
  useEffect(() => {
    if (!isZipExtractableType(record.type)) return;
    let cancelled = false;
    const createdUrls: string[] = [];

    (async () => {
      try {
        const zip = await JSZip.loadAsync(blob);
        const imageEntries = Object.keys(zip.files)
          .filter(
            (name) =>
              !zip.files[name].dir &&
              !name.includes('__MACOSX') &&
              !name.startsWith('.') &&
              /\.(jpe?g|png|webp|gif|bmp|avif|jfif)$/i.test(name)
          )
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        if (imageEntries.length === 0) {
          if (!cancelled) {
            setMangaError("Cette archive ne contient aucune image (jpg/png/webp) lisible directement.");
            setIsLoading(false);
          }
          return;
        }

        const extracted: string[] = [];
        for (const entryName of imageEntries) {
          const rawBlob = await zip.file(entryName)!.async('blob');
          // JSZip ne renseigne jamais le mime-type des blobs extraits (type
          // toujours vide) : on le force depuis l'extension pour rester
          // cohérent avec le reste du système hors-ligne.
          const imageBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: guessMimeTypeFromFilename(entryName) });
          const url = URL.createObjectURL(imageBlob);
          createdUrls.push(url);
          extracted.push(url);
        }

        if (!cancelled) {
          setPages(extracted);
          setIsLoading(false);
        }
      } catch (err) {
        console.warn('[OfflineFileViewer] Extraction manga/archive échouée', err);
        if (!cancelled) {
          setMangaError('Ce format (probablement CBR/RAR/7z) ne peut pas être extrait directement dans le navigateur.');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [blob, record.type]);

  const handleZoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  const handleZoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  const handleZoomReset = () => setZoom(ZOOM_DEFAULT);

  const handleOpenNewTab = () => {
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadToDevice = () => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = record.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 1500);
  };

  const isPdf = record.mimeType === 'application/pdf' || record.filename.toLowerCase().endsWith('.pdf');
  const isText = record.mimeType === 'text/plain' || record.filename.toLowerCase().endsWith('.txt');

  const renderFallback = (message?: string) => (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-6">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-400">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <div>
        <h3 className="text-white font-bold text-sm">Aperçu non disponible dans le navigateur</h3>
        <p className="text-xs text-gray-400 mt-1 max-w-sm">
          {message || 'Ce type de fichier ne peut pas être prévisualisé directement. Ouvrez-le avec une application compatible.'}
        </p>
      </div>
      {isIOS ? (
        <IOSActions
          fileUrl={blobUrl}
          fileName={record.filename}
          mimeType={record.mimeType}
          initialBlob={blob}
          variant="full"
          className="justify-center"
          onRead={() => handleOpenNewTab()}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <button
            onClick={handleDownloadToDevice}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-90 text-white text-xs font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Télécharger</span>
          </button>
          <button
            onClick={handleOpenNewTab}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 text-xs font-semibold cursor-pointer border border-white/10"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Ouvrir dans un nouvel onglet</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    if (record.type === 'image') {
      return (
        <div className="flex-1 flex items-center justify-center overflow-auto p-4">
          <img src={blobUrl} alt={record.filename} className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      );
    }

    if (record.type === 'doc' && (isPdf || isText)) {
      return <iframe src={blobUrl} title={record.filename} className="flex-1 w-full bg-white" />;
    }

    if (isZipExtractableType(record.type)) {
      if (isLoading) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
            <span className="text-xs">Extraction des images…</span>
          </div>
        );
      }
      if (pages && pages.length > 0) {
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scroll vertical continu de toutes les planches, avec zoom */}
            <div className="flex-1 w-full overflow-auto p-2 sm:p-4">
              <div className="flex flex-col items-center gap-3 w-full max-w-3xl mx-auto">
                {pages.map((pageUrl, idx) => (
                  <img
                    key={pageUrl}
                    src={pageUrl}
                    alt={`Page ${idx + 1} / ${pages.length}`}
                    loading={idx <= 2 ? 'eager' : 'lazy'}
                    className="rounded-lg shadow-lg select-none"
                    style={{ width: `${zoom}%`, maxWidth: 'none' }}
                  />
                ))}
              </div>
            </div>
            {/* Barre de zoom */}
            <div className="flex items-center justify-center gap-3 py-2.5 shrink-0 border-t border-white/5">
              <button
                onClick={handleZoomOut}
                disabled={zoom <= ZOOM_MIN}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Zoom arrière"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono min-w-[42px] text-center font-bold text-gray-300">{zoom}%</span>
              <button
                onClick={handleZoomIn}
                disabled={zoom >= ZOOM_MAX}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Zoom avant"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {zoom !== ZOOM_DEFAULT && (
                <button
                  onClick={handleZoomReset}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Réinitialiser zoom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-[11px] text-gray-500 ml-1">
                {pages.length} page{pages.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        );
      }
      return renderFallback(mangaError || undefined);
    }

    // Fallback universel : documents non PDF/texte (epub/docx…) et tout
    // autre format qui ne peut pas être prévisualisé nativement dans le
    // navigateur. Les archives (CBZ/ZIP) passent par l'extraction JSZip
    // ci-dessus ; seul un échec d'extraction (CBR/RAR/7z) y retombe.
    return renderFallback();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <h2 className="text-sm font-bold text-white truncate pr-2">{record.filename}</h2>
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-all cursor-pointer shrink-0"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {renderContent()}
    </div>
  );
};
