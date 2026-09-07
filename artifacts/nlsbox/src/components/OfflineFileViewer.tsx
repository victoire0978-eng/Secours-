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

function normalizeArchivePath(path: string): string {
  const parts: string[] = [];
  for (const part of decodeURIComponent(path).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveArchivePath(baseFile: string, relativePath: string): string {
  const baseParts = baseFile.split('/');
  baseParts.pop();
  return normalizeArchivePath([...baseParts, relativePath].join('/'));
}

async function blobToDataUrl(value: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Lecture de ressource EPUB impossible'));
    reader.readAsDataURL(value);
  });
}

async function buildEpubHtml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(blob);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB invalide : fichier container.xml absent.');

  const containerDoc = new DOMParser().parseFromString(container, 'application/xml');
  const rootfilePath =
    containerDoc.querySelector('rootfile')?.getAttribute('full-path') ||
    containerDoc.querySelector('[full-path]')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('EPUB invalide : manifeste introuvable.');

  const opfPath = normalizeArchivePath(rootfilePath);
  const opf = await zip.file(opfPath)?.async('string');
  if (!opf) throw new Error('EPUB invalide : fichier OPF absent.');

  const opfDoc = new DOMParser().parseFromString(opf, 'application/xml');
  const manifest = new Map<string, { href: string; mediaType: string }>();
  Array.from(opfDoc.getElementsByTagName('item')).forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, { href, mediaType: item.getAttribute('media-type') || '' });
  });

  const spineIds = Array.from(opfDoc.getElementsByTagName('itemref'))
    .map((item) => item.getAttribute('idref'))
    .filter((id): id is string => !!id);
  const chapters: string[] = [];

  for (let index = 0; index < spineIds.length; index += 1) {
    const item = manifest.get(spineIds[index]);
    if (!item || !/xhtml|html/i.test(item.mediaType)) continue;
    const chapterPath = resolveArchivePath(opfPath, item.href);
    const source = await zip.file(chapterPath)?.async('string');
    if (!source) continue;

    const chapterDoc = new DOMParser().parseFromString(source, 'text/html');
    chapterDoc.querySelectorAll('script, style, link, iframe, object, embed').forEach((node) => node.remove());

    for (const image of Array.from(chapterDoc.querySelectorAll('img'))) {
      const sourcePath = image.getAttribute('src');
      if (!sourcePath) continue;
      const imagePath = resolveArchivePath(chapterPath, sourcePath.split('#')[0]);
      const imageFile = zip.file(imagePath);
      if (!imageFile) {
        image.removeAttribute('src');
        continue;
      }
      const imageBlob = await imageFile.async('blob');
      image.setAttribute('src', await blobToDataUrl(
        imageBlob.type ? imageBlob : new Blob([imageBlob], { type: guessMimeTypeFromFilename(imagePath) })
      ));
    }

    const body = chapterDoc.body?.innerHTML || chapterDoc.documentElement.innerHTML;
    if (body.trim()) {
      chapters.push(`<section class="epub-chapter">${body}</section>`);
    }
  }

  if (chapters.length === 0) throw new Error('Aucun chapitre lisible dans cet EPUB.');
  return `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 24px 18px 56px; color: #202124; background: #fff; font: 17px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .epub-chapter { max-width: 760px; margin: 0 auto 48px; }
      .epub-chapter + .epub-chapter { border-top: 1px solid #ddd; padding-top: 32px; }
      img { display: block; max-width: 100%; height: auto; margin: 16px auto; }
      h1,h2,h3 { line-height: 1.25; } a { color: #4f46e5; }
    </style></head><body>${chapters.join('')}</body></html>`;
}

async function extractDocxText(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(blob);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX invalide : document.xml absent.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'));
  const text = paragraphs.map((paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'))
      .map((node) => node.textContent || '')
      .join('')
  );
  return text.join('\n\n').trim();
}

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
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [documentText, setDocumentText] = useState<string | null>(null);
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

  const isPdf = record.mimeType === 'application/pdf' || record.filename.toLowerCase().endsWith('.pdf');
  const isText = record.mimeType === 'text/plain' || record.filename.toLowerCase().endsWith('.txt');
  const isEpub = record.filename.toLowerCase().endsWith('.epub') || record.mimeType.includes('epub');
  const isDocx =
    record.filename.toLowerCase().endsWith('.docx') ||
    record.mimeType.includes('wordprocessingml');

  useEffect(() => {
    if (!isEpub && !isDocx && !isText) return;
    let cancelled = false;
    setIsLoading(true);
    setDocumentHtml(null);
    setDocumentText(null);
    setMangaError(null);

    (async () => {
      try {
        if (isEpub) {
          const html = await buildEpubHtml(blob);
          if (!cancelled) setDocumentHtml(html);
        } else if (isDocx) {
          const text = await extractDocxText(blob);
          if (!cancelled) setDocumentText(text);
        } else {
          const text = await blob.text();
          if (!cancelled) setDocumentText(text);
        }
      } catch (error) {
        console.warn('[OfflineFileViewer] Lecture locale du document échouée', error);
        if (!cancelled) setMangaError(error instanceof Error ? error.message : 'Document illisible.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob, isDocx, isEpub, isText]);

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

    if (record.type === 'doc' && isPdf) {
      return <iframe src={blobUrl} title={record.filename} className="flex-1 w-full bg-white" />;
    }

    if (record.type === 'doc' && (isText || isDocx)) {
      if (isLoading) {
        return (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <Loader2 className="w-7 h-7 animate-spin text-sky-400" />
          </div>
        );
      }
      if (documentText !== null) {
        return (
          <div className="flex-1 overflow-auto bg-white text-gray-900 p-5 sm:p-8">
            <pre className="max-w-3xl mx-auto whitespace-pre-wrap break-words text-[15px] leading-7 font-sans">
              {documentText || 'Document vide.'}
            </pre>
          </div>
        );
      }
      return renderFallback(mangaError || undefined);
    }

    if (record.type === 'doc' && isEpub) {
      if (isLoading) {
        return (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <Loader2 className="w-7 h-7 animate-spin text-sky-400" />
          </div>
        );
      }
      if (documentHtml) {
        return <iframe srcDoc={documentHtml} title={record.filename} className="flex-1 w-full bg-white" />;
      }
      return renderFallback(mangaError || undefined);
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
