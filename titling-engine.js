/**
 * Converts VTT cues into display segments for WST (2 lines max per segment).
 * Use a safe line length (38) so the end of each line is visible; display may cut off 1–2 chars at 40.
 */

const MAX_LINES = 2;
/** Safe chars per line so end 2 chars in line are not cut off. */
const CHARS_PER_LINE = 38;
const CHARS_PER_SLIDE = CHARS_PER_LINE * MAX_LINES;

/**
 * Split text into words for wrapping.
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Wrap text into lines of at most maxChars. Prefer word boundaries.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function wrapLines(text, maxChars = CHARS_PER_LINE) {
  const result = [];
  const w = words(text);
  let line = '';
  for (const word of w) {
    const next = line ? line + ' ' + word : word;
    if (next.length <= maxChars) {
      line = next;
    } else {
      if (line) result.push(line);
      line = word.length <= maxChars ? word : word.slice(0, maxChars);
    }
  }
  if (line) result.push(line);
  return result;
}

/**
 * Split one cue into display segments (each at most 2 lines of 40 chars).
 * Duration is split proportionally by character count.
 * @param {{ start: number, end: number, text: string }} cue
 * @returns {{ start: number, end: number, lines: [string] }[]}
 */
export function cueToSegments(cue) {
  const { start, end, text } = cue;
  const duration = end - start;
  const allLines = wrapLines(text, CHARS_PER_LINE);

  const segments = [];
  for (let i = 0; i < allLines.length; i += MAX_LINES) {
    const chunk = allLines.slice(i, i + MAX_LINES).map((line) => line.slice(0, CHARS_PER_LINE));
    segments.push({ lines: chunk });
  }

  if (segments.length === 0) return [];
  if (segments.length === 1) {
    segments[0].start = start;
    segments[0].end = end;
    return segments;
  }

  const totalChars = allLines.join('').length;
  let elapsed = start;
  for (let s = 0; s < segments.length; s++) {
    const segChars = segments[s].lines.join('').length;
    const segDuration = duration * (segChars / totalChars);
    segments[s].start = elapsed;
    segments[s].end = elapsed + segDuration;
    elapsed += segDuration;
  }
  // Avoid rounding gap: last segment ends at cue end
  segments[segments.length - 1].end = end;
  return segments;
}

/**
 * Convert all VTT cues to flat list of display segments.
 * @param {{ start: number, end: number, text: string }[]} cues
 * @returns {{ start: number, end: number, lines: string[] }[]}
 */
export function cuesToSegments(cues) {
  const out = [];
  for (const cue of cues) {
    out.push(...cueToSegments(cue));
  }
  return out;
}
