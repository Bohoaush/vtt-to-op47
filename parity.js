import { bit, bitmask, byte } from "./bit-utils.js";

// Pre-built table of the hamming encoded values 0-15
const HammingTable = [0x15, 0x02, 0x49, 0x5E, 0x64, 0x73, 0x38, 0x2F, 0xD0, 0xC7, 0x8C, 0x9B, 0xA1, 0xB6, 0xFD, 0xEA];

/**
 * @param {number} byte Integer value in the range 0-255
 * @returns {[number,number]} Array of two bytes containing the hamming encoded values of the high- and low nybbles of the input
 */
export function hammingEncodeByte(byte) {
  return [HammingTable[byte >> 4], HammingTable[byte & 0x0F]]
}

/**
 * @param {number} nybble Integer value
 * @returns {number} The hamming encoded value of the low nybble (1-4 LSB) of the input
 */
export function hammingEncodeNybble(nybble) {
  return HammingTable[nybble & 0x0F]
}

/**
 * @param {number[]} tripple Array of three bytes representing the hamming encoded byte tripple
 * @returns {number} The decoded 18-bit value
 */
export function hammingDecodeTripple(tripple) {

  // Don't think the error correction is needed

  const bits12_18 = (tripple[2] & bitmask(7)) << 11;
  const bits5_11 = (tripple[1] & bitmask(7)) << 4;
  const bits2_4 = (tripple[0] & (bitmask(3) << 4)) >> 3;
  const bit1 = bit(tripple[0], 2);

  return bits12_18 | bits5_11 | bits2_4 | bit1;
}

/**
 * @param {number} value The 18-bit value to encode
 * @returns {[number,number,number]} Array of three bytes representing the hamming encoded byte tripple
 */
export function hammingEncode24(value) {

  const b = Array(18).fill(value).map((_, i) => bit(value, i));

  const c = Array(6);
  c[0] = !b[17] ^ b[15] ^ b[13] ^ b[11] ^ b[10] ^ b[8] ^ b[6] ^ b[4] ^ b[3] ^ b[1] ^ b[0]
  c[1] = !b[17] ^ b[16] ^ b[13] ^ b[12] ^ b[10] ^ b[9] ^ b[6] ^ b[5] ^ b[3] ^ b[2] ^ b[0]
  c[2] = !b[17] ^ b[16] ^ b[15] ^ b[14] ^ b[10] ^ b[9] ^ b[8] ^ b[7] ^ b[3] ^ b[2] ^ b[1]
  c[3] = !b[10] ^ b[9] ^ b[8] ^ b[7] ^ b[6] ^ b[5] ^ b[4]
  c[4] = !b[17] ^ b[16] ^ b[15] ^ b[14] ^ b[13] ^ b[12] ^ b[11]
  c[5] = b[17] ^ b[14] ^ b[12] ^ b[11] ^ b[10] ^ b[7] ^ b[5] ^ b[4] ^ b[2] ^ b[1] ^ b[0]

  const byte1 = byte(c[0], c[1], b[0], c[2], b[1], b[2], b[3], c[3]);
  const byte2 = byte(b[4], b[5], b[6], b[7], b[8], b[9], b[10], c[4]);
  const byte3 = byte(b[11], b[12], b[13], b[14], b[15], b[16], b[17], c[5]);
  return [byte1, byte2, byte3];
}

/**
 * Pre-build table of all values up to 127 with an odd parity bit applied.
 */
const OddParityTable127 = (function () {
  const table = [];
  // count the number of bits set in each integer in the range 0-127
  for (let i = 0; i < 128; i++) {
    let count = 0;

    for (let j = 0; j < 8; j++) {
      if (i & (1 << j)) {
        count++;
      }
    }

    // Include a parity bit in MSB if the bit count was even
    const parity = ((1 + count) % 2) * 0x80;
    table.push(i | parity);
  }
  return table;
})();

/** Apply odd parity to byte(s). Uses lower 7 bits as data; bit 7 is set for odd parity. Safe for bytes 0-255. */
export function applyParity(data) {
  if (data instanceof Uint8Array || Array.isArray(data)) {
    return data.map((value) => OddParityTable127[value & 0x7f]);
  }
  return OddParityTable127[data & 0x7f];
}
