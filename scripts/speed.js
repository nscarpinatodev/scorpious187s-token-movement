/**
 * How far can this token go? Turns "a token and its movement action" into the
 * bands the overlay draws, in scene distance units.
 */

import { HOOKS, SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { log } from './logger.js';
import { SYSTEM_PRESETS, DEFAULT_BANDS, parseBands, resolveSpeed } from './systems.js';
import { hudBandColors } from './theme.js';
import { shadeOf, SHADE_COUNT } from './shapes.js';

/** How a system's own band colours compare with the opacity setting, in the tiles look. */
const SYSTEM_FADE = 1.2;

/** No band is ever drawn more solid than this, whatever the settings multiply out to. */
const MAX_ALPHA = 0.85;

/**
 * @typedef {object} MovementRange
 * @property {number} distance   Reach in scene distance units
 * @property {number} color      0xRRGGBB
 * @property {number} alpha      Fill opacity
 */

function colorNumber(value, fallback) {
  try {
    const color = foundry.utils.Color.from(value);
    const number = Number(color);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

/** The preset in force: a custom data path if one is set, else the system's. */
function activePreset() {
  const system = SYSTEM_PRESETS[game.system.id];
  const custom = (setting(SETTINGS.speedPath) ?? '').trim();
  if (!custom) return system ?? null;
  return {
    paths: [custom],
    // A custom path still benefits from the system's vocabulary, so
    // `system.movement.speeds.{action}` works on pf2e without spelling "land".
    aliases: system?.aliases,
    unit: setting(SETTINGS.speedUnit) === 'spaces' ? 'spaces' : 'distance',
  };
}

/** Is this token taking part in a combat that has begun? */
export function inActiveCombat(token) {
  const combat = token.combatant?.combat ?? null;
  return !!combat?.started;
}

/**
 * A token's speed for an action, in scene distance units, or 0 if unknown.
 * @param {Token} token
 * @param {string} action
 * @returns {number}
 */
export function getSpeed(token, action) {
  const found = resolveSpeed(token.document.actor, action, activePreset());
  if (found) {
    const speed = found.unit === 'spaces' ? found.value * canvas.grid.distance : found.value;
    log.debug(`speed ${speed} for "${action}" from ${found.path}`);
    return speed;
  }
  const fallback = Number(setting(SETTINGS.defaultSpeed)) || 0;
  log.debug(`no speed found for "${action}"; fallback ${fallback}`);
  return Math.max(fallback, 0);
}

/**
 * How many diagonal steps the token has already taken this turn.
 *
 * Under the alternating rules (1/2/1 and 2/1/2) the price of the next diagonal
 * depends on how many came before it, and core counts across the whole turn:
 * its ruler measures the recorded history and the planned path as one. The
 * range has to start from the same count or it is a space out.
 * @param {Token} token
 * @returns {number}
 */
export function diagonalsThisTurn(token) {
  if (!inActiveCombat(token) || !setting(SETTINGS.subtractUsed)) return 0;
  const grid = canvas.grid;
  if (!grid.isSquare) return 0;
  const document = token.document;
  let count = 0;
  let previous = null;
  for (const waypoint of document.movementHistory ?? []) {
    const center = document.getCenterPoint(waypoint);
    const offset = grid.getOffset({ x: center.x, y: center.y });
    const config = CONFIG.Token.movement.actions[waypoint.action];
    const measured = !config?.teleport && (config?.measure !== false);
    if (previous && measured) {
      count += Math.min(Math.abs(offset.i - previous.i), Math.abs(offset.j - previous.j));
    }
    previous = offset;
  }
  return count;
}

/** Movement already spent this turn, from core's recorded movement history. */
function spentThisTurn(token) {
  let spent = 0;
  for (const waypoint of token.document.movementHistory ?? []) {
    if (Number.isFinite(waypoint.cost)) spent += waypoint.cost;
  }
  return spent;
}

/**
 * How each band is coloured, nearest first.
 *
 *  - Left to suit the system, a system that has band colours of its own
 *    uses them: green, yellow and red for the three Strides of Pathfinder
 *    and Starfinder 2e.
 *  - Otherwise the HUD decides. In the tiles look the whole range is one
 *    colour, the device's main colour, each band further out a darker,
 *    fainter shade of it. In the flat look the HUD's three colours are used as they are.
 *  - With no HUD, or when the user has chosen their own, the three colour
 *    settings are used as they are.
 * @returns {{color: number, fade: number}[]} `fade` scales the band's opacity
 */
function bandLooks() {
  const scheme = setting(SETTINGS.colorScheme);
  const tiles = setting(SETTINGS.overlayStyle) !== 'flat';
  if (scheme === 'auto') {
    const own = SYSTEM_PRESETS[game.system.id]?.colors;
    if (own?.length) return own.map((color) => ({ color, fade: tiles ? SYSTEM_FADE : 1 }));
  }
  const hud = hudBandColors();
  if (hud && tiles) return Array.from({ length: SHADE_COUNT }, (_, index) => shadeOf(hud[0], index));
  const colors = hud ?? [
    colorNumber(setting(SETTINGS.rangeColor), 0x3ddc84),
    colorNumber(setting(SETTINGS.dashColor), 0xff9d2e),
    colorNumber(setting(SETTINGS.farColor), 0xff5a5a),
  ];
  return colors.map((color) => ({ color, fade: 1 }));
}

/** The colour of each band, nearest first. */
export function bandColors() {
  return bandLooks().map((look) => look.color);
}

/**
 * A token's bands before anything is taken off for movement already used.
 * @returns {{ranges: MovementRange[], custom: boolean}}
 *   `custom` when a hook supplied them, in which case they are used as given.
 */
function baseBands(token, action) {
  const opacity = setting(SETTINGS.rangeOpacity) ?? 0.28;
  // Nearest band first; the last look repeats for any bands beyond it.
  const looks = bandLooks();
  const lookOf = (index) => looks[Math.min(index, looks.length - 1)];
  const alphaOf = (index) => Math.min(opacity * lookOf(index).fade, MAX_ALPHA);

  // Let a system module or a world script take over completely.
  const custom = [];
  Hooks.callAll(HOOKS.getMovementRanges, token.document, action, custom);
  const supplied = custom
    .filter((range) => Number.isFinite(range?.distance) && (range.distance > 0))
    .map((range, index) => ({
      distance: range.distance,
      color: colorNumber(range.color, lookOf(index).color),
      alpha: Number.isFinite(range.alpha) ? range.alpha : alphaOf(index),
    }))
    .sort((a, b) => a.distance - b.distance);
  if (supplied.length) return { ranges: supplied, custom: true };

  const speed = getSpeed(token, action);
  if (!(speed > 0)) return { ranges: [], custom: false };
  const bands = parseBands(setting(SETTINGS.rangeBands))
    ?? SYSTEM_PRESETS[game.system.id]?.bands ?? DEFAULT_BANDS;
  return {
    ranges: bands.map((multiple, index) => ({
      distance: speed * multiple,
      color: lookOf(index).color,
      alpha: alphaOf(index),
    })),
    custom: false,
  };
}

/**
 * What a route needs to colour each of its steps by how far along it is.
 *
 * A step is drawn in the colour of the band it falls in, so a route shows
 * where the token's move ends and its dash begins. Both the route being
 * dragged and the trail of a walking token ask here.
 * @param {Token} token
 * @param {string} action
 * @returns {{ranges: MovementRange[], start: number}}
 *   `ranges` are the token's whole bands, nothing taken off, and never empty:
 *   a token with no known speed gets one band without end, in the first
 *   band's colour. `start` is the movement already used this turn, which a
 *   route planned from where the token stands has to count from.
 */
export function routeBands(token, action) {
  const { ranges } = baseBands(token, action);
  const counted = inActiveCombat(token) && !!setting(SETTINGS.subtractUsed);
  if (ranges.length) return { ranges, start: counted ? spentThisTurn(token) : 0 };
  const opacity = setting(SETTINGS.rangeOpacity) ?? 0.28;
  const look = bandLooks()[0];
  return {
    ranges: [{ distance: Infinity, color: look.color, alpha: Math.min(opacity * look.fade, MAX_ALPHA) }],
    start: 0,
  };
}

/**
 * The bands to draw for a token, nearest first. Empty means draw nothing.
 * @param {Token} token
 * @param {string} action   The movement action being planned
 * @returns {MovementRange[]}
 */
export function getMovementRanges(token, action) {
  const combat = inActiveCombat(token);
  if (setting(SETTINGS.combatOnly) && !combat) return [];

  const { ranges, custom } = baseBands(token, action);
  if (custom) return ranges;
  const spent = (combat && setting(SETTINGS.subtractUsed)) ? spentThisTurn(token) : 0;

  // Colour follows the band's place in the list, not its place among the
  // survivors: once the first Stride is spent, what remains is still drawn in
  // the second band's colour.
  return ranges
    .map((range) => ({ ...range, distance: range.distance - spent }))
    .filter((range) => range.distance > 0);
}
