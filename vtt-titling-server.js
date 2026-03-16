import http from 'node:http';
import fs from 'node:fs/promises';
import { parseVTT } from './vtt-parser.js';
import { cuesToSegments } from './titling-engine.js';
import { CasparClient } from './caspar-client.js';
import { createOSCTimeSource } from './osc-time-source.js';

const GAP_BEFORE_CLEAR_S = 2;
const TICK_MS = 100;
const HTTP_PORT = (parseInt(process.env.HTTP_PORT, 10) || 8080);
const SUBTITLE_ROOT = process.env.SUBTITLE_ROOT || '';
const MEDIA_ROOT = process.env.MEDIA_ROOT || '';
const SUBTITLE_ROOT_NORM = SUBTITLE_ROOT.replace(/[\\/]+$/, '');
const MEDIA_ROOT_NORM = MEDIA_ROOT.replace(/[\\/]+$/, '');

/** @type {{ start: number, end: number, lines: string[] }[]} */
let segments = [];
let lastShownSegmentIndex = -1;
let tickTimer = null;

/** "osc" = time from CasparCG OSC; "autonomous" = local clock from startAt (seconds in VTT) */
let timeMode = 'osc';
/** When timeMode === 'autonomous': VTT time at which we started (seconds). */
let autonomousStartAt = 0;
/** When timeMode === 'autonomous': wall-clock ms when we started (Date.now()). */
let autonomousStartWall = 0;

const caspar = new CasparClient({
  host: process.env.CASPAR_HOST || 'localhost',
  port: parseInt(process.env.CASPAR_PORT, 10) || 5250,
  channelLayer: process.env.CASPAR_CHANNEL_LAYER || '1-301',
});

const oscTime = createOSCTimeSource({
  port: parseInt(process.env.OSC_PORT, 10) || 6250,
});

/**
 * Map a media file path (from OSC) to a candidate VTT subtitle path.
 * Example:
 *   MEDIA_ROOT=/mnt/Video
 *   SUBTITLE_ROOT=/mnt/s1/video
 *   media: /mnt/Video/SeriesXY/SeriesXY_S01E01.MXF
 *   -> /mnt/s1/video/SeriesXY/subtitles/SeriesXY_S01E01.vtt
 *
 * Must also work with deeper paths:
 *   media: /mnt/Video/SeriesXY/S01/SeriesXY_S01E01.MXF
 *   -> /mnt/s1/video/SeriesXY/S01/subtitles/SeriesXY_S01E01.vtt
 */
function mapMediaPathToVtt(mediaPath) {
  if (!SUBTITLE_ROOT_NORM || !MEDIA_ROOT_NORM) return null;
  if (typeof mediaPath !== 'string' || !mediaPath) return null;
  const normPath = mediaPath.replace(/\\/g, '/');
  const normMediaRoot = MEDIA_ROOT_NORM.replace(/\\/g, '/');
  if (!normPath.startsWith(normMediaRoot)) return null;

  let rel = normPath.slice(normMediaRoot.length);
  if (rel.startsWith('/')) rel = rel.slice(1);

  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 1) return null;
  const filename = parts[parts.length - 1];
  const base = filename.replace(/\.[^.]+$/, '');
  if (!base) return null;
  const relDir = parts.slice(0, -1).join('/');
  const dirPart = relDir ? `/${relDir}` : '';
  return `${SUBTITLE_ROOT_NORM}${dirPart}/subtitles/${base}.vtt`;
}

let lastAutoVttPath = null;
let currentVttPath = null;
let currentVttIsAuto = false;

// Listen for file changes from OSC and auto-load subtitles when a matching VTT exists.
if (typeof oscTime.onFileChange === 'function') {
  oscTime.onFileChange(async (mediaPath) => {
    const vttPath = mapMediaPathToVtt(mediaPath);
    if (!vttPath) {
      // Media moved outside MEDIA_ROOT or mapping disabled.
      if (currentVttIsAuto) {
        stopTitling();
        lastAutoVttPath = null;
        currentVttPath = null;
        currentVttIsAuto = false;
        console.log('[AutoTitling] Stopped titling (no mapping for media)', mediaPath);
      }
      return;
    }
    if (vttPath === lastAutoVttPath) return;
    try {
      await fs.access(vttPath);
    } catch {
      // No matching subtitles for this file.
      if (currentVttIsAuto) {
        stopTitling();
        lastAutoVttPath = null;
        currentVttPath = null;
        currentVttIsAuto = false;
        console.log('[AutoTitling] Stopped titling (no subtitles for media)', mediaPath);
      }
      return;
    }
    try {
      const result = await loadVTT(vttPath, { timeMode: 'osc' });
      lastAutoVttPath = vttPath;
      currentVttPath = vttPath;
      currentVttIsAuto = true;
      console.log('[AutoTitling] Loaded subtitles from', vttPath, 'for media', mediaPath, '- cues:', result.cues);
    } catch (err) {
      console.error('[AutoTitling] Failed to load subtitles for', mediaPath, 'from', vttPath, '-', err.message);
    }
  });
}

function startTitling() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTitling() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  lastShownSegmentIndex = -1;
  caspar.clearTitle();
  currentVttPath = null;
  currentVttIsAuto = false;
}

function getCurrentTime() {
  if (timeMode === 'autonomous') {
    return autonomousStartAt + (Date.now() - autonomousStartWall) / 1000;
  }
  return oscTime.getTime();
}

function tick() {
  const t = getCurrentTime();
  if (t == null) return; // OSC mode and no time yet

  if (!segments.length) {
    if (lastShownSegmentIndex >= 0) {
      caspar.clearTitle();
      lastShownSegmentIndex = -1;
    }
    return;
  }

  let currentIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (t >= segments[i].start && t < segments[i].end) {
      currentIndex = i;
      break;
    }
  }

  if (currentIndex >= 0) {
    if (currentIndex !== lastShownSegmentIndex) {
      const seg = segments[currentIndex];
      caspar.sendTitle(seg.lines);
      lastShownSegmentIndex = currentIndex;
    }
    return;
  }

  // Not inside any segment: check if we just left one and whether to clear
  const nextSegmentStart = segments.find((s) => s.start > t)?.start;
  const gapToNext = nextSegmentStart != null ? nextSegmentStart - t : Infinity;
  if (lastShownSegmentIndex >= 0) {
    if (gapToNext > GAP_BEFORE_CLEAR_S) {
      caspar.clearTitle();
      lastShownSegmentIndex = -1;
    }
  }
}

/**
 * @param {string} vttPath
 * @param {{ timeMode?: 'osc' | 'autonomous', startAt?: number }} options
 */
async function loadVTT(vttPath, options = {}) {
  const content = await fs.readFile(vttPath, 'utf-8');
  const cues = parseVTT(content);
  segments = cuesToSegments(cues);
  lastShownSegmentIndex = -1;

  timeMode = options.timeMode === 'autonomous' ? 'autonomous' : 'osc';
  if (timeMode === 'autonomous') {
    autonomousStartAt = typeof options.startAt === 'number' ? options.startAt : 0;
    autonomousStartWall = Date.now();
  }

  startTitling();
  currentVttPath = vttPath;
  currentVttIsAuto = false;
  return { cues: cues.length, segments: segments.length, timeMode, startAt: timeMode === 'autonomous' ? autonomousStartAt : undefined };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && (url.pathname === '/titling' || url.pathname === '/titling/')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let data;
    try {
      data = JSON.parse(body || '{}');
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const vttPath = data.vttPath ?? data.path;
    if (!vttPath || typeof vttPath !== 'string') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing vttPath' }));
      return;
    }
    const timeModeOpt = data.timeMode;
    const startAt = data.startAt;
    if (timeModeOpt !== undefined && timeModeOpt !== 'osc' && timeModeOpt !== 'autonomous') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'timeMode must be "osc" or "autonomous"' }));
      return;
    }
    try {
      const result = await loadVTT(vttPath, {
        timeMode: timeModeOpt,
        startAt: typeof startAt === 'number' ? startAt : undefined,
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if ((req.method === 'POST' || req.method === 'DELETE') && url.pathname === '/titling/stop') {
    stopTitling();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, message: 'Titling stopped, title cleared' }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

caspar.connect();
server.listen(HTTP_PORT, () => {
  console.log('VTT-to-OP47 API listening on http://localhost:' + HTTP_PORT);
  console.log('  POST /titling     body: { "vttPath": "...", "timeMode": "osc"|"autonomous", "startAt": 0 }');
  console.log('  POST /titling/stop  or  DELETE /titling/stop  to stop and clear');
});

process.on('SIGINT', () => {
  stopTitling();
  oscTime.close();
  caspar.disconnect();
  server.close();
  process.exit(0);
});
