import http from 'node:http';
import fs from 'node:fs/promises';
import { parseVTT } from './vtt-parser.js';
import { cuesToSegments } from './titling-engine.js';
import { CasparClient } from './caspar-client.js';
import { createOSCTimeSource } from './osc-time-source.js';

const GAP_BEFORE_CLEAR_S = 2;
const TICK_MS = 100;
const HTTP_PORT = (parseInt(process.env.HTTP_PORT, 10) || 8080);

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
  timeAddress: process.env.OSC_TIME_ADDRESS || '/channel/1/stage/layer/1/foreground/file/time',
});

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
