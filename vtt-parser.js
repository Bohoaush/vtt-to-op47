/**
 * WebVTT file parser. Returns cues with start and end in seconds, and text.
 * @param {string} vttContent - Raw VTT file content
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function parseVTT(vttContent) {
  const lines = vttContent.split(/\r?\n/);
  const cues = [];
  let i = 0;

  // Skip optional BOM and WEBVTT header (support MM:SS.mmm or HH:MM:SS.mmm)
  while (i < lines.length && !/^\d{2}(:\d{2}){1,2}\.\d{3}\s*-->\s*\d{2}(:\d{2}){1,2}\.\d{3}/.test(lines[i])) {
    i++;
  }

  // Match HH:MM:SS.mmm (groups: h, m, s, ms) or MM:SS.mmm (h undefined, m, s, ms)
  const timeRegex = /^(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/;
  while (i < lines.length) {
    const timeLine = lines[i];
    const match = timeLine.match(timeRegex);
    if (!match) {
      i++;
      continue;
    }
    const toSeconds = (h, m, s, ms) => (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    i++;
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i].trim());
      i++;
    }
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      cues.push({ start, end, text });
    }
    i++;
  }

  return cues;
}
