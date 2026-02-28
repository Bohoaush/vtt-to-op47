import { applyParity, hammingEncodeNybble } from "./parity.js";
import X26Encoder from "./x26-encoder.js";
/**
 * @typedef {import('stream').Writable} WriteStream
 */

const spaces = n => Array(n).fill(' ').join('');

/** Czech diacritical → base letter. Row must stay 7-bit (0x20–0x7F) so decoder shows a, c, r not weird glyphs. */
const CZECH_TO_BASE = new Map([
  ["á", "a"], ["č", "c"], ["ď", "d"], ["é", "e"], ["ě", "e"], ["í", "i"], ["ň", "n"], ["ó", "o"],
  ["ř", "r"], ["š", "s"], ["ť", "t"], ["ú", "u"], ["ů", "u"], ["ý", "y"], ["ž", "z"],
  ["Á", "A"], ["Č", "C"], ["Ď", "D"], ["É", "E"], ["Ě", "E"], ["Í", "I"], ["Ň", "N"], ["Ó", "O"],
  ["Ř", "R"], ["Š", "S"], ["Ť", "T"], ["Ú", "U"], ["Ů", "U"], ["Ý", "Y"], ["Ž", "Z"]
]);

function toBaseLetters(str) {
  return Array.from(str, c => CZECH_TO_BASE.get(c) ?? (c.codePointAt(0) <= 0x7F ? c : "?")).join("");
}

export default class WSTEncoder {

  #magazine = 0;  // valid values are 0-7, where 0 is interpreted as 8
  #page = 0x01;   // valid values are 0x00-0xFF
  #startRow; // valid values are 0-31
  #doubleHeight; // valid values are true or false

  #diacriticsEncoding = "x26";
  #x26Opts = {};

  /** @param {Object} opts
   *  @param {"latin2"|"x26"} [opts.diacriticsEncoding="x26"] - "x26": Czech via packet 26; "latin2": base letters only
   *  @param {"g2"|"compose"} [opts.caronEncoding="compose"] - caron: "compose" = base + diacritic index 15; "g2" = precomposed G2
   *  @param {number} [opts.caronDiacriticIndex=15] - when caronEncoding="compose", G2 col 4 index for caron (this decoder: 15)
   *  @param {"default"|"alt1"|"alt2"|"iso88592"} [opts.g2Variant="default"] - when caronEncoding="g2", which G2 code set
   */
  constructor({ startRow = 19, doubleHeight = false, magazine = 0, page = 0x01, diacriticsEncoding = "x26", caronEncoding, caronDiacriticIndex, g2Variant } = {}) {
    this.#magazine = magazine;
    this.#page = page;
    this.#startRow = startRow;
    this.#doubleHeight = doubleHeight;
    this.#diacriticsEncoding = diacriticsEncoding;
    const env = typeof process !== "undefined" && process.env ? process.env : {};
    const cEnc = caronEncoding ?? (env.CARON_ENCODING === "compose" || env.CARON_ENCODING === "g2" ? env.CARON_ENCODING : undefined);
    const cIdx = caronDiacriticIndex ?? (env.CARON_DIACRITIC_INDEX != null ? parseInt(env.CARON_DIACRITIC_INDEX, 10) : undefined);
    const g2 = g2Variant ?? (env.G2_VARIANT && ["default", "alt1", "alt2", "iso88592"].includes(env.G2_VARIANT) ? env.G2_VARIANT : undefined);
    if (cEnc != null) this.#x26Opts.caronEncoding = cEnc;
    if (cIdx != null && !Number.isNaN(cIdx)) this.#x26Opts.caronDiacriticIndex = cIdx;
    if (g2 != null) this.#x26Opts.g2Variant = g2;
  }

  #encodePrefix(magazine, packet) {
    
    // encode packet address (7.1.2)
    const x = magazine & 0x07;
    const y = packet & 0x1F;
    const byte4 = hammingEncodeNybble(x + ((y & 1) << 3))
    const byte5 = hammingEncodeNybble(y >> 1);

    return Uint8Array.from([
      0x55, 0x55, //clock run-in (6.1)
      0x27,       //framing code (6.2)
      byte4,      // packet address
      byte5,      // packet address
    ]);
  }

  #encodeHeaderPacket({ magazine, page, pageSubCode = 0, erase = 1 } = {}) {
    const header = this.#encodePrefix(magazine, 0);
    
    const pageUnits = page & 0xF; // (9.3.1.1)
    const pageTens = (page >> 4) & 0xF; // (9.3.1.1)
    
    // page sub-code (9.3.1.2) 
    let s1 = pageSubCode & 0xF;
    let s2 = (pageSubCode >> 4) & 0x7;
    let s3 = (pageSubCode >> 8) & 0xF;
    let s4 = (pageSubCode >> 12) & 0x3;

    // control bits (9.3.1.3)
    if(erase) {
      s2 |= (1 << 3); // erase page: control-bit C4
    }

    s4 |= (1 << 3);   // subtitle: control-bit C6

    let cb1 = 0;  
    cb1 |= 1          // suppress header: control-bit C7
    cb1 |= (1 << 1);  // update indicator: control-bit C8
    
    let cb2 = 0;      // C11 = 0 indicating "parallel mode", C12-C14 = 0 indicating english character set

    const pageControls = Uint8Array.from([pageUnits, pageTens, s1, s2, s3, s4, cb1, cb2].map(nybble => hammingEncodeNybble(nybble & 0xF)));

    const chars = Uint8Array.from(Array(32).fill(0x20)); // 32 spaces of padding. 0x20 have odd parity, so no need to apply parity
    return Uint8Array.from([...header, ...pageControls, ...chars]);
  }

  encodeDummy() {
    const headerPacket = this.#encodeHeaderPacket({
      magazine: this.#magazine,
      page: 0xFF,
      pageSubCode: 0x3F7E,
      erase: 0
    });

    return [headerPacket];
  }

  /**
   * TODO: Add support for double height
   * TODO: Add support for horizontal alignment
   * @param {number} startLine 
   * @param {string[]} rows 
   * @returns 
   */
  encodeSubtitle(rows, { startRow = this.#startRow } = {}) {
    // Encode header
    const headerPacket = this.#encodeHeaderPacket({
      magazine: this.#magazine,
      page: this.#page,
      erase: 1
    });

    if(!rows?.length)
      return [headerPacket];

    // Encode display rows, this will also create any needed enhancement packets
    const rowPackets = this.#encodeDisplayRows(startRow, rows);

    return [headerPacket, ...rowPackets];
  }

  /**
   * @param {number} startRow On which row to start displaying the text
   * @param {string[]} rows The rows of text to display
   */
  #encodeDisplayRows(startRow, rows) {
    if (this.#diacriticsEncoding === "latin2") {
      const textEncoder = new TextEncoder();
      return rows.map((text, i) => {
        const prefix = this.#encodePrefix(this.#magazine, startRow + i);
        const boxedText = `\x0b\x0b${text}\x0a\x0a${spaces(40 - text.length)}`.substring(0, 40);
        const baseStr = toBaseLetters(boxedText);
        const textBytes = textEncoder.encode(baseStr);
        const payload = applyParity(textBytes);
        return Uint8Array.from([...prefix, ...payload]);
      });
    }
    const textEncoder = new TextEncoder();
    const x26encoder = new X26Encoder(this.#x26Opts);
    const rowPackets = rows.map((text, i) => {
      const prefix = this.#encodePrefix(this.#magazine, startRow + i);
      const boxedText = `\x0b\x0b${text}\x0a\x0a${spaces(40 - text.length)}`.substring(0, 40);
      const textData = x26encoder.encodeRow(boxedText, startRow + i);
      const textBytes = textEncoder.encode(textData);
      const payload = applyParity(textBytes);
      return Uint8Array.from([...prefix, ...payload]);
    });
    const enhancementPackets = x26encoder.enhancementPackets.map((enhancement) => {
      const prefix = this.#encodePrefix(this.#magazine, 26);
      return Uint8Array.from([...prefix, ...enhancement]);
    });
    // Send enhancement packets first so decoder has diacritic data before row content
    return [...enhancementPackets, ...rowPackets];
  }
}
