import net from 'node:net';

const DEBUG = process.env.DEBUG_AIRBOX === '1' || process.env.DEBUG_AIRBOX === 'true';

/**
 * AirBOX watcher that polls TCP status and notifies when
 * the currently playing file changes. It also exposes the
 * elapsed time so we can align autonomous titling.
 */

function resolveConfig(options = {}) {
  const host = options.host || process.env.AIRBOX_HOST;
  const port = options.port != null
    ? options.port
    : (process.env.AIRBOX_PORT != null ? parseInt(process.env.AIRBOX_PORT, 10) : 7000);
  return { host, port };
}

function parseBurst(infodata) {
  const regex1 = infodata.match(
    /"(?<dir>[A-Z]:\\(?:[^"\\]+\\)*)(?<file>[^"\\]+)";[^;]*;(?<end>[^;]+)/
  );

  const regex2 = infodata.match(
    /#ELAPSED\s+(?<elapsed>[0-9]+(?:\.[0-9]+)?)/
  );

  if (!regex1 || !regex2) return null;

  const { dir, file, end } = regex1.groups;
  const { elapsed } = regex2.groups;

  const mediaPathWin = `${dir}${file}`;
  const mediaPath = mediaPathWin.replace(/\\/g, '/');

  const elapsedNum = Number(elapsed);
  const endNum = Number(end);
  const remainingMs = (endNum - elapsedNum) * 1000;

  return {
    dir,
    file,
    mediaPath,
    elapsed: elapsedNum,
    end: endNum,
    remainingMs: Number.isFinite(remainingMs) ? remainingMs : 1000,
  };
}

function fetchOnce({ host, port }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port, host });
    let buffer = '';
    let settled = false;

    sock.setEncoding('utf8');

    sock.on('connect', () => {
      sock.write('\r\n');
    });

    sock.on('data', (chunk) => {
      buffer += chunk;

      if (buffer.includes('\nEND') || buffer.trimEnd().endsWith('END')) {
        if (!settled) {
          settled = true;
          sock.end();
          resolve(buffer);
        }
      }
    });

    sock.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    sock.setTimeout(5000, () => {
      if (!settled) {
        settled = true;
        reject(new Error('Socket timeout'));
      }
      sock.destroy();
    });
  });
}

/**
 * Start polling AirBOX for the currently playing file.
 *
 * @param {object} options
 * @param {string} [options.host] - AirBOX host (fallback AIRBOX_HOST)
 * @param {number} [options.port] - AirBOX port (fallback AIRBOX_PORT or 7000)
 *
 * @returns {{
 *   onFileChange(handler: (info: { mediaPath: string, elapsed: number, end: number }) => void): () => void,
 *   getCurrentFile(): string | null,
 *   getCurrentElapsed(): number | null,
 *   stop(): void,
 * }}
 */
export function createAirboxWatcher(options = {}) {
  const { host, port } = resolveConfig(options);

  let stopped = false;
  let currentFile = null;
  let currentElapsed = null;
  const fileChangeHandlers = new Set();
  if (DEBUG) console.log('[AirBOX] watcher started for', host + ':' + port);

  function fireFileChange(info) {
    if (DEBUG) {
      console.log(
        '[AirBOX] playing',
        info.mediaPath,
        'elapsed',
        info.elapsed,
        'end',
        info.end
      );
    }
    for (const handler of fileChangeHandlers) {
      try {
        const res = handler(info);
        if (res && typeof res.then === 'function') {
          res.catch(() => {});
        }
      } catch {
        // ignore handler errors here; caller can log if needed
      }
    }
  }

  async function loop() {
    let timeoutMs = 1000;
    while (!stopped) {
      try {
        const raw = await fetchOnce({ host, port });
        const parsed = parseBurst(raw);
        if (!parsed) {
          timeoutMs = 1000;
        } else {
          const { mediaPath, elapsed, end, remainingMs } = parsed;
          timeoutMs = remainingMs > 0 ? remainingMs : 1000;

          if (mediaPath !== currentFile) {
            currentFile = mediaPath;
            currentElapsed = elapsed;
            fireFileChange({ mediaPath, elapsed, end });
          } else {
            currentElapsed = elapsed;
          }
        }
      } catch {
        timeoutMs = 1000;
      }

      if (stopped) break;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) timeoutMs = 1000;
      await new Promise((r) => setTimeout(r, timeoutMs));
    }
  }

  // fire first poll immediately
  loop();

  return {
    onFileChange(handler) {
      fileChangeHandlers.add(handler);
      return () => {
        fileChangeHandlers.delete(handler);
      };
    },
    getCurrentFile() {
      return currentFile;
    },
    getCurrentElapsed() {
      return currentElapsed;
    },
    stop() {
      stopped = true;
    },
  };
}

