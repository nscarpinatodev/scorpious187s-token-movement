/**
 * Where each game system keeps a token's speed.
 *
 * A preset is a list of candidate data paths on the actor, tried in order.
 * `{action}` is replaced by the token's movement action after `aliases` are
 * applied (pf2e calls walking speed "land"). `unit` says whether the number
 * is in scene distance units or in grid spaces. `bands` are the multiples of
 * that speed worth drawing: a move and a dash by default, three Strides for
 * the three-action systems. `colors` gives those bands colours of the
 * system's own, used when the colour scheme is left to suit the system: in
 * the three-action systems green, yellow and red for one, two and three
 * actions' worth of movement.
 *
 * Values may be a number, a numeric string, or an object carrying the number
 * in `value` or `total` — see `readNumber`.
 *
 * Verified against installed systems: dnd5e 6.1, pf2e 8.7, sf2e 1.7, D35E 3.1.
 * The rest are best-effort from each system's published data model; a path
 * that does not resolve simply falls through to the fallback speed.
 */

export const SYSTEM_PRESETS = Object.freeze({
  dnd5e: {
    paths: [
      'system.attributes.movement.speeds.{action}', // 6.x
      'system.attributes.movement.{action}',        // 5.x and earlier
    ],
    unit: 'distance',
  },
  pf2e: {
    paths: [
      'system.movement.speeds.{action}',
      'system.attributes.speed.total', // legacy, land only
    ],
    aliases: { walk: 'land', crawl: 'land' },
    unit: 'distance',
    bands: [1, 2, 3],
    colors: [0x4cd964, 0xffd23f, 0xff5a4f],
  },
  sf2e: {
    paths: [
      'system.movement.speeds.{action}',
      'system.attributes.speed.total',
    ],
    aliases: { walk: 'land', crawl: 'land' },
    unit: 'distance',
    bands: [1, 2, 3],
    colors: [0x4cd964, 0xffd23f, 0xff5a4f],
  },
  pf1: {
    paths: ['system.attributes.speed.{action}.total'],
    aliases: { walk: 'land', crawl: 'land' },
    unit: 'distance',
  },
  D35E: {
    paths: ['system.attributes.speed.{action}.total'],
    aliases: { walk: 'land', crawl: 'land' },
    unit: 'distance',
  },
  sfrpg: {
    paths: ['system.attributes.speed.{action}.value'],
    aliases: { walk: 'land', crawl: 'land', fly: 'flying', swim: 'swimming', burrow: 'burrowing', climb: 'climbing' },
    unit: 'distance',
  },
  a5e: {
    paths: ['system.attributes.movement.{action}.distance'],
    unit: 'distance',
  },
  swade: {
    paths: ['system.pace.{action}', 'system.pace', 'system.stats.speed.value'],
    aliases: { walk: 'ground', crawl: 'ground' },
    unit: 'spaces',
  },
});

/** Bands drawn when neither the world setting nor the system preset says. */
export const DEFAULT_BANDS = Object.freeze([1, 2]);

/**
 * Parse a "1, 2, 3" style list of speed multiples.
 * @param {unknown} text
 * @returns {number[]|null}  Ascending, de-duplicated, at most four; null if none
 */
export function parseBands(text) {
  if (typeof text !== 'string') return null;
  const values = text.split(/[\s,;]+/).map(Number.parseFloat)
    .filter((value) => Number.isFinite(value) && (value > 0));
  if (!values.length) return null;
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 4);
}

/** The action whose speed stands in when the current action has none. */
export const FALLBACK_ACTION = 'walk';

/**
 * Coerce a looked-up value to a positive finite number, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function readNumber(value) {
  if (value && (typeof value === 'object')) value = value.value ?? value.total ?? null;
  if (typeof value === 'string') value = Number.parseFloat(value);
  return (typeof value === 'number') && Number.isFinite(value) && (value > 0) ? value : null;
}

/** Read a dot-path from an object without throwing on a missing branch. */
function getPath(object, path) {
  let current = object;
  for (const key of path.split('.')) {
    if ((current === null) || (current === undefined)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Resolve a speed from an actor using a preset.
 * @param {object} actor
 * @param {string} action                          The token's movement action
 * @param {{paths: string[], aliases?: object, unit: string}} preset
 * @returns {{value: number, unit: string, path: string}|null}
 */
export function resolveSpeed(actor, action, preset) {
  if (!actor || !preset?.paths?.length) return null;
  const aliases = preset.aliases ?? {};
  const actions = action === FALLBACK_ACTION ? [action] : [action, FALLBACK_ACTION];
  for (const candidate of actions) {
    const name = aliases[candidate] ?? candidate;
    for (const template of preset.paths) {
      // A path without {action} cannot answer for a specific action, so it is
      // only consulted once we have fallen back to plain walking.
      if (!template.includes('{action}') && (candidate !== FALLBACK_ACTION)) continue;
      const path = template.replaceAll('{action}', name);
      const value = readNumber(getPath(actor, path));
      if (value !== null) return { value, unit: preset.unit, path };
    }
  }
  return null;
}
