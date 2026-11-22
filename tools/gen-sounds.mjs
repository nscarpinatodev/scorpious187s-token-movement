/**
 * Generates the built-in step sounds.
 *
 *   node tools/gen-sounds.mjs
 *
 * The sounds are synthesised rather than sampled so the module ships no
 * third-party audio and needs no attribution: a short low thump (a decaying
 * sine that drops in pitch) under a burst of filtered noise for the contact.
 * Two variants a few semitones apart are alternated so a run of steps does
 * not sound like a machine gun.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

/** Deterministic noise, so regenerating does not churn the committed files. */
function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0x80000000) - 1;
  };
}

function synthesise({ seconds, thumpFrom, thumpTo, noiseCutoff, seed }) {
  const length = Math.round(seconds * SAMPLE_RATE);
  const samples = new Float32Array(length);
  const noise = makeNoise(seed);
  let phase = 0;
  let filtered = 0;
  const smoothing = 1 - Math.exp((-2 * Math.PI * noiseCutoff) / SAMPLE_RATE);
  for (let n = 0; n < length; n++) {
    const t = n / SAMPLE_RATE;
    const frequency = thumpTo + ((thumpFrom - thumpTo) * Math.exp(-t * 45));
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    const thump = Math.sin(phase) * Math.exp(-t * 38);
    filtered += smoothing * (noise() - filtered);
    const contact = filtered * Math.exp(-t * 110);
    const attack = Math.min(1, t / 0.002);
    samples[n] = attack * ((thump * 0.8) + (contact * 0.9));
  }

  // Fade the tail to exactly zero so the file never ends on a click.
  const fade = Math.round(0.01 * SAMPLE_RATE);
  for (let n = 0; n < fade; n++) samples[length - 1 - n] *= n / fade;

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = 0.85 / peak;
  return samples.map((sample) => sample * gain);
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, n) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), n * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(out, { recursive: true });
const variants = [
  { name: 'step-1.wav', seconds: 0.13, thumpFrom: 210, thumpTo: 92, noiseCutoff: 2400, seed: 187 },
  { name: 'step-2.wav', seconds: 0.13, thumpFrom: 185, thumpTo: 80, noiseCutoff: 1900, seed: 1870 },
];
for (const { name, ...params } of variants) {
  const file = join(out, name);
  writeFileSync(file, toWav(synthesise(params)));
  console.log(`wrote ${file}`);
}
