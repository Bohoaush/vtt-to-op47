/**
 * Automatic test: runs each caron/G2 option with 5s delay, prepends test number to first line.
 * Usage: node op47-client-autotest.js [host=localhost] [port=5250]
 */
import net from "node:net";
import { Buffer } from "node:buffer";
import WSTEncoder from "./wst-encoder.js";

const host = process.argv[2] ?? "localhost";
const port = parseInt(process.argv[3], 10) || 5250;
const DELAY_MS = 5000;
const BASE_LINES = ["Loď čeří kýlem tůň", "obzvlášť v Grónské úžině."];

/** Each test: label (for logs) and WSTEncoder constructor opts for caron/G2. */
const TEST_OPTIONS = [
  { label: "1  G2 default", opts: { caronEncoding: "g2", g2Variant: "default" } },
  { label: "2  G2 alt1", opts: { caronEncoding: "g2", g2Variant: "alt1" } },
  { label: "3  G2 alt2", opts: { caronEncoding: "g2", g2Variant: "alt2" } },
  { label: "4  G2 iso88592", opts: { caronEncoding: "g2", g2Variant: "iso88592" } },
  { label: "5  compose index 3", opts: { caronEncoding: "compose", caronDiacriticIndex: 3 } },
  { label: "6  compose index 4", opts: { caronEncoding: "compose", caronDiacriticIndex: 4 } },
  { label: "7  compose index 5", opts: { caronEncoding: "compose", caronDiacriticIndex: 5 } },
  { label: "8  compose index 6", opts: { caronEncoding: "compose", caronDiacriticIndex: 6 } },
  { label: "9  compose index 7", opts: { caronEncoding: "compose", caronDiacriticIndex: 7 } },
  { label: "10 compose index 8", opts: { caronEncoding: "compose", caronDiacriticIndex: 8 } },
  { label: "11 compose index 13", opts: { caronEncoding: "compose", caronDiacriticIndex: 13 } },
  { label: "12 compose index 1", opts: { caronEncoding: "compose", caronDiacriticIndex: 1 } },
  { label: "13 compose index 9", opts: { caronEncoding: "compose", caronDiacriticIndex: 9 } },
  { label: "14 compose index 11", opts: { caronEncoding: "compose", caronDiacriticIndex: 11 } },
  { label: "15 compose index 12", opts: { caronEncoding: "compose", caronDiacriticIndex: 12 } },
  { label: "16 compose index 14", opts: { caronEncoding: "compose", caronDiacriticIndex: 14 } },
  { label: "17 compose index 15", opts: { caronEncoding: "compose", caronDiacriticIndex: 15 } },
];

function sendTest(testIndex) {
  const { label, opts } = TEST_OPTIONS[testIndex];
  const encoder = new WSTEncoder(opts);
  const firstLine = `${testIndex + 1}. ${BASE_LINES[0]}`;
  const rows = [firstLine, BASE_LINES[1]];
  const res = encoder.encodeSubtitle(rows);
  const payload = res.map((data) => Buffer.from(data).toString("base64")).join(" ");

  const client = new net.Socket();
  client.setEncoding("utf8");

  client.on("connect", () => {
    console.log(`[${new Date().toISOString()}] Test ${testIndex + 1}/${TEST_OPTIONS.length}: ${label}`);
    client.write("APPLY 1-301 OP47 " + payload + " \r\n", () => {
      console.log(`  Sent. Closing in 1s.`);
    });
  });

  client.on("error", (err) => {
    console.error(`  Error: ${err.message}`);
  });

  client.on("data", (data) => {
    console.log("  Server: " + String(data).trim());
  });

  client.connect({ host, family: 4, port }, () => {});

  setTimeout(() => {
    client.destroy();
  }, 1000);
}

console.log(`OP47 autotest: ${TEST_OPTIONS.length} options, ${DELAY_MS / 1000}s delay, host=${host} port=${port}\n`);

for (let i = 0; i < TEST_OPTIONS.length; i++) {
  setTimeout(() => sendTest(i), i * DELAY_MS);
}

setTimeout(() => {
  console.log("\nAutotest finished.");
  process.exit(0);
}, TEST_OPTIONS.length * DELAY_MS + 3000);
