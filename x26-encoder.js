import { bitmask } from "./bit-utils.js";
import { hammingEncode24, hammingEncodeNybble } from "./parity.js";

/*
  ETS 300 706 Level 1.5
  ModifyCharacter mode 0x10 = modify character with diacritic
*/

const Mode = Object.freeze({
  SetActivePosition: 0x04,
  ModifyCharacter: 0x10,
  TerminationMarker: 0x1F
});

/*
  ETS accent codes
*/
const Accent = Object.freeze({
  Acute: 0x01,
  Caron: 0x0d,
  Ring: 0x09
});

/*
  Czech composition map
  base = ASCII character placed in row
  accent = ETS accent code
*/
const CZECH_MAP = new Map([
  ["á", { base: "a", accent: Accent.Acute }],
  ["č", { base: "c", accent: Accent.Caron }],
  ["ď", { base: "d", accent: Accent.Caron }],
  ["é", { base: "e", accent: Accent.Acute }],
  ["ě", { base: "e", accent: Accent.Caron }],
  ["í", { base: "i", accent: Accent.Acute }],
  ["ň", { base: "n", accent: Accent.Caron }],
  ["ó", { base: "o", accent: Accent.Acute }],
  ["ř", { base: "r", accent: Accent.Caron }],
  ["š", { base: "s", accent: Accent.Caron }],
  ["ť", { base: "t", accent: Accent.Caron }],
  ["ú", { base: "u", accent: Accent.Acute }],
  ["ů", { base: "u", accent: Accent.Ring }],
  ["ý", { base: "y", accent: Accent.Acute }],
  ["ž", { base: "z", accent: Accent.Caron }],

  ["Á", { base: "A", accent: Accent.Acute }],
  ["Č", { base: "C", accent: Accent.Caron }],
  ["Ď", { base: "D", accent: Accent.Caron }],
  ["É", { base: "E", accent: Accent.Acute }],
  ["Ě", { base: "E", accent: Accent.Caron }],
  ["Í", { base: "I", accent: Accent.Acute }],
  ["Ň", { base: "N", accent: Accent.Caron }],
  ["Ó", { base: "O", accent: Accent.Acute }],
  ["Ř", { base: "R", accent: Accent.Caron }],
  ["Š", { base: "S", accent: Accent.Caron }],
  ["Ť", { base: "T", accent: Accent.Caron }],
  ["Ú", { base: "U", accent: Accent.Acute }],
  ["Ů", { base: "U", accent: Accent.Ring }],
  ["Ý", { base: "Y", accent: Accent.Acute }],
  ["Ž", { base: "Z", accent: Accent.Caron }]
]);

export function packEnhancement(mode, address, data) {
  return (
    (address & bitmask(6)) |
    ((mode & bitmask(5)) << 6) |
    ((data & bitmask(7)) << 11)
  );
}

export default class X26Encoder {
  #enhancements = [];
  #packets;

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

    for (let col = 0; col < row.length; col++) {
      const char = row[col];
      const entry = CZECH_MAP.get(char);

      if (!entry) continue;

      // Place base ASCII in row
      row[col] = entry.base;

      if (firstEnhancement) {
        this.#enhancements.push({
          mode: Mode.SetActivePosition,
          address: 40 + rowLocation,
          data: 0
        });
        firstEnhancement = false;
      }

      // Apply diacritic modification
      this.#enhancements.push({
        mode: Mode.ModifyCharacter,
        address: col,
        data: entry.accent
      });
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
