/**
 * Builds the hoof and wing sounds from two public-domain (CC0) recordings.
 *
 *   node tools/build-creature-sounds.mjs <grass.mp3> <wings_flap_large.flac> [outDir]
 *
 *   grass.mp3              from "Horse gallop on different surfaces" by congusbongus
 *                          https://opengameart.org/content/horse-gallop-on-different-surfaces
 *                          derived from "SRS_Foley_Horse_Galloping.wav" by StephenSaldanha
 *                          https://freesound.org/people/StephenSaldanha/sounds/165532/
 *   wings_flap_large.flac  "Large Wings Flap" by AntumDeluge
 *                          https://opengameart.org/content/large-wings-flap
 *                          based on "fast simple chop 5" by dave.des
 *                          https://freesound.org/s/127197/
 *
 * The gallop is one stride: three hoofbeats in under two tenths of a second,
 * then the rest of the stride. The recording also has ticks in it, most of
 * them in the quiet part: a few milliseconds each, and several times louder
 * than the sound round them. Played once they pass; played stride after stride
 * they are a click track. They are found and turned down here, and nothing
 * else about the recording is changed.
 *
 * The wings are three flaps a second apart, and all three are the same flap.
 * One is written out, for the module to play as often as a flight needs.
 *
 * Needs ffmpeg on the PATH (decoding and the Ogg Vorbis encode).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const [gallopPath, wingsPath] = process.argv.slice(2);
if (!gallopPath || !wingsPath || !existsSync(gallopPath) || !existsSync(wingsPath)) {
  console.error('usage: node tools/build-creature-sounds.mjs <grass.mp3> <wings_flap_large.flac> [outDir]');
  process.exit(1);
}
const out = process.argv[4] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

function decode(path) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${result.stderr}`);
  const bytes = result.stdout;
  return Float32Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)));
}

function encode(x, name) {
  const path = join(out, name);
  mkdirSync(dirname(path), { recursive: true });
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-',
    '-c:a', 'libvorbis', '-q:a', '5', '-map_metadata', '-1', path,
  ], { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength) });
  if (result.status !== 0) throw new Error(`ffmpeg could not write ${path}: ${result.stderr}`);
}

const peakOf = (x) => x.reduce((top, v) => Math.max(top, Math.abs(v)), 0) || 1e-9;
const gain = (db) => 10 ** (db / 20);
const samples = (seconds) => Math.round(seconds * RATE);
const ms = (index) => ((index / RATE) * 1000).toFixed(1);

function fade(x, fadeIn, fadeOut) {
  const a = Math.min(samples(fadeIn), x.length); const b = Math.min(samples(fadeOut), x.length);
  for (let i = 0; i < a; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i] *= i / b;
}

/** Scale to a peak, given in decibels below full scale. */
function level(x, peakDb) {
  const scale = gain(peakDb) / peakOf(x);
  return x.map((v) => v * scale);
}

/**
 * Find ticks and turn them down to the level of what surrounds them.
 *
 * The recording is looked at a millisecond at a time. A millisecond is loud
 * when its peak is two and a half times the usual level of the thirty
 * milliseconds either side of it. Loud stretches less than three milliseconds
 * apart count as one.
 *
 * A tick is a loud stretch that is both short and sharp. Short is eight
 * milliseconds or less: a hoofbeat is loud for longer. Sharp is how hard the
 * wave turns for its height (the largest second difference over the peak, at
 * 44.1 kHz): a hoof on grass is a thud and measures 0.3 to 0.9, and the ticks
 * in this recording measure 1.3 to 2.8. The line is drawn at 1.2. Both tests
 * are needed, because the third hoofbeat is weak enough to be loud only in
 * two short pieces.
 *
 * Each millisecond of a tick is scaled down to the usual level round it.
 *
 * @returns {{at: number, length: number, by: number}[]} Each tick: where it
 *   was and how long it lasted, in milliseconds, and how far it was turned
 *   down at most, in decibels
 */
function declick(x) {
  const window = samples(0.001);
  const count = Math.floor(x.length / window);
  const peaks = new Float32Array(count);
  const turns = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    for (let i = Math.max(k * window, 1); i < Math.min((k + 1) * window, x.length - 1); i++) {
      peaks[k] = Math.max(peaks[k], Math.abs(x[i]));
      turns[k] = Math.max(turns[k], Math.abs(x[i + 1] - (2 * x[i]) + x[i - 1]));
    }
  }
  const floor = 0.03 * peakOf(x);
  const usual = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const near = [];
    for (let j = Math.max(k - 30, 0); j <= Math.min(k + 30, count - 1); j++) if (Math.abs(j - k) > 6) near.push(peaks[j]);
    near.sort((p, q) => p - q);
    usual[k] = near[near.length >> 1];
  }
  const loud = Array.from(peaks, (peak, k) => (peak > floor) && (peak > 2.5 * usual[k]));

  // Loud stretches, with gaps of under three milliseconds closed.
  const stretches = [];
  for (let k = 0; k < count; k++) {
    if (!loud[k]) continue;
    const last = stretches.at(-1);
    if (last && (k - last[1] <= 3)) last[1] = k;
    else stretches.push([k, k]);
  }

  const gains = new Float32Array(x.length).fill(1);
  const ticks = [];
  for (const [from, to] of stretches) {
    if (to - from + 1 > 8) continue;
    let sharp = 0;
    for (let k = from; k <= to; k++) sharp += turns[k] / (peaks[k] || 1e-9);
    if (sharp / (to - from + 1) < 1.2) continue;
    let most = 1;
    for (let k = from; k <= to; k++) {
      const g = Math.min(1, usual[k] / (peaks[k] || 1e-9));
      most = Math.min(most, g);
      gains.fill(g, k * window, (k + 1) * window);
    }
    // A tick does not start on a millisecond: the one before and the one after
    // hold its edges, and are too quiet themselves to be missed.
    if (from > 0) gains.fill(most, (from - 1) * window, from * window);
    if (to + 1 < count) gains.fill(most, (to + 1) * window, (to + 2) * window);
    ticks.push({ at: from, length: to - from + 1, by: Math.round(20 * Math.log10(most)) });
  }

  // Ease in and out of each change over a millisecond, so turning a tick down
  // does not make an edge of its own.
  const eased = new Float32Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += gains[i];
    if (i >= window) sum -= gains[i - window];
    eased[i] = sum / Math.min(i + 1, window);
  }
  const half = window >> 1;
  for (let i = 0; i < x.length; i++) x[i] *= eased[Math.min(i + half, x.length - 1)];
  return ticks;
}

/** The stretches of a recording that are not silence, each with a little room either side. */
function sounds(x, quietDb = -48, gapSeconds = 0.08) {
  const threshold = peakOf(x) * gain(quietDb);
  const gap = samples(gapSeconds);
  const parts = [];
  let start = -1; let last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) < threshold) continue;
    if ((start >= 0) && (i - last > gap)) { parts.push([start, last]); start = -1; }
    if (start < 0) start = i;
    last = i;
  }
  if (start >= 0) parts.push([start, last]);
  return parts.map(([from, to]) => x.slice(Math.max(from - samples(0.004), 0), Math.min(to + samples(0.03), x.length)));
}

/* ---------------- Hooves ---------------- */

const stride = decode(gallopPath);
const ticks = declick(stride);
fade(stride, 0.001, 0.04);
encode(level(stride, -5), 'steps/hooves-1.ogg');
console.log(`hooves: one stride of ${ms(stride.length)} ms; ${ticks.length} ticks turned down: ${ticks.map((tick) => `${tick.at} ms (${tick.length} ms, ${tick.by} dB)`).join(', ')}`);

/* ---------------- Wings ---------------- */

// The recording is one flap played three times, so one is all there is to keep.
const flaps = sounds(decode(wingsPath));
const flap = flaps[0];
fade(flap, 0.004, 0.04);
encode(level(flap, -8), 'flight/wings-1.ogg');
console.log(`wings: one flap of ${ms(flap.length)} ms, the first of ${flaps.length} in the recording`);
