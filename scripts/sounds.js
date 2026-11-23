import { SETTINGS, STEP_SOUND_SETS, STEP_SOUND_AUTO } from './constants.js';
import { setting } from './settings.js';
import { armorClassOf, DEFAULT_ARMOR } from './armor.js';
import { sizeClassOf, busFor, SIZE_EFFECTS } from './weight.js';
import { guarded } from './logger.js';

/** Minimum gap between two step sounds, in ms. */
const MIN_GAP_MS = 40;
let lastPlayed = 0;

function customSound() {
  return (setting(SETTINGS.stepSound) ?? '').trim();
}

/** The step sound setting, or the automatic choice if it holds nothing usable. */
function chosenSet() {
  const choice = setting(SETTINGS.stepSoundSet);
  return choice in STEP_SOUND_SETS ? choice : STEP_SOUND_AUTO;
}

/**
 * The files a token's steps are drawn from: the world's custom sound if there
 * is one, else the set this user picked, else the set for the token's armor.
 * @param {object} [token]
 * @returns {readonly string[]}
 */
export function stepSources(token) {
  const custom = customSound();
  if (custom) return [custom];
  const choice = chosenSet();
  const key = choice === STEP_SOUND_AUTO ? armorClassOf(token) : choice;
  return STEP_SOUND_SETS[key] ?? STEP_SOUND_SETS[DEFAULT_ARMOR];
}

/**
 * The size a token's steps are weighted for, or null for an ordinary step:
 * one space across or smaller, or this user has the weighting switched off.
 * @param {object} [token]
 * @returns {'large'|'huge'|'gargantuan'|null}
 */
export function stepWeight(token) {
  return setting(SETTINGS.stepWeight) ? sizeClassOf(token) : null;
}

/**
 * Start one file playing, through the effects for a size if one is given.
 *
 * This is game.audio.play with one thing added: a big creature's step is sent
 * to that size's shared effects in place of the channel's output, and played
 * lower. The effects still end at the channel's output, so the Interface
 * volume slider applies as it always did.
 */
async function start(src, volume, size) {
  const context = game.audio.interface;
  const sound = new foundry.audio.Sound(src, { context });
  await sound.load();
  const bus = size ? busFor(context, size) : null;
  if (bus) sound.destination = bus;
  const playing = sound.play({ volume });
  // The source exists from the moment play is called. A file long enough to
  // be streamed has no detune; it keeps its pitch and still gets the rest.
  const detune = bus ? sound.sourceNode?.detune : null;
  if (detune) detune.value = SIZE_EFFECTS[size].detune;
  return playing;
}

/**
 * Play one step. Local only: every client animates the move itself, so each
 * plays its own steps for the tokens it can see and nothing crosses the socket.
 * @param {number} index    Running step count; walks through the set's variants.
 * @param {object} [token]  The token stepping, for the sound of what it wears
 *                          and how big it is.
 */
export function playStep(index, token) {
  if (!setting(SETTINGS.stepSounds)) return;
  const volume = setting(SETTINGS.stepVolume) ?? 0.4;
  if (!(volume > 0)) return;

  // Before the browser's first user gesture, playback is queued rather than
  // dropped. Skipping avoids a burst of stale footsteps when audio unlocks.
  if (game.audio?.locked) return;

  // A group move lands many tokens on the same frame. One step is a footfall;
  // twelve at once is a click of full-scale noise.
  const now = performance.now();
  if (now - lastPlayed < MIN_GAP_MS) return;
  lastPlayed = now;

  const sources = stepSources(token);
  const src = sources[index % sources.length];
  const size = stepWeight(token);
  guarded('step sound', () => {
    start(src, volume, size).catch(() => {});
  });
}

/** Warm the cache so the first step of a session is not late. */
export function preloadStepSounds() {
  const custom = customSound();
  const choice = chosenSet();
  let sources;
  if (custom) sources = [custom];
  else if (choice === STEP_SOUND_AUTO) sources = Object.keys(STEP_SOUND_SETS).filter((key) => key !== 'classic').flatMap((key) => STEP_SOUND_SETS[key]);
  else sources = STEP_SOUND_SETS[choice];
  for (const src of sources) {
    guarded('step sound preload', () => {
      foundry.audio.AudioHelper.preloadSound(src)?.catch?.(() => {});
    });
  }
}
