import net from 'node:net';
import { Buffer } from 'node:buffer';
import WSTEncoder from './wst-encoder.js';


export class CasparClient {
  #host;
  #port;
  #channelLayer;
  #socket = null;
  #encoder = new WSTEncoder();
  #reconnectDelay = 2000;
  #reconnectTimer = null;

  constructor({ host = 'localhost', port = 5250, channelLayer = '1-301' } = {}) {
    this.#host = host;
    this.#port = port;
    this.#channelLayer = channelLayer;
  }

  connect() {
    if (this.#socket) return;
    this.#socket = new net.Socket();
    this.#socket.setEncoding('utf8');

    this.#socket.on('connect', () => {
      console.log('[Caspar] Connected to', this.#host + ':' + this.#port);
    });

    this.#socket.on('data', (data) => {
      // Optional: log responses
      if (process.env.DEBUG_CASPAR) console.log('[Caspar]', data.toString().trim());
    });

    this.#socket.on('error', (err) => {
      console.error('[Caspar] Socket error:', err.message);
    });

    this.#socket.on('close', () => {
      this.#socket = null;
      console.log('[Caspar] Disconnected, reconnecting in', this.#reconnectDelay, 'ms');
      this.#reconnectTimer = setTimeout(() => this.connect(), this.#reconnectDelay);
    });

    this.#socket.connect({ host: this.#host, port: this.#port, family: 4 });
  }

  disconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#socket) {
      this.#socket.destroy();
      this.#socket = null;
    }
  }

  get connected() {
    return !!this.#socket && !this.#socket.destroyed;
  }

  /**
   * Send subtitle lines (max 2 lines, each max 40 chars for WST).
   * @param {string[]} lines
   */
  sendTitle(lines) {
    if (!this.#socket || this.#socket.destroyed) return;
    const packets = this.#encoder.encodeSubtitle(lines);
    const payload = packets.map((data) => Buffer.from(data).toString('base64')).join(' ');
    const cmd = `APPLY ${this.#channelLayer} OP47 ${payload}\r\n`;
    this.#socket.write(cmd);
  }

  /**
   * Clear current subtitle by sending an empty OP47 packet with erase flag set.
   */
  clearTitle() {
    if (!this.#socket || this.#socket.destroyed) return;
    const packets = this.#encoder.encodeSubtitle([]);
    const payload = packets.map((data) => Buffer.from(data).toString('base64')).join(' ');
    this.#socket.write(`APPLY ${this.#channelLayer} OP47 ${payload}\r\n`);
  }
}
