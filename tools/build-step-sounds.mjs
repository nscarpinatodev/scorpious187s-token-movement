/**
 * Builds the armor step sounds from three public-domain (CC0) packs.
 *
 *   node tools/build-step-sounds.mjs <folder holding the unpacked packs> [outDir]
 *
 * The folder is expected to hold the three archives unpacked side by side:
 *
 *   footsteps/         "Footsteps Leather, Cloth, Armor" by HaelDB
 *                      https://opengameart.org/content/footsteps-leather-cloth-armor
 *   kenney_rpg-audio/  "RPG Audio" by Kenney
 *                      https://kenney.nl/assets/rpg-audio
 *   rpg_sound_pack/    "RPG Sound Pack" by artisticdude
 *                      https://opengameart.org/content/rpg-sound-pack
 *
 * HaelDB's clips are the rustle of what is worn, recorded quietly to sit on
 * top of a footfall rather than to be one. So each step here is a footfall
 * from Kenney's pack with the worn layer over it: cloth for unarmored, leather
 * for light, leather and mail for medium, plate with a trace of mail for
 * heavy. Each class gets four variants so a walk does not repeat one sample.
 *
 * Needs ffmpeg on the PATH (decoding, the footfall's tone filter, and the
 * Ogg Vorbis encode). The mixing itself is done here so levels are exact.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const packs = process.argv[2];
if (!packs || !existsSync(packs)) {
  console.error('usage: node tools/build-step-sounds.mjs <folder holding the unpacked packs> [outDir]');
  process.exit(1);
}
const out = process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'steps');
mkdirSync(out, { recursive: true });

const worn = (name) => join(packs, 'footsteps', 'footsteps', name);
const fall = (name) => join(packs, 'kenney_rpg-audio', 'Audio', name);
const mail = (name) => join(packs, 'rpg_sound_pack', 'RPG Sound Pack', 'inventory', name);

/** Decode to mono floats, optionally through an ffmpeg audio filter. */
function decode(path, filter) {
  if (!existsSync(path)) throw new Error(`missing source: ${path}`);
  const args = ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE)];
  if (filter) args.push('-af', filter);
  const result = spawnSync('ffmpeg', [...args, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${result.stderr}`);
  const bytes = result.stdout;
  return Float32Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)));
}

const peakOf = (x) => x.reduce((top, v) => Math.max(top, Math.abs(v)), 0) || 1e-9;
const gain = (db) => 10 ** (db / 20);
const samples = (seconds) => Math.round(seconds * RATE);

/** Scale to a peak of 1. */
function normalise(x) {
  const peak = peakOf(x);
  return x.map((v) => v / peak);
}

/**
 * Drop everything before the impact, and fade the very end so a recording
 * that stops short does not stop with a tick.
 *
 * The start is found by walking back from the loudest moment until the sound
 * has been quiet for a few milliseconds. Looking for the first sound instead
 * is wrong for these recordings: some have a faint scuff a tenth of a second
 * before the foot comes down, and starting there lands the footfall late,
 * after the worn layer, as a click of its own.
 */
function trimToImpact(x, db = -20) {
  const peak = peakOf(x);
  const threshold = peak * gain(db);
  const window = samples(0.004);
  let start = x.findIndex((v) => Math.abs(v) >= peak * 0.999);
  while (start > 0) {
    const from = Math.max(start - window, 0);
    let top = 0;
    for (let i = from; i < start; i++) top = Math.max(top, Math.abs(x[i]));
    if (top < threshold) break;
    start = from;
  }
  const trimmed = x.slice(Math.max(start - samples(0.002), 0));
  fade(trimmed, 0.001, 0.02);
  return trimmed;
}

/** A stretch of a longer recording, faded at both ends. */
function slice(x, start, length, fadeIn = 0.012, fadeOut = 0.14) {
  const part = x.slice(samples(start), samples(start + length));
  fade(part, fadeIn, fadeOut);
  return part;
}

function fade(x, fadeIn, fadeOut) {
  const a = Math.min(samples(fadeIn), x.length); const b = Math.min(samples(fadeOut), x.length);
  for (let i = 0; i < a; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i] *= i / b;
}

/** Sum layers `[samples, dB]`, cap the length, and set the peak. */
function mix(layers, peakDb, maxSeconds = 0.36) {
  const length = Math.min(Math.max(...layers.map(([x]) => x.length)), samples(maxSeconds));
  const sum = new Float32Array(length);
  for (const [x, db] of layers) {
    const g = gain(db);
    for (let i = 0; i < Math.min(x.length, length); i++) sum[i] += x[i] * g;
  }
  fade(sum, 0.001, 0.05);
  const scale = gain(peakDb) / peakOf(sum);
  return sum.map((v) => v * scale);
}

function encode(x, name) {
  const path = join(out, name);
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-',
    '-c:a', 'libvorbis', '-q:a', '5', '-map_metadata', '-1', path,
  ], { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength) });
  if (result.status !== 0) throw new Error(`ffmpeg could not write ${path}: ${result.stderr}`);
}

/* ---------------- Sources ---------------- */

// Footfalls with one clean impact (the others in the pack are double sounds).
const FOOTFALLS = ['footstep05.ogg', 'footstep07.ogg', 'footstep08.ogg', 'footstep03.ogg'];
const footfalls = (filter) => FOOTFALLS.map((name) => normalise(trimToImpact(decode(fall(name), filter))));

const soft = footfalls('lowpass=f=1800');   // a soft shoe or a bare foot
const plain = footfalls(null);              // a boot
const weighty = footfalls('bass=g=5:f=110'); // a boot with a lot on top of it

// The worn layers are used whole: they are a rustle around the step, recorded
// to start with it. Only their ends are faded.
const layer = (names) => names.map((name) => {
  const x = normalise(decode(worn(name)));
  fade(x, 0.001, 0.02);
  return x;
});
const cloth = layer(['step_cloth1.ogg', 'step_cloth2.ogg', 'step_cloth3.ogg', 'step_cloth4.ogg']);
const leather = layer(['step_lth1.ogg', 'step_lth2.ogg', 'step_lth33.ogg', 'step_lth4.ogg']);
const plate = layer(['step_metal.ogg', 'step_metal (2).ogg', 'step_metal (3).ogg', 'step_metal (4).ogg']);

const mail1 = normalise(decode(mail('chainmail1.wav')));
const mail2 = normalise(decode(mail('chainmail2.wav')));
const chain = [slice(mail1, 0.03, 0.3), slice(mail2, 0.01, 0.3), slice(mail1, 0.13, 0.3), slice(mail2, 0.15, 0.3)];

/* ---------------- The four classes ---------------- */

// [footfall dB, worn layer dB, mail dB or null], then the peak of the result.
// The classes get louder as they get heavier, the way they would in a room.
const CLASSES = {
  unarmored: { fall: soft, fallDb: -7, worn: cloth, wornDb: -5, chainDb: null, peakDb: -9 },
  light: { fall: plain, fallDb: -6, worn: leather, wornDb: -4, chainDb: null, peakDb: -7 },
  medium: { fall: plain, fallDb: -6, worn: leather, wornDb: -7, chainDb: -9, peakDb: -5 },
  heavy: { fall: weighty, fallDb: -4, worn: plate, wornDb: -3, chainDb: -15, peakDb: -3 },
};

for (const [name, recipe] of Object.entries(CLASSES)) {
  for (let i = 0; i < 4; i++) {
    const layers = [[recipe.fall[i], recipe.fallDb], [recipe.worn[i], recipe.wornDb]];
    if (recipe.chainDb !== null) layers.push([chain[i], recipe.chainDb]);
    encode(mix(layers, recipe.peakDb), `${name}-${i + 1}.ogg`);
  }
}
console.log(`wrote ${Object.keys(CLASSES).length * 4} step sounds to ${out}`);
