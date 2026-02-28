import { bitmask } from "./bit-utils.js";
import { hammingEncode24, hammingEncodeNybble } from "./parity.js";

/*
  ETS 300 706 (Enhanced Teletext) Level 1.5 – packet X/26 enhancement data.
  OP-47 / VANC teletext follows ETS 300 706 / ITU-R BT.653. EN 300 743 is DVB-SUB (different system).
  Table 29: Column Address mode 10000 = G0 no diacritic; 10001–11111 = G0 with diacritical mark.
  The 4 LSBs of the mode select the diacritical from G2 column 4 (ascending order); data = 7-bit G0 code.

  Caron (č,ď,ě,ň,ř,š,ť,ž): default caronEncoding="compose", caronDiacriticIndex=15 (decoder G2 col 4 index for caron).
  Alternative: caronEncoding="g2" with g2Variant="default"|"alt1"|"alt2"|"iso88592". Env: CARON_ENCODING, CARON_DIACRITIC_INDEX, G2_VARIANT.
*/
const Mode = Object.freeze({
  SetActivePosition: 0x04,
  /** G0 with diacritical: mode 0x11–0x1F; 4 LSBs = diacritic index 1–15 per G2 col 4 */
  DiacriticBase: 0x11,
  /** Table 29: Character from G2 Supplementary Set – data = 7-bit G2 code (precomposed) */
  G2Character: 0x0f,
  TerminationMarker: 0x1F
});

/** G2 column 4 diacritical indices (1–15). This decoder: acute(2), ring(10), caron(15). */
const DiacriticIndex = Object.freeze({
  Grave: 1,
  Acute: 2,
  Circumflex: 3,
  Tilde: 4,
  Macron: 6,
  Breve: 7,
  Dot: 8,
  Diaeresis: 9,
  Ring: 10,   // ů
  Cedilla: 11,
  DoubleAcute: 12,
  Ogonek: 13,
  CedillaBelow: 14,
  Caron: 15   // č, ď, ě, ň, ř, š, ť, ž
});

/** G2 7-bit code sets for Czech caron letters (č,ď,ě,ň,ř,š,ť,ž + caps). Different decoders use different layouts. */
const G2_CARON_SETS = Object.freeze({
  default: { lower: [0x62, 0x64, 0x65, 0x6e, 0x72, 0x73, 0x74, 0x7a], upper: [0x42, 0x44, 0x45, 0x4e, 0x52, 0x53, 0x54, 0x5a] },
  alt1:    { lower: [0x63, 0x64, 0x65, 0x6e, 0x72, 0x73, 0x74, 0x79], upper: [0x43, 0x44, 0x45, 0x4e, 0x52, 0x53, 0x54, 0x59] },
  alt2:    { lower: [0x68, 0x6a, 0x6b, 0x70, 0x78, 0x79, 0x7a, 0x7e], upper: [0x48, 0x4a, 0x4b, 0x50, 0x58, 0x59, 0x5a, 0x5e] },
  /** ISO 8859-2 (Latin-2) code points with bit 7 stripped: standard 7-bit G2 mapping used by some decoders. */
  iso88592: { lower: [0x68, 0x6f, 0x6c, 0x72, 0x78, 0x39, 0x3b, 0x2e], upper: [0x48, 0x4f, 0x4c, 0x52, 0x58, 0x28, 0x2b, 0x2c] }
});
const CARON_LETTERS = ["č", "ď", "ě", "ň", "ř", "š", "ť", "ž"];
const CARON_LETTERS_UC = ["Č", "Ď", "Ě", "Ň", "Ř", "Š", "Ť", "Ž"];

function buildCzechMap(opts) {
  const caronEncoding = opts.caronEncoding ?? "compose";
  const caronDiacriticIndex = Math.max(1, Math.min(15, opts.caronDiacriticIndex ?? 15));
  const g2Variant = opts.g2Variant ?? "default";
  const g2Set = G2_CARON_SETS[g2Variant] ?? G2_CARON_SETS.default;
  const caronG2 = (char) => {
    const i = CARON_LETTERS.indexOf(char);
    if (i !== -1) return g2Set.lower[i];
    const j = CARON_LETTERS_UC.indexOf(char);
    if (j !== -1) return g2Set.upper[j];
    return null;
  };
  const base = (c) => (c === c.toUpperCase() ? c : c.toLowerCase());
  const map = new Map();
  const acuteRing = [
    ["á", "a", DiacriticIndex.Acute], ["é", "e", DiacriticIndex.Acute], ["í", "i", DiacriticIndex.Acute],
    ["ó", "o", DiacriticIndex.Acute], ["ú", "u", DiacriticIndex.Acute], ["ý", "y", DiacriticIndex.Acute],
    ["ů", "u", DiacriticIndex.Ring],
    ["Á", "A", DiacriticIndex.Acute], ["É", "E", DiacriticIndex.Acute], ["Í", "I", DiacriticIndex.Acute],
    ["Ó", "O", DiacriticIndex.Acute], ["Ú", "U", DiacriticIndex.Acute], ["Ý", "Y", DiacriticIndex.Acute],
    ["Ů", "U", DiacriticIndex.Ring]
  ];
  for (const [ch, b, diac] of acuteRing) {
    map.set(ch, { base: b, diacritic: diac, g2: null, useCompose: true });
  }
  const caronBase = { č: "c", ď: "d", ě: "e", ň: "n", ř: "r", š: "s", ť: "t", ž: "z" };
  for (const ch of CARON_LETTERS) {
    const g2 = caronEncoding === "g2" ? caronG2(ch) : null;
    map.set(ch, { base: caronBase[ch], diacritic: DiacriticIndex.Caron, g2, useCompose: caronEncoding === "compose", caronDiacriticIndex });
  }
  const caronBaseUC = { Č: "C", Ď: "D", Ě: "E", Ň: "N", Ř: "R", Š: "S", Ť: "T", Ž: "Z" };
  for (const ch of CARON_LETTERS_UC) {
    const g2 = caronEncoding === "g2" ? caronG2(ch) : null;
    map.set(ch, { base: caronBaseUC[ch], diacritic: DiacriticIndex.Caron, g2, useCompose: caronEncoding === "compose", caronDiacriticIndex });
  }
  return map;
}

/**
 * ETS 300 706: 18-bit enhancement triplet, LSB first in Hamming 24/18.
 * Standard order: Address (6 bits), Mode/Function (5), Data (7) → value = A | (M<<6) | (D<<11).
 */
export function packEnhancement(mode, address, data) {
  return (
    (address & bitmask(6)) |
    ((mode & bitmask(5)) << 6) |
    ((data & bitmask(7)) << 11)
  );
}

/**
 * @param {Object} [opts]
 * @param {"g2"|"compose"} [opts.caronEncoding="compose"] - "compose" = base + diacritic (mode 0x11+index); "g2" = precomposed G2 (mode 0x0F)
 * @param {number} [opts.caronDiacriticIndex=15] - G2 col 4 index for caron when caronEncoding="compose" (this decoder: 15)
 * @param {"default"|"alt1"|"alt2"|"iso88592"} [opts.g2Variant="default"] - which G2 7-bit code set when caronEncoding="g2"
 */
export default class X26Encoder {
  #enhancements = [];
  #packets;
  #czechMap;

  constructor(opts = {}) {
    this.#czechMap = buildCzechMap(opts);
  }

  #encodeX26Packet(packetNumber, enhancements) {
  const result = [hammingEncodeNybble(packetNumber)];

  for (const enhancement of enhancements) {
    const value = packEnhancement(
      enhancement.mode,
      enhancement.address,
      enhancement.data
    );

    result.push(...hammingEncode24(value));
  }

  // Fill up to 13 enhancements with termination markers
  if (enhancements.length < 13) {
    const fillers = 13 - enhancements.length;

    for (let i = 1; i <= fillers; i++) {
      result.push(
        ...hammingEncode24(
          packEnhancement(
            Mode.TerminationMarker,
            0x3f,
            i === fillers ? 0xff : 0x00
          )
        )
      );
    }
  }

  return result;
}

  encodeRow(str, rowLocation) {
    const row = Array.from(str);
    let firstEnhancement = true;
    const czechMap = this.#czechMap;

    for (let col = 0; col < row.length; col++) {
      const char = row[col];
      const entry = czechMap.get(char);

      if (!entry) continue;

      // ETS 300 706 12.3.2: row 24 = address 40, rows 1–23 = addresses 41–63
      const rowAddress = rowLocation === 24 ? 40 : (40 + rowLocation);

      // For G2 precomposed, put space in the row so the decoder shows only the G2 character (no base+diacritic composite)
      row[col] = (entry.g2 != null) ? " " : entry.base;

      if (firstEnhancement) {
        this.#enhancements.push({
          mode: Mode.SetActivePosition,
          address: rowAddress,
          data: 0
        });
        firstEnhancement = false;
      }

      if (entry.useCompose) {
        const idx = entry.caronDiacriticIndex ?? entry.diacritic;
        this.#enhancements.push({
          mode: Mode.DiacriticBase + (idx - 1),
          address: col,
          data: entry.base.charCodeAt(0) & 0x7f
        });
      } else if (entry.g2 != null) {
        this.#enhancements.push({ mode: Mode.G2Character, address: col, data: entry.g2 & 0x7f });
      } else {
        this.#enhancements.push({
          mode: Mode.DiacriticBase + (entry.diacritic - 1),
          address: col,
          data: entry.base.charCodeAt(0) & 0x7f
        });
      }
    }

    return row.join("");
  }

  get enhancementPackets() {
    if (!this.#packets) {
      this.#packets = [];
      const rowsNeeded = Math.ceil(this.#enhancements.length / 13);

      for (let i = 0; i < rowsNeeded; i++) {
        const slice = this.#enhancements.slice(i * 13, (i + 1) * 13);
        this.#packets.push(this.#encodeX26Packet(i, slice));
      }
    }

    return this.#packets;
  }
}
