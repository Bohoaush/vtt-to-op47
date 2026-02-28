import { Server } from 'node-osc';

/**
 * OSC receiver that listens for time (seconds) from CasparCG Server.
 * Configure CasparCG to send OSC to this host:port (e.g. OSC output in CasparCG server config).
 * CasparCG often sends e.g. /channel/1/stage/layer/1/foreground/file/time with a float (seconds).
 */

const DEFAULT_OSC_PORT = 6250;
const DEFAULT_TIME_ADDRESS = '/channel/1/stage/layer/1/foreground/file/time';
const DEBUG = process.env.DEBUG_OSC === '1' || process.env.DEBUG_OSC === 'true';

function parseTimeArg(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * @param {object} options
 * @param {number} [options.port]
 * @param {string} [options.timeAddress] - OSC address that carries current time in seconds (elapsed). Matched by exact string or by suffix (e.g. .../file/time).
 */
export function createOSCTimeSource(options = {}) {
  const port = options.port !== undefined ? options.port : (parseInt(process.env.OSC_PORT, 10) || DEFAULT_OSC_PORT);
  const timeAddress = options.timeAddress !== undefined ? options.timeAddress : (process.env.OSC_TIME_ADDRESS || DEFAULT_TIME_ADDRESS);
  const timeAddressNorm = timeAddress.replace(/\/+$/, '');
  const matchBySuffix = timeAddressNorm.endsWith('/time');

  let currentTimeSeconds = null;
  const oscServer = new Server(port, '0.0.0.0', () => {
    console.log('[OSC] Listening on port', port, 'for time at address:', timeAddressNorm, matchBySuffix ? '(suffix match)' : '');
  });

  function addressMatches(addr) {
    if (!addr || typeof addr !== 'string') return false;
    const a = addr.replace(/\/+$/, '');
    if (a === timeAddressNorm) return true;
    if (matchBySuffix && a.endsWith('/time')) return true;
    if (a.endsWith(timeAddressNorm)) return true;
    return false;
  }

  function handleMessage(msg) {
    const address = msg && msg[0];
    if (!addressMatches(address)) {
      if (DEBUG && msg && msg.length > 1) console.log('[OSC] skip address:', address, 'first arg:', msg[1]);
      return;
    }
    if (msg.length > 1) {
      const v = parseTimeArg(msg[1]);
      if (v !== null) {
        currentTimeSeconds = v;
        if (DEBUG) console.log('[OSC] time updated:', currentTimeSeconds, 'from', address);
      } else if (DEBUG) console.log('[OSC] unparseable time at', address, 'arg:', msg[1], typeof msg[1]);
    } else if (DEBUG) console.log('[OSC] no arg at', address);
  }

  oscServer.on('message', handleMessage);
  oscServer.on('bundle', (bundle) => {
    const elements = bundle.elements || [];
    for (const el of elements) {
      if (Array.isArray(el)) handleMessage(el);
      else if (el && typeof el.address === 'string' && Array.isArray(el.args)) {
        const vals = el.args.map((a) => (a && a.value !== undefined ? a.value : a));
        handleMessage([el.address].concat(vals));
      }
    }
  });

  oscServer.on('error', (err) => {
    console.error('[OSC] Error:', err.message);
  });

  return {
    getTime() {
      return currentTimeSeconds;
    },
    close() {
      oscServer.close();
    },
  };
}
