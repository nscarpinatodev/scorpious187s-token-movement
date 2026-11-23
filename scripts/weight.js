/**
 * Big creatures sound big. A step from a token two or more spaces across is
 * played lower, with more bass, and rings in the room after it lands.
 *
 * It is done as the sound is played rather than as more recordings, so it
 * applies to every set of steps, the world's custom file included.
 *
 * The size is the token's footprint, which is the one thing every game system
 * agrees on: two spaces across is Large, three Huge, four or more Gargantuan.
 */

/** Footprints that change the sound, smallest first. */
export const SIZE_CLASSES = Object.freeze(['large', 'huge', 'gargantuan']);

/**
 * What each size does to a step.
 *   detune   cents the step is played lower by (100 to a semitone)
 *   bassDb   lift below BASS_HZ, in decibels
 *   wet      how much of the room is mixed in beside the step itself
 *   tail     seconds the room takes to die away
 *   trim     decibels taken off the whole, so the lift does not clip
 */
export const SIZE_EFFECTS = Object.freeze({
  large: Object.freeze({ detune: -200, bassDb: 6, wet: 0.35, tail: 0.6, trim: -2 }),
  huge: Object.freeze({ detune: -400, bassDb: 9, wet: 0.5, tail: 0.9, trim: -3.5 }),
  gargantuan: Object.freeze({ detune: -650, bassDb: 12, wet: 0.6, tail: 1.4, trim: -6 }),
});

/** Everything below this is lifted. */
export const BASS_HZ = 160;

/**
 * @param {object} token  A Token or a TokenDocument
 * @returns {'large'|'huge'|'gargantuan'|null}  null for anything one space across or smaller
 */
export function sizeClassOf(token) {
  const document = token?.document ?? token;
  const across = Math.max(Number(document?.width) || 0, Number(document?.height) || 0);
  if (across >= 4) return 'gargantuan';
  if (across >= 3) return 'huge';
  if (across >= 2) return 'large';
  return null;
}

/** A small repeatable random source, so the room is the same every session. */
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 2147483648) - 1;
  };
}

/**
 * The room a big step rings in: noise that dies away over `tail` seconds, dull
 * rather than bright, so it reads as weight in a hall and not as a hiss. The
 * first few milliseconds are silent, which keeps the step itself distinct from
 * what follows it.
 *
 * @param {number} sampleRate
 * @param {number} tail        Seconds to fall by 60 dB
 * @returns {[Float32Array, Float32Array]}  Left and right
 */
export function impulseResponse(sampleRate, tail) {
  const gap = Math.round(sampleRate * 0.012);
  const length = gap + Math.max(1, Math.round(sampleRate * tail));
  const decay = Math.log(1000) / (sampleRate * tail);
  // One-pole low-pass at about 1.4 kHz.
  const smooth = 1 - Math.exp((-2 * Math.PI * 1400) / sampleRate);
  return [0x51ED270B, 0x2F6E2B1].map((seed) => {
    const random = noise(seed);
    const channel = new Float32Array(length);
    let held = 0;
    for (let i = gap; i < length; i++) {
      held += smooth * (random() - held);
      channel[i] = held * Math.exp(-decay * (i - gap));
    }
    return channel;
  });
}

/** One set of effect nodes per size, per audio context, made on first use. */
const buses = new WeakMap();

/**
 * Where a step of this size should be sent in place of the context's own
 * output. The nodes are shared and stay connected, which is what lets the
 * room go on ringing after the step's own sound has ended and been taken
 * apart.
 *
 * @param {AudioContext} context
 * @param {'large'|'huge'|'gargantuan'} size
 * @returns {AudioNode|null}  null if the browser cannot build it
 */
export function busFor(context, size) {
  const effect = SIZE_EFFECTS[size];
  if (!effect || !context) return null;
  let forContext = buses.get(context);
  if (!forContext) buses.set(context, forContext = new Map());
  if (forContext.has(size)) return forContext.get(size);

  let input = null;
  try {
    const output = context.gainNode ?? context.destination;
    input = context.createGain();
    input.gain.value = 10 ** (effect.trim / 20);

    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = BASS_HZ;
    bass.gain.value = effect.bassDb;

    const [left, right] = impulseResponse(context.sampleRate, effect.tail);
    const buffer = context.createBuffer(2, left.length, context.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const room = context.createConvolver();
    room.buffer = buffer;
    const wet = context.createGain();
    wet.gain.value = effect.wet;

    input.connect(bass);
    bass.connect(output);
    bass.connect(room);
    room.connect(wet);
    wet.connect(output);
  } catch {
    input = null;
  }
  forContext.set(size, input);
  return input;
}
