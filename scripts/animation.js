/**
 * Lift / hop animation.
 *
 * Core animates a move as a chain of `token.animate(position, {chain: true})`
 * links, one per straight run of the path. This module does not replace or
 * re-time any of that. It attaches an `ontick` to each link, works out how far
 * through the link the token is, and turns that into a single number per token
 * — `lift`, 0 on the ground and 1 at the top — which the token's own
 * `_refreshPosition` then applies to the mesh.
 *
 * Only the mesh is offset. The document, the token's hit area, vision, light
 * and region tests all stay on the true path, so nothing about where the token
 * *is* changes; only how it is drawn.
 */

import { ANIMATION_STYLES, HOOKS, SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { guarded } from './logger.js';
import { playStep } from './sounds.js';

/**
 * Movement actions with no footfalls. These use the glide even when the hop
 * style is selected, and make no step sounds — a shuttle bouncing across the
 * map is not an improvement. Everything else is assumed to be on foot, which
 * is the right guess for the actions systems add (pf2e moves tokens by
 * "travel" outside encounters).
 */
const GLIDING_ACTIONS = new Set(['fly', 'swim', 'burrow', 'drive']);

/** How long the glide style takes to rise and to set down, in ms. */
const RAMP_MS = 140;

/**
 * @typedef {object} LiftState
 * @property {number} lift          0 (grounded) … 1 (top of the arc)
 * @property {boolean} airborne     Glide only: already up from a previous link
 * @property {number} steps         Running count of landings, for sound variety
 * @property {{x: number, y: number}|null} baseScale  Mesh scale as core set it
 * @property {boolean} scaled       Whether a lift scale is currently applied
 */

/** @type {WeakMap<object, LiftState>} */
const states = new WeakMap();

function stateOf(token) {
  let state = states.get(token);
  if (!state) {
    state = { lift: 0, airborne: false, steps: 0, baseScale: null, scaled: false };
    states.set(token, state);
  }
  return state;
}

/* -------------------------------------------- */
/*  Deciding which animations to touch          */
/* -------------------------------------------- */

/**
 * Is this `animate` call a travelling link of a movement chain that we style?
 * @param {Token} token
 * @param {object} to        The animation target
 * @param {object} options   The animation options
 * @returns {boolean}
 */
export function shouldDecorate(token, to, options) {
  if (token.isPreview) return false;
  if (options.name !== token.movementAnimationName) return false;

  // Rotation-only links (auto-rotate) are part of the same chain but go nowhere.
  if (!('x' in to) && !('y' in to)) return false;

  const style = setting(SETTINGS.animationStyle);
  if (!style || (style === ANIMATION_STYLES.none)) return false;

  // Blink, displace and anything else a system marks as a teleport: there is
  // no journey to animate, and a hop on arrival would look like a glitch.
  // Unmeasured actions are movement done *to* a token rather than by it — a
  // rider carried by its mount, a shove — and should not look like walking.
  const action = options.action ?? token.document.movementAction;
  const config = CONFIG.Token.movement.actions[action];
  if (config?.teleport || (config?.measure === false)) return false;
  return true;
}

/**
 * Return a copy of the options whose `ontick` also drives the lift.
 * @param {Token} token
 * @param {object} to
 * @param {object} options
 * @returns {object}
 */
export function decorate(token, to, options) {
  const action = options.action ?? token.document.movementAction;
  const stepping = !GLIDING_ACTIONS.has(action);
  const style = stepping ? setting(SETTINGS.animationStyle) : ANIMATION_STYLES.glide;
  const inner = options.ontick;
  const link = { from: null, cells: 1, landed: 0, stepping };
  return {
    ...options,
    ontick: (elapsedMS, animation, data) => {
      if (inner) inner(elapsedMS, animation, data);
      guarded('movement animation', () => tick(token, to, link, style, animation));
    },
  };
}

/* -------------------------------------------- */
/*  Per-frame                                   */
/* -------------------------------------------- */

/**
 * How many grid spaces a link crosses. A link is a straight run, so on a
 * square grid a diagonal run of three is three spaces, not 4.24.
 */
function countSpaces(token, from, to) {
  const grid = canvas.grid;
  const dx = (to.x ?? from.x) - from.x;
  const dy = (to.y ?? from.y) - from.y;
  let spaces;
  if (grid.isSquare) spaces = Math.max(Math.abs(dx), Math.abs(dy)) / grid.size;
  else if (grid.isGridless) spaces = Math.hypot(dx, dy) / grid.size;
  else {
    const cx = token.w / 2;
    const cy = token.h / 2;
    spaces = grid.measurePath([
      { x: from.x + cx, y: from.y + cy },
      { x: from.x + dx + cx, y: from.y + dy + cy },
    ]).spaces;
  }
  return Math.max(1, Math.round(spaces) || 1);
}

/** Are there still travelling links queued behind the one now playing? */
function hasMoreTravel(token) {
  const context = token.animationContexts.get(token.movementAnimationName);
  return !!context?.chain.some(({ to }) => ('x' in to) || ('y' in to));
}

const easeOut = (t) => 1 - ((1 - t) * (1 - t));

function tick(token, to, link, style, animation) {
  const state = stateOf(token);
  const duration = animation.duration;

  // Instant moves (animation disabled, or a zero-length link) have no arc.
  if (!(duration > 0)) {
    state.lift = 0;
    return;
  }

  // `token.position` is still last frame's: render flags are applied after
  // animation ticks. On a link's first tick that is exactly where it starts.
  if (!link.from) {
    link.from = { x: token.position.x, y: token.position.y };
    link.cells = countSpaces(token, link.from, to);
  }

  const progress = Math.min(Math.max(animation.time / duration, 0), 1);
  const phase = progress * link.cells;
  const done = progress >= 1;

  if (style === ANIMATION_STYLES.glide) {
    const more = hasMoreTravel(token);
    const up = state.airborne ? 1 : Math.min(1, animation.time / RAMP_MS);
    const down = more ? 1 : Math.min(1, (duration - animation.time) / RAMP_MS);
    state.lift = easeOut(Math.max(0, Math.min(up, down)));
    if (done) state.airborne = more;
  } else {
    // One arc per space. sin() rather than a parabola: it leaves and meets the
    // ground with the same slope, so consecutive hops read as a bounce.
    state.lift = done ? 0 : Math.sin(Math.PI * (phase - Math.floor(phase)));
  }

  // Landings. At most one per frame: after a stall several spaces can pass in
  // a single tick, and replaying each of them would be a burst of noise.
  const landed = Math.min(Math.floor(phase + 1e-6), link.cells);
  if (landed > link.landed) {
    link.landed = landed;
    state.steps++;
    if (link.stepping && token.visible) playStep(state.steps, token);
    Hooks.callAll(HOOKS.step, token, state.steps);
  }

  // Core flags this itself whenever x or y changed, but a link can end on a
  // frame where the position is already final and the lift still is not.
  token.renderFlags.set({ refreshPosition: true });
}

/**
 * Called when a decorated link's promise settles. If that was the end of the
 * chain — completed, interrupted, or stopped by another module — put the token
 * back on the ground. Without this a glide cut short would stay in the air.
 * @param {Token} token
 */
export function onLinkSettled(token) {
  if (token.destroyed) return;
  if (token.animationContexts.has(token.movementAnimationName)) return;
  const state = states.get(token);
  if (!state) return;
  state.airborne = false;
  if (state.lift === 0) return;
  state.lift = 0;
  token.renderFlags.set({ refreshPosition: true });
}

/* -------------------------------------------- */
/*  Applying the lift to the mesh               */
/* -------------------------------------------- */

/**
 * Remember the scale core just gave the mesh, then re-apply any lift.
 * Called after `Token#_refreshMeshSizeAndScale`.
 * @param {Token} token
 */
export function captureBaseScale(token) {
  const mesh = token.mesh;
  if (!mesh) return;
  const state = stateOf(token);
  state.baseScale = { x: mesh.scale.x, y: mesh.scale.y };
  state.scaled = false;
  applyScale(token, state);
}

function applyScale(token, state) {
  const base = state.baseScale;
  if (!base) return;
  const boost = (state.lift > 0) ? (setting(SETTINGS.liftScale) ?? 0) * state.lift : 0;
  if (boost > 0) {
    token.mesh.scale.set(base.x * (1 + boost), base.y * (1 + boost));
    state.scaled = true;
  } else if (state.scaled) {
    token.mesh.scale.set(base.x, base.y);
    state.scaled = false;
  }
}

/**
 * Offset and scale the mesh for the current lift.
 * Called after `Token#_refreshPosition`, which has just put the mesh back on
 * the token's true centre — so this never accumulates.
 * @param {Token} token
 */
export function applyLift(token) {
  const state = states.get(token);
  if (!state) return;
  const mesh = token.mesh;
  if (!mesh) return;
  if (state.lift > 0) {
    const height = (setting(SETTINGS.liftHeight) ?? 0) * canvas.grid.size * state.lift;
    mesh.position.y -= height;
  }
  applyScale(token, state);
}
