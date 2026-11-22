/**
 * Pathfinding: a route round whatever is in the way.
 *
 * Core's `Token#findMovementPath` is a hook, not a pathfinder. On its own it
 * takes the straight line between the waypoints and stops it at the first
 * wall. This fills the hook in, and only when it is needed: if the straight
 * route gets where it is going, that route is used untouched. If it is
 * stopped short, the cheapest way round is searched for, and the corners of
 * that way round are handed back to core as extra waypoints. Core then does
 * everything it always does with a list of waypoints — constrains it, prices
 * it, draws it, moves the token along it.
 *
 * "In the way" is whatever the token's own class says blocks a step (see
 * navigation.js), so this routes round dnd5e's enemy-occupied spaces as well
 * as walls, and a player's route is only bent by walls they have seen.
 */

import { SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { log } from './logger.js';
import { makeNavigator } from './navigation.js';
import { findRoute, turningPoints } from './reachability.js';
import { diagonalsThisTurn } from './speed.js';

/** Longest the search may hold a single frame, in ms. */
const FRAME_BUDGET_MS = 8;

/** Longest to wait for the pointer to settle before searching, in ms. */
const MAX_DELAY_MS = 120;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sameSpot = (a, b) => (Math.abs(a.x - b.x) <= 1) && (Math.abs(a.y - b.y) <= 1);

/** Fill in the fields a partial waypoint leaves to its predecessor. */
function complete(token, waypoints) {
  const source = token.document._source;
  let previous = { x: source.x, y: source.y, elevation: source.elevation, action: token.document.movementAction };
  return waypoints.map((waypoint) => {
    const full = {
      ...waypoint,
      x: Math.round(waypoint.x ?? previous.x),
      y: Math.round(waypoint.y ?? previous.y),
      elevation: waypoint.elevation ?? previous.elevation,
      action: waypoint.action ?? previous.action,
    };
    previous = full;
    return full;
  });
}

/** A lower bound on the number of steps between two spaces. */
function makeHeuristic(grid, goal) {
  if (grid.isSquare) {
    const noDiagonals = grid.diagonals === CONST.GRID_DIAGONALS.ILLEGAL;
    return (offset) => {
      const di = Math.abs(offset.i - goal.i);
      const dj = Math.abs(offset.j - goal.j);
      return noDiagonals ? di + dj : Math.max(di, dj);
    };
  }
  // Hex centres are one grid size apart, so straight-line distance in grid
  // sizes can never exceed the number of steps.
  const target = grid.getCenterPoint(goal);
  return (offset) => {
    const center = grid.getCenterPoint(offset);
    return Math.hypot(center.x - target.x, center.y - target.y) / grid.size;
  };
}

/**
 * Search for a way from one waypoint to the next.
 * @returns {Promise<object[]|null>} Corner waypoints to insert between the
 *   two, or null if there is no way round (or the search was abandoned).
 */
async function cornersBetween(token, from, to, options, isCancelled) {
  if ((from.elevation ?? 0) !== (to.elevation ?? 0)) return null; // routes are planned on the flat
  const action = to.action;
  const config = CONFIG.Token.movement.actions[action];
  if (!config || config.teleport || (config.measure === false) || !config.walls) return null;

  const navigator = makeNavigator(token, {
    action,
    from,
    constrainOptions: options.constrainOptions,
    measureOptions: options.measureOptions,
  });
  const goal = navigator.offsetOf(to);
  if ((goal.i === navigator.start.i) && (goal.j === navigator.start.j)) return null;

  const grid = navigator.grid;
  const search = findRoute({
    start: navigator.start,
    goal,
    unit: grid.distance,
    // Far enough to get round most things, short enough that a route which
    // does not exist is given up on quickly.
    maxCost: (setting(SETTINGS.maxSpaces) ?? 30) * grid.distance * 2,
    neighbors: navigator.neighbors,
    step: navigator.step,
    edge: navigator.edge,
    heuristic: makeHeuristic(grid, goal),
    startParity: diagonalsThisTurn(token) % 2,
  });

  let route;
  for (;;) {
    const sliceStart = performance.now();
    let result;
    do result = search.next();
    while (!result.done && (performance.now() - sliceStart < FRAME_BUDGET_MS));
    if (result.done) {
      route = result.value;
      break;
    }
    await nextFrame();
    if (isCancelled() || !canvas.ready) return null;
  }
  if (!route) return null;

  // Only the corners matter: between two corners the route is a straight run
  // of identical steps, which is exactly the line core will draw.
  const direction = (a, b) => {
    const p = navigator.deltaOf(a);
    const q = navigator.deltaOf(b);
    return `${Math.round(q.x - p.x)},${Math.round(q.y - p.y)}`;
  };
  return turningPoints(route.cells, direction).map((cell) => ({
    ...to,
    ...navigator.positionOf(cell),
    snapped: true,
    explicit: false,
    checkpoint: false,
  }));
}

/**
 * Decide what `Token#findMovementPath` should return.
 * @param {Token} token
 * @param {object[]} waypoints                 As passed to findMovementPath
 * @param {object} options                     As passed to findMovementPath
 * @param {object} direct                      What the class below us returned
 * @param {(waypoints: object[], options: object) => object} findBelow
 *   Calls the class below us again, for a different list of waypoints
 * @returns {object} A TokenFindMovementPathJob
 */
export function routeAround(token, waypoints, options, direct, findBelow) {
  if (!setting(SETTINGS.pathfinding)) return direct;
  if (!canvas.ready || canvas.grid.isGridless) return direct;
  if (!Array.isArray(waypoints) || (waypoints.length < 2)) return direct;

  // An unfinished job means a pathfinder further down is already at work.
  // It was installed on purpose; leave the route to it.
  if (!direct || (direct.result === undefined)) return direct;

  const full = complete(token, waypoints);
  const destination = full.at(-1);
  const end = direct.result.at(-1);
  if (end && sameSpot(end, destination)) return direct; // nothing in the way
  if (options.constrainOptions?.ignoreWalls) return direct;

  let cancelled = false;
  const isCancelled = () => cancelled;

  const promise = (async () => {
    // Core asks for a short pause so a moving pointer does not start a search
    // for every space it crosses.
    const delay = Math.min(Number(options.delay) || 0, MAX_DELAY_MS);
    if (delay > 0) await wait(delay);
    if (cancelled) return null;

    const started = performance.now();
    const quick = { ...options, delay: 0 };
    const expanded = [full[0]];
    let bent = false;
    for (let n = 1; n < full.length; n++) {
      const from = full[n - 1];
      const to = full[n];
      const leg = findBelow([from, to], quick);
      const legEnd = leg?.result?.at(-1);
      if (!legEnd || !sameSpot(legEnd, to)) {
        const corners = await cornersBetween(token, from, to, options, isCancelled);
        if (cancelled) return null;
        if (!corners) {
          // No way round this leg. Hand the rest over as it was, and core
          // will take the route as far as it goes.
          expanded.push(...full.slice(n));
          break;
        }
        expanded.push(...corners);
        bent = true;
      }
      expanded.push(to);
    }
    if (!bent) return direct.result;

    // One pass over the whole route, so limits that apply to the route as a
    // whole are applied to the whole route.
    const job = findBelow(expanded, quick);
    const path = job.result ?? await job.promise;
    log.debug(`pathfinding: ${expanded.length - full.length} corner(s) in `
      + `${(performance.now() - started).toFixed(1)} ms`);
    return cancelled ? null : (path ?? direct.result);
  })().catch((err) => {
    log.error('pathfinding failed; using the straight route', err);
    return direct.result;
  });

  return {
    result: undefined,
    promise,
    cancel: () => {
      cancelled = true;
      direct.cancel?.();
    },
  };
}
