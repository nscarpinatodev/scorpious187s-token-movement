import { SETTINGS, BUILT_IN_STEP_SOUNDS } from './constants.js';
import { setting } from './settings.js';
import { guarded } from './logger.js';

/** Minimum gap between two step sounds, in ms. */
const MIN_GAP_MS = 40;
let lastPlayed = 0;

function customSound() {
  return (setting(SETTINGS.stepSound) ?? '').trim();
}

/**
 * Play one step. Local only: every client animates the move itself, so each
 * plays its own steps for the tokens it can see and nothing crosses the socket.
 * @param {number} index  Running step count; alternates the built-in sounds.
 */
export function playStep(index) {
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

  const src = customSound() || BUILT_IN_STEP_SOUNDS[index % BUILT_IN_STEP_SOUNDS.length];
  guarded('step sound', () => {
    const playing = game.audio.play(src, { volume, context: game.audio.interface });
    playing?.catch?.(() => {});
  });
}

/** Warm the cache so the first step of a session is not late. */
export function preloadStepSounds() {
  const sources = customSound() ? [customSound()] : BUILT_IN_STEP_SOUNDS;
  for (const src of sources) {
    guarded('step sound preload', () => {
      foundry.audio.AudioHelper.preloadSound(src)?.catch?.(() => {});
    });
  }
}
