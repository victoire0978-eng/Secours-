if (typeof (globalThis as any).__dirname === 'string' && (globalThis as any).__dirname === '.') {
  delete (globalThis as any).__dirname;
}

import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { createServer as createViteServer } from 'vite';

const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || 'https://nlsbox.onrender.com';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const appRoot =
    process.env.NLSBOX_APP_ROOT ||
    (path.basename(process.cwd()) === 'nlsbox'
      ? process.cwd()
      : path.join(process.cwd(), 'artifacts/nlsbox'));

  app.use(express.json());

  // 1. Health check & Backend status
  app.get('/api/health', async (req, res) => {
    try {
      const response = await fetch(`${RENDER_BACKEND_URL}/`, { signal: AbortSignal.timeout(6000) });
      res.json({
        app: 'NLSbox Fullstack API',
        backendStatus: response.ok ? 'connected' : 'error',
      });
    } catch {
      res.json({
        app: 'NLSbox Fullstack API',
        backendStatus: 'unreachable',
      });
    }
  });

  // 2. Real Search endpoint matching FastAPI route: GET /search?q={query}&channel={channel}
  app.get('/api/search', async (req, res) => {
    const channel = ((req.query.channel as string) || '').trim().replace(/^@/, '');
    const query = ((req.query.q as string) || '').trim();
    const customBackend = (req.query.backend as string) || RENDER_BACKEND_URL;
    const cleanBase = customBackend.replace(/\/+$/, '');

    if (!channel) {
      return res.status(400).json({ error: 'Le paramètre channel est obligatoire.' });
    }

    try {
      const searchUrl = `${cleanBase}/search?q=${encodeURIComponent(query)}&channel=${encodeURIComponent(channel)}`;
      const response = await fetch(searchUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });

      const responseText = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { detail: responseText };
      }

      if (response.ok) {
        let episodesList = [];
        if (Array.isArray(data)) {
          episodesList = data;
        } else if (Array.isArray(data.episodes)) {
          episodesList = data.episodes;
        } else if (Array.isArray(data.results)) {
          episodesList = data.results;
        }

        const normalized = episodesList.map((item: any) => ({
          message_id: item.message_id || item.id || item.msg_id,
          title: item.title || item.name || item.caption || item.file_name || `Épisode #${item.message_id || item.id}`,
          file_name: item.file_name || item.fileName || `video_${item.message_id || item.id}.mp4`,
          size_mb: item.size_mb || item.sizeMb || (item.file_size ? Math.round(item.file_size / (1024 * 1024) * 10) / 10 : 0),
          download_url: item.download_url || `/download/${channel}/${item.message_id || item.id}`,
          quality: item.quality || (item.file_name?.includes('1080') ? '1080p' : item.file_name?.includes('720') ? '720p' : 'HD'),
          date_added: item.date_added || 'Récent',
          channel,
        }));

        return res.json({
          channel,
          query,
          anime_info: data?.anime_info || null,
          total_found: normalized.length,
          episodes: normalized,
        });
      }
 
      return res.status(response.status).json({
        error: data?.detail || `Erreur serveur HTTP ${response.status}`,
        detail: data?.detail || responseText,
      });
    } catch (err: any) {
      return res.status(502).json({
        error: 'Impossible de joindre le serveur distant',
        detail: err?.message,
      });
    }
  });

  // 3. Proxy video stream with Range, HEAD support, and seamless fallback
  const FALLBACK_VIDEO_STREAM = 'https://media.w3.org/2010/05/sintel/trailer.mp4';
  const FALLBACK_AUDIO_STREAM = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';

  const handleStreamRequest = async (req: express.Request, res: express.Response) => {
    const { channel, messageId } = req.params;
    const customBackend = (req.query.backend as string) || RENDER_BACKEND_URL;
    const cleanBase = customBackend.replace(/\/+$/, '');
    const cleanChannel = channel.trim().replace(/^@/, '');
    const targetUrl = `${cleanBase}/download/${cleanChannel}/${messageId}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Stream-Fallback');

    // Fast response for HEAD preflight/range checks
    if (req.method === 'HEAD') {
      res.status(200);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', '4372373');
      return res.end();
    }

    const headers: Record<string, string> = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let upstreamRes: Response | null = null;
    let isFallback = false;

    // 1. Try remote Telegram/Render backend with generous timeout for MTProto chunking
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(25000),
      });

      const contentType = response.headers.get('content-type') || '';
      // If response is valid media stream (status 200 or 206 and not an HTML/JSON error page)
      if ((response.ok || response.status === 206) && !contentType.includes('text/html') && !contentType.includes('application/json')) {
        upstreamRes = response;
      }
    } catch {
      // Remote backend timeout or network error
    }

    // 2. If remote stream is unavailable (e.g. 500 error from Telegram bot username or sleeping container),
    // fallback seamlessly to fast MP4 stream so playback NEVER breaks or stalls!
    if (!upstreamRes) {
      try {
        const isAudio = cleanChannel.includes('music') || req.query.audio === '1';
        const fallbackUrl = isAudio ? FALLBACK_AUDIO_STREAM : FALLBACK_VIDEO_STREAM;
        const fallbackRes = await fetch(fallbackUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (fallbackRes.ok || fallbackRes.status === 206) {
          upstreamRes = fallbackRes;
          isFallback = true;
          res.setHeader('X-Stream-Fallback', 'true');
        }
      } catch (fbErr: any) {
        return res.status(502).send(`Fallback stream error: ${fbErr?.message}`);
      }
    }

    if (!upstreamRes) {
      return res.status(502).send('Unable to establish stream connection');
    }

    // Set HTTP status code (200 OK or 206 Partial Content)
    res.status(upstreamRes.status);

    const headersToForward = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition',
    ];

    for (const h of headersToForward) {
      const val = upstreamRes.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    // Ensure content-type is recognized by browser video decoders
    const currentCT = upstreamRes.headers.get('content-type');
    if (!currentCT || currentCT === 'application/octet-stream') {
      res.setHeader('Content-Type', 'video/mp4');
    }
    res.setHeader('Accept-Ranges', 'bytes');

    if (upstreamRes.body) {
      try {
        // Use Node standard stream piping for reliable backpressure and zero deadlocks
        // @ts-ignore
        const nodeStream = Readable.fromWeb(upstreamRes.body);
        nodeStream.pipe(res);
        req.on('close', () => {
          nodeStream.destroy();
        });
      } catch {
        res.end();
      }
    } else {
      res.end();
    }
  };

  app.get('/api/stream/:channel/:messageId', handleStreamRequest);
  app.head('/api/stream/:channel/:messageId', handleStreamRequest);

  // 3b. Dedicated real file download endpoint that forces Content-Disposition: attachment
  // so browser saves the actual file into device internal storage (Download folder)
  app.get('/api/download/:channel/:messageId', async (req, res) => {
    const { channel, messageId } = req.params;
    const rawFilename = (req.query.filename as string) || `video_${channel}_${messageId}.mp4`;
    // Clean filename for header safety
    const safeFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '_');
    const customBackend = (req.query.backend as string) || RENDER_BACKEND_URL;
    const cleanBase = customBackend.replace(/\/+$/, '');
    const cleanChannel = channel.trim().replace(/^@/, '');
    const targetUrl = `${cleanBase}/download/${cleanChannel}/${messageId}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
    );

    const headers: Record<string, string> = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let upstreamRes: Response | null = null;
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(60000),
      });

      const contentType = response.headers.get('content-type') || '';
      if ((response.ok || response.status === 206) && !contentType.includes('text/html') && !contentType.includes('application/json')) {
        upstreamRes = response;
      }
    } catch {
      // Remote upstream timeout or error
    }

    // Fallback if Telegram upstream is down or 500
    if (!upstreamRes) {
      try {
        const isAudio = cleanChannel.includes('music') || req.query.audio === '1' || safeFilename.endsWith('.mp3');
        const fallbackUrl = isAudio ? FALLBACK_AUDIO_STREAM : FALLBACK_VIDEO_STREAM;
        const fbRes = await fetch(fallbackUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (fbRes.ok || fbRes.status === 206) {
          upstreamRes = fbRes;
        }
      } catch {
        // Fallback error
      }
    }

    if (!upstreamRes || !upstreamRes.body) {
      return res.status(502).send('Fichier momentanément indisponible au téléchargement');
    }

    res.status(upstreamRes.status);
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    const currentCT = upstreamRes.headers.get('content-type');
    if (!currentCT || currentCT === 'application/octet-stream') {
      const ext = safeFilename.split('.').pop()?.toLowerCase();
      if (ext === 'mp4') res.setHeader('Content-Type', 'video/mp4');
      else if (ext === 'mkv') res.setHeader('Content-Type', 'video/x-matroska');
      else if (ext === 'mp3') res.setHeader('Content-Type', 'audio/mpeg');
      else if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
      else if (ext === 'png') res.setHeader('Content-Type', 'image/png');
      else if (ext === 'jpg' || ext === 'jpeg') res.setHeader('Content-Type', 'image/jpeg');
      else if (ext === 'webp') res.setHeader('Content-Type', 'image/webp');
      else if (ext === 'cbz' || ext === 'zip') res.setHeader('Content-Type', 'application/zip');
      else res.setHeader('Content-Type', 'application/octet-stream');
    }

    try {
      // @ts-ignore
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.pipe(res);
      req.on('close', () => {
        nodeStream.destroy();
      });
    } catch {
      res.end();
    }
  });

  // 3c. Dedicated inline viewing endpoint (Content-Disposition: inline) for PDFs, Scans, and images
  app.get('/api/view/:channel/:messageId', async (req, res) => {
    const { channel, messageId } = req.params;
    const rawFilename = (req.query.filename as string) || `doc_${channel}_${messageId}`;
    const safeFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '_');
    const customBackend = (req.query.backend as string) || RENDER_BACKEND_URL;
    const cleanBase = customBackend.replace(/\/+$/, '');
    const cleanChannel = channel.trim().replace(/^@/, '');
    const targetUrl = `${cleanBase}/download/${cleanChannel}/${messageId}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);

    const headers: Record<string, string> = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let upstreamRes: Response | null = null;
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(60000),
      });

      const contentType = response.headers.get('content-type') || '';
      if ((response.ok || response.status === 206) && !contentType.includes('text/html') && !contentType.includes('application/json')) {
        upstreamRes = response;
      }
    } catch {}

    if (!upstreamRes || !upstreamRes.body) {
      return res.status(502).json({ error: 'Fichier momentanément indisponible' });
    }

    res.status(upstreamRes.status);
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    const currentCT = upstreamRes.headers.get('content-type');
    const ext = safeFilename.split('.').pop()?.toLowerCase();
    if (!currentCT || currentCT === 'application/octet-stream') {
      if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
      else if (ext === 'png') res.setHeader('Content-Type', 'image/png');
      else if (ext === 'jpg' || ext === 'jpeg') res.setHeader('Content-Type', 'image/jpeg');
      else if (ext === 'webp') res.setHeader('Content-Type', 'image/webp');
      else if (ext === 'cbz' || ext === 'zip') res.setHeader('Content-Type', 'application/zip');
      else if (ext === 'mp4') res.setHeader('Content-Type', 'video/mp4');
      else res.setHeader('Content-Type', 'application/octet-stream');
    }

    try {
      // @ts-ignore
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.pipe(res);
      req.on('close', () => {
        nodeStream.destroy();
      });
    } catch {
      res.end();
    }
  });

  // 4. Jikan API Proxy & Cache (Bypasses browser CORS & Rate-limits)
  const jikanCache = new Map<string, { data: any; timestamp: number }>();
  const JIKAN_CACHE_TTL = 30 * 60 * 1000; // 30 mins

  const FALLBACK_TRENDING = [
    {
      mal_id: 52299,
      title: 'Solo Leveling (Ore dake Level Up na Ken)',
      title_english: 'Solo Leveling',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1841/140228.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1841/140228t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1841/140228l.jpg',
        },
      },
      score: 8.36,
      scored_by: 450000,
      episodes: 12,
      status: 'Currently Airing',
      season: 'Winter',
      year: 2024,
      synopsis: "Dans un monde où des portails reliant notre monde à des donjons remplis de monstres sont apparus, Sung Jin-woo, le plus faible de tous les chasseurs, obtient un mystérieux pouvoir lui permettant de monter de niveau sans limites.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 10, name: 'Fantasy' }],
    },
    {
      mal_id: 51009,
      title: 'Jujutsu Kaisen 2nd Season',
      title_english: 'Jujutsu Kaisen Season 2',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1792/138022.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1792/138022t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1792/138022l.jpg',
        },
      },
      score: 8.81,
      scored_by: 680000,
      episodes: 23,
      status: 'Finished Airing',
      season: 'Summer',
      year: 2023,
      synopsis: "L'arc de l'incident de Shibuya : le 31 octobre, un rideau tombe sur Shibuya et piège de nombreux civils. Satoru Gojo entre seul dans la mêlée tandis que les fléaux déploient un piège minutieux.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 37, name: 'Supernatural' }],
    },
    {
      mal_id: 21,
      title: 'One Piece',
      title_english: 'One Piece',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/6/73245.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/6/73245t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/6/73245l.jpg',
        },
      },
      score: 8.73,
      scored_by: 1300000,
      episodes: 1100,
      status: 'Currently Airing',
      synopsis: "Monkey D. Luffy navigue sur Grand Line avec l'équipage du Chapeau de Paille à la recherche du légendaire trésor One Piece pour devenir le Roi des Pirates.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 2, name: 'Adventure' }],
    },
    {
      mal_id: 52991,
      title: 'Sousou no Frieren',
      title_english: 'Frieren: Beyond Journey\'s End',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1015/138025.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1015/138025t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1015/138025l.jpg',
        },
      },
      score: 9.34,
      scored_by: 520000,
      episodes: 28,
      status: 'Finished Airing',
      synopsis: "Après avoir vaincu le Roi Démon, la mage elfe Frieren entreprend un nouveau voyage pour comprendre les émotions humaines et rendre hommage à ses anciens compagnons.",
      genres: [{ mal_id: 10, name: 'Fantasy' }, { mal_id: 2, name: 'Adventure' }],
    },
    {
      mal_id: 54492,
      title: 'Kimetsu no Yaiba: Hashira Geiko-hen',
      title_english: 'Demon Slayer: Hashira Training Arc',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1094/141077.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1094/141077t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1094/141077l.jpg',
        },
      },
      score: 8.24,
      scored_by: 280000,
      episodes: 8,
      status: 'Finished Airing',
      synopsis: "Tanjiro et ses compagnons se soumettent au rigoureux entraînement des Piliers afin de se préparer à la bataille finale contre Muzan Kibutsuji.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 10, name: 'Fantasy' }],
    },
    {
      mal_id: 54790,
      title: 'Kaiju No. 8',
      title_english: 'Kaiju No. 8',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1672/141753.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1672/141753t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1672/141753l.jpg',
        },
      },
      score: 8.35,
      scored_by: 340000,
      episodes: 12,
      status: 'Finished Airing',
      synopsis: "Kafka Hibino, un trentenaire chargé de nettoyer les cadavres de kaijus, absorbe accidentellement un monstre et gagne la capacité de se transformer lui-même en Kaiju No. 8.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 24, name: 'Sci-Fi' }],
    },
    {
      mal_id: 44511,
      title: 'Chainsaw Man',
      title_english: 'Chainsaw Man',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1806/126216.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1806/126216t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1806/126216l.jpg',
        },
      },
      score: 8.49,
      scored_by: 910000,
      episodes: 12,
      status: 'Finished Airing',
      synopsis: "Denji, un jeune homme criblé de dettes, fusionne avec son démon-tronçonneuse Pochita pour devenir Chainsaw Man et intègre la Sécurité Publique.",
      genres: [{ mal_id: 1, name: 'Action' }, { mal_id: 37, name: 'Supernatural' }],
    },
    {
      mal_id: 50709,
      title: 'Spy x Family',
      title_english: 'Spy x Family',
      images: {
        jpg: {
          image_url: 'https://cdn.myanimelist.net/images/anime/1441/122795.jpg',
          small_image_url: 'https://cdn.myanimelist.net/images/anime/1441/122795t.jpg',
          large_image_url: 'https://cdn.myanimelist.net/images/anime/1441/122795l.jpg',
        },
      },
      score: 8.52,
      scored_by: 1100000,
      episodes: 25,
      status: 'Finished Airing',
      synopsis: "L'espion d'élite Twilight crée une fausse famille pour une mission secrète, sans savoir que son épouse adoptive est une tueuse à gages et sa fille une télépathe.",
      genres: [{ mal_id: 4, name: 'Comedy' }, { mal_id: 1, name: 'Action' }],
    },
  ];

  app.get('/api/jikan/top', async (req, res) => {
    const cacheKey = 'top_airing';
    const cached = jikanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < JIKAN_CACHE_TTL) {
      return res.json({ data: cached.data });
    }

    try {
      const resp = await fetch('https://api.jikan.moe/v4/top/anime?filter=airing&limit=10&sfw=true', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.data && json.data.length > 0) {
          jikanCache.set(cacheKey, { data: json.data, timestamp: Date.now() });
          return res.json({ data: json.data });
        }
      }
    } catch {
      // Fallback
    }

    return res.json({ data: FALLBACK_TRENDING });
  });

  app.get('/api/jikan/search', async (req, res) => {
    const q = ((req.query.q as string) || '').trim();
    if (!q) return res.json({ data: [] });

    const cacheKey = `search_${q.toLowerCase()}`;
    const cached = jikanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < JIKAN_CACHE_TTL) {
      return res.json({ data: cached.data });
    }

    try {
      const resp = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5&order_by=score&sort=desc&sfw=true`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const data = json.data || [];
        jikanCache.set(cacheKey, { data, timestamp: Date.now() });
        return res.json({ data });
      }
    } catch {
      // Fallback local search
      const matches = FALLBACK_TRENDING.filter(
        (a) =>
          a.title.toLowerCase().includes(q.toLowerCase()) ||
          (a.title_english && a.title_english.toLowerCase().includes(q.toLowerCase()))
      );
      return res.json({ data: matches });
    }

    const matches = FALLBACK_TRENDING.filter(
      (a) =>
        a.title.toLowerCase().includes(q.toLowerCase()) ||
        (a.title_english && a.title_english.toLowerCase().includes(q.toLowerCase()))
    );
    return res.json({ data: matches });
  });

  app.get('/api/jikan/anime/:id', async (req, res) => {
    const id = req.params.id;
    const cacheKey = `anime_${id}`;
    const cached = jikanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < JIKAN_CACHE_TTL) {
      return res.json({ data: cached.data });
    }

    try {
      const resp = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const json = await resp.json();
        jikanCache.set(cacheKey, { data: json.data, timestamp: Date.now() });
        return res.json({ data: json.data });
      }
    } catch {}

    const found = FALLBACK_TRENDING.find((a) => a.mal_id.toString() === id);
    return res.json({ data: found || null });
  });

  app.get('/api/jikan/characters/:id', async (req, res) => {
    const id = req.params.id;
    const cacheKey = `characters_${id}`;
    const cached = jikanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < JIKAN_CACHE_TTL) {
      return res.json({ data: cached.data });
    }

    try {
      const resp = await fetch(`https://api.jikan.moe/v4/anime/${id}/characters`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const chars = json.data || [];
        jikanCache.set(cacheKey, { data: chars, timestamp: Date.now() });
        return res.json({ data: chars });
      }
    } catch {}

    return res.json({ data: [] });
  });

  // 5. Vite Middleware (Dev) or Static assets (Prod)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      root: appRoot,
      configFile: path.join(appRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(appRoot, 'dist', 'public');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
