import { SETTINGS, STEP_SOUND_SETS, STEP_SOUND_AUTO } from './constants.js';
import { setting } from './settings.js';
import { armorClassOf, DEFAULT_ARMOR } from './armor.js';
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
 * Play one step. Local only: every client animates the move itself, so each
 * plays its own steps for the tokens it can see and nothing crosses the socket.
 * @param {number} index    Running step count; walks through the set's variants.
 * @param {object} [token]  The token stepping, for the sound of what it wears.
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
  guarded('step sound', () => {
    const playing = game.audio.play(src, { volume, context: game.audio.interface });
    playing?.catch?.(() => {});
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
