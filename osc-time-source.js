import dgram from 'node:dgram';

/**
 * OSC receiver that listens for time (seconds) and (optionally) current file path
 * from CasparCG Server.
 *
 * - Uses raw UDP + a minimal OSC parser so we can skip unsupported argument types
 *   (e.g. 'h' int64) that CasparCG sometimes sends, without depending on node-osc's decoder.
 * - Time is typically at:
 *   /channel/<ch>/stage/layer/<layer>/foreground/file/time
 * - File path is typically at:
 *   /channel/<ch>/stage/layer/<layer>/foreground/file/path
 *
 * Configure CasparCG to send OSC to this host:port (e.g. OSC output in CasparCG server config).
 */

const DEFAULT_OSC_PORT = 6250;
const DEBUG = process.env.DEBUG_OSC === '1' || process.env.DEBUG_OSC === 'true';

function align4(offset) {
  return (offset + 3) & ~3;
}

function readString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  if (end >= buffer.length) return null;
  const value = buffer.subarray(offset, end).toString('utf8');
  return { value, offset: align4(end + 1) };
}

function readInt32(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  return { value: buffer.readInt32BE(offset), offset: offset + 4 };
}

function readFloat32(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  return { value: buffer.readFloatBE(offset), offset: offset + 4 };
}

function readBlob(buffer, offset) {
  const lenResult = readInt32(buffer, offset);
  if (!lenResult || lenResult.value < 0) return null;
  const dataStart = lenResult.offset;
  const dataEnd = dataStart + lenResult.value;
  if (dataEnd > buffer.length) return null;
  return { offset: align4(dataEnd) };
}

/**
 * Parse one OSC message starting at offset. Returns { address, args, offset } or null.
 * Only decodes i, f, s; skips all other types
 */
function parseOSCMessage(buffer, offset) {
  const addr = readString(buffer, offset);
  if (!addr) return null;
  const tagsResult = readString(buffer, addr.offset);
  if (!tagsResult || !tagsResult.value.startsWith(',')) return null;
  const tags = tagsResult.value.slice(1);
  let off = tagsResult.offset;
  const args = [];
  for (const tag of tags) {
    switch (tag) {
      case 'i': {
        const r = readInt32(buffer, off);
        if (!r) return null;
        args.push(r.value);
        off = r.offset;
        break;
      }
      case 'f': {
        const r = readFloat32(buffer, off);
        if (!r) return null;
        args.push(r.value);
        off = r.offset;
        break;
      }
      case 's': {
        const r = readString(buffer, off);
        if (!r) return null;
        args.push(r.value);
        off = r.offset;
        break;
      }
      case 'h':
      case 'd':
        off += 8;
        break;
      case 'b': {
        const r = readBlob(buffer, off);
        if (!r) return null;
        off = r.offset;
        break;
      }
      case 'm':
        off += 4;
        break;
      case 'T':
        args.push(true);
        break;
      case 'F':
        args.push(false);
        break;
      case 'N':
        args.push(null);
        break;
      case 'c':
      case 'r':
        off += 4;
        break;
      case 't':
        off += 8;
        break;
      default:
        if (DEBUG) console.log('[OSC] skip unknown type tag:', tag);
        break;
    }
  }
  return { address: addr.value, args, offset: off };
}

/**
 * Parse an OSC bundle, dispatch each element to handleMessage.
 */
function parseOSCBundle(buffer, handleMessage) {
  if (buffer.length < 16) return;
  let offset = 8; // past "#bundle\0"
  offset += 8; // timetag
  while (offset + 4 <= buffer.length) {
    const size = buffer.readInt32BE(offset);
    offset += 4;
    if (size <= 0 || offset + size > buffer.length) return;
    const slice = buffer.subarray(offset, offset + size);
    offset += size;
    if (slice.length >= 8 && slice.subarray(0, 8).toString() === '#bundle\0') {
      parseOSCBundle(slice, handleMessage);
    } else {
      const msg = parseOSCMessage(slice, 0);
      if (msg) handleMessage(msg.address, msg.args);
    }
  }
}

function deriveDefaultTimeAddress(options = {}) {
  if (options.timeAddress !== undefined) return options.timeAddress;
  if (process.env.OSC_TIME_ADDRESS) return process.env.OSC_TIME_ADDRESS;

  let channel = options.channel;
  let layer = options.layer;

  if (channel == null) {
    const chEnv = process.env.OSC_CHANNEL;
    const chNum = chEnv != null ? parseInt(chEnv, 10) : NaN;
    channel = !Number.isNaN(chNum) ? chNum : 1;
  }

  if (layer == null) {
    const layerEnv = process.env.OSC_LAYER;
    const layerNum = layerEnv != null ? parseInt(layerEnv, 10) : NaN;
    layer = !Number.isNaN(layerNum) ? layerNum : 1;
  }

  return `/channel/${channel}/stage/layer/${layer}/foreground/file/time`;
}

function deriveDefaultFileAddress(options = {}) {
  if (options.fileAddress !== undefined) return options.fileAddress;
  if (process.env.OSC_FILE_ADDRESS) return process.env.OSC_FILE_ADDRESS;

  let channel = options.channel;
  let layer = options.layer;

  if (channel == null) {
    const chEnv = process.env.OSC_CHANNEL;
    const chNum = chEnv != null ? parseInt(chEnv, 10) : NaN;
    channel = !Number.isNaN(chNum) ? chNum : 1;
  }

  if (layer == null) {
    const layerEnv = process.env.OSC_LAYER;
    const layerNum = layerEnv != null ? parseInt(layerEnv, 10) : NaN;
    layer = !Number.isNaN(layerNum) ? layerNum : 1;
  }

  return `/channel/${channel}/stage/layer/${layer}/foreground/file/path`;
}

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
 * @param {string} [options.timeAddress] - OSC address that carries current time in seconds (elapsed). Matched by exact string or by suffix (e.g. .../file/time). Overrides channel/layer.
 * @param {string} [options.fileAddress] - OSC address that carries the current file path. Defaults to .../foreground/file/path for the same channel/layer as time.
 * @param {number} [options.channel] - Caspar channel number for time source (default from OSC_CHANNEL or 1).
 * @param {number} [options.layer] - Caspar layer number for time source (default from OSC_LAYER or 1).
 * @param {(path: string) => void | Promise<void>} [options.onFileChange] - Optional callback fired when current file path changes.
 */
export function createOSCTimeSource(options = {}) {
  const port = options.port !== undefined ? options.port : (parseInt(process.env.OSC_PORT, 10) || DEFAULT_OSC_PORT);
  const timeAddress = deriveDefaultTimeAddress(options);
  const timeAddressNorm = timeAddress.replace(/\/+$/, '');
  const matchBySuffix = timeAddressNorm.endsWith('/time');

  const fileAddress = deriveDefaultFileAddress(options);
  const fileAddressNorm = fileAddress.replace(/\/+$/, '');

  let currentTimeSeconds = null;
  let currentFilePath = null;
  const fileChangeHandlers = new Set();

  const socket = dgram.createSocket('udp4');

  function addressMatchesTime(addr) {
    if (!addr || typeof addr !== 'string') return false;
    const a = addr.replace(/\/+$/, '');
    if (a === timeAddressNorm) return true;
    if (matchBySuffix && a.endsWith('/time')) return true;
    if (a.endsWith(timeAddressNorm)) return true;
    return false;
  }

  function addressMatchesFile(addr) {
    if (!addr || typeof addr !== 'string') return false;
    const a = addr.replace(/\/+$/, '');
    if (a === fileAddressNorm) return true;
    // File address is usually exact; don't try suffix matching except exact.
    if (a.endsWith(fileAddressNorm)) return true;
    return false;
  }

  function fireFileChange(path) {
    if (!options.onFileChange && fileChangeHandlers.size === 0) return;
    for (const handler of fileChangeHandlers) {
      try {
        const res = handler(path);
        if (res && typeof res.then === 'function') {
          res.catch((err) => {
            if (DEBUG) console.error('[OSC] onFileChange handler error:', err.message);
          });
        }
      } catch (err) {
        if (DEBUG) console.error('[OSC] onFileChange handler error:', err.message);
      }
    }
    if (options.onFileChange) {
      try {
        const res = options.onFileChange(path);
        if (res && typeof res.then === 'function') {
          res.catch((err) => {
            if (DEBUG) console.error('[OSC] onFileChange option handler error:', err.message);
          });
        }
      } catch (err) {
        if (DEBUG) console.error('[OSC] onFileChange option handler error:', err.message);
      }
    }
  }

  function handleTime(address, args) {
    if (!addressMatchesTime(address)) {
      //if (DEBUG && args && args.length > 0) console.log('[OSC] skip address:', address, 'first arg:', args[0]);
      return;
    }
    if (args && args.length > 0) {
      const v = parseTimeArg(args[0]);
      if (v !== null) {
        currentTimeSeconds = v;
        if (DEBUG) console.log('[OSC] time updated:', currentTimeSeconds, 'from', address);
      } else if (DEBUG) console.log('[OSC] unparseable time at', address, 'arg:', args[0], typeof args[0]);
    } else if (DEBUG) console.log('[OSC] no arg at', address);
  }

  function handleFile(address, args) {
    if (!addressMatchesFile(address)) return;
    if (!args || args.length === 0) return;
    const maybePath = args[0];
    if (typeof maybePath !== 'string' || !maybePath) return;
    if (maybePath === currentFilePath) return;
    currentFilePath = maybePath;
    if (DEBUG) console.log('[OSC] file updated:', currentFilePath, 'from', address);
    fireFileChange(currentFilePath);
  }

  function dispatch(address, args) {
    handleTime(address, args);
    handleFile(address, args);
  }

  socket.on('message', (msg) => {
    if (msg.length < 8) return;
    try {
      if (msg.subarray(0, 8).toString() === '#bundle\0') {
        parseOSCBundle(msg, dispatch);
      } else {
        const parsed = parseOSCMessage(msg, 0);
        if (parsed) dispatch(parsed.address, parsed.args);
      }
    } catch (err) {
      if (DEBUG) console.error('[OSC] parse error:', err.message);
    }
  });

  socket.on('error', (err) => {
    console.error('[OSC] Error:', err.message);
  });

  socket.bind(port, '0.0.0.0', () => {
    console.log('[OSC] Listening on port', port, 'for time at address:', timeAddressNorm, matchBySuffix ? '(suffix match)' : '');
  });

  return {
    getTime() {
      return currentTimeSeconds;
    },
    getFile() {
      return currentFilePath;
    },
    /**
     * Subscribe to file changes reported over OSC.
     * Returns an unsubscribe function.
     */
    onFileChange(handler) {
      fileChangeHandlers.add(handler);
      return () => {
        fileChangeHandlers.delete(handler);
      };
    },
    close() {
      socket.close();
    },
  };
}
