import {
  SETTINGS, STEP_SOUND_SETS, STEP_SOUND_AUTO, FLIGHT_SOUND_SETS, SOUND_RHYTHMS,
  GLIDING_ACTIONS, FLYING_ACTIONS,
} from './constants.js';
import { setting } from './settings.js';
import { stepClassOf, DEFAULT_ARMOR } from './armor.js';
import { hasWings } from './creatures.js';
import { sizeClassOf, sizeBeyond, busFor, SIZE_EFFECTS } from './weight.js';
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
 * The size a sound is weighted for, or null to play it as it is: the token is
 * no bigger than what was recorded, or this user has the weighting off.
 */
function weightFor(token, kind) {
  if (!setting(SETTINGS.stepWeight)) return null;
  return sizeBeyond(sizeClassOf(token), SOUND_RHYTHMS[kind]?.recorded ?? null);
}

/**
 * @typedef {object} MovementSound
 * @property {string} kind                  'unarmored' … 'hooves', 'wings', 'classic' or 'custom'
 * @property {readonly string[]} sources    The files it is drawn from, played in turn
 * @property {number} every                 Milliseconds of travel between one and the next, at
 *                                          the least; 0 for a sound on every landing
 * @property {'large'|'huge'|'gargantuan'|null} size  The size it is weighted for
 */

/**
 * What a token sounds like while it moves by a movement action.
 *
 * On foot, its steps: the world's custom sound if there is one, else the set
 * this user picked, else the set for what the token is and wears. In the air,
 * wingbeats if it has wings and nothing if it has not: a wizard under a Fly
 * spell goes quietly, and a dragon is only heard flapping while it flies, not
 * while it walks. Swimming, burrowing and driving make no sound.
 *
 * @param {object} token     A Token or a TokenDocument
 * @param {string} [action]  The movement action; the token's own if not given
 * @returns {MovementSound|null}  null for silence
 */
export function movementSound(token, action) {
  action ??= (token?.document ?? token)?.movementAction;
  if (FLYING_ACTIONS.includes(action)) {
    if (!hasWings(token)) return null;
    return { kind: 'wings', sources: FLIGHT_SOUND_SETS.wings, every: SOUND_RHYTHMS.wings.every, size: weightFor(token, 'wings') };
  }
  if (GLIDING_ACTIONS.includes(action)) return null;

  const custom = customSound();
  if (custom) return { kind: 'custom', sources: [custom], every: 0, size: weightFor(token, 'custom') };
  const choice = chosenSet();
  const wanted = choice === STEP_SOUND_AUTO ? stepClassOf(token) : choice;
  const kind = wanted in STEP_SOUND_SETS ? wanted : DEFAULT_ARMOR;
  return { kind, sources: STEP_SOUND_SETS[kind], every: SOUND_RHYTHMS[kind]?.every ?? 0, size: weightFor(token, kind) };
}

/**
 * One sound out of a movement sound: the file for the nth time it plays.
 * @param {MovementSound} sound
 * @param {number} count  How many have played before it
 * @returns {{src: string, size: string|null, kind: string}}
 */
export function soundAt(sound, count) {
  return { src: sound.sources[count % sound.sources.length], size: sound.size, kind: sound.kind };
}

/**
 * The files a token's steps on foot are drawn from, for this user.
 * @param {object} [token]
 * @returns {readonly string[]}
 */
export function stepSources(token) {
  return movementSound(token, 'walk').sources;
}

/**
 * The size a token's steps on foot are weighted for, or null for a step
 * played as it is.
 * @param {object} [token]
 * @returns {'large'|'huge'|'gargantuan'|null}
 */
export function stepWeight(token) {
  return movementSound(token, 'walk').size;
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
 * Play one sound of a move. Local only: every client animates the move itself,
 * so each plays its own sounds for the tokens it can see and nothing crosses
 * the socket.
 * @param {{src: string, size: string|null}} sound  From soundAt
 */
export function playSound(sound) {
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

  guarded('step sound', () => {
    start(sound.src, volume, sound.size).catch(() => {});
  });
}

/** Warm the cache so the first sound of a session is not late. */
export function preloadStepSounds() {
  const custom = customSound();
  const choice = chosenSet();
  let sources;
  if (custom) sources = [custom];
  else if (choice === STEP_SOUND_AUTO) sources = Object.keys(STEP_SOUND_SETS).filter((key) => key !== 'classic').flatMap((key) => STEP_SOUND_SETS[key]);
  else sources = STEP_SOUND_SETS[choice];
  // Wings are heard whatever the steps are set to.
  sources = [...sources, ...Object.values(FLIGHT_SOUND_SETS).flat()];
  for (const src of sources) {
    guarded('step sound preload', () => {
      foundry.audio.AudioHelper.preloadSound(src)?.catch?.(() => {});
    });
  }
}
