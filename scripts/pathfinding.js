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
 *
 * The answer is given straight away. Core treats a pathfinder that answers
 * later as "searching": it draws a dashed line, holds it for at least half a
 * second, and has no route to show or price in the meantime — so the range
 * overlay would have nothing to follow either. A search here takes a few
 * milliseconds, less once the first one of a drag has been paid for, so it is
 * simply done on the spot. Only a search too long for one frame is finished
 * over the following frames.
 */

import { SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { log } from './logger.js';
import { makeNavigator } from './navigation.js';
import { findRoute, turningPoints } from './reachability.js';
import { diagonalsThisTurn } from './speed.js';

/** Longest a search may run before it is put off to later frames, in ms. */
const SYNC_BUDGET_MS = 30;

/** Longest a put-off search may hold each later frame, in ms. */
const FRAME_BUDGET_MS = 8;

/** A navigator is kept between searches for this long after its last use, in ms. */
const NAVIGATOR_TTL_MS = 3000;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const sameSpot = (a, b) => (Math.abs(a.x - b.x) <= 1) && (Math.abs(a.y - b.y) <= 1);

/* -------------------------------------------- */
/*  Keeping what a drag has already worked out  */
/* -------------------------------------------- */

/**
 * During a drag the search is repeated from the same spot for every space the
 * pointer crosses, and most of the work is asking the token "may I take this
 * step, and what does it cost" for the same pairs of spaces. The navigator
 * remembers its answers, so it is kept for as long as it stays true.
 */
let kept = null;
let revision = 0;

/** Something that decides where tokens can go has changed. */
export function forgetRoutes() {
  revision++;
  kept = null;
}

function navigatorFor(token, from, action, options) {
  const key = [
    token.document.uuid, Math.round(from.x), Math.round(from.y), action, revision,
    JSON.stringify(options.constrainOptions ?? null),
  ].join('|');
  const now = performance.now();
  if (kept && (kept.key === key) && (now - kept.used < NAVIGATOR_TTL_MS)) {
    kept.used = now;
    return kept.navigator;
  }
  const navigator = makeNavigator(token, {
    action,
    from,
    constrainOptions: options.constrainOptions,
    measureOptions: options.measureOptions,
  });
  kept = { key, navigator, used: now };
  return navigator;
}

/* -------------------------------------------- */
/*  The search                                  */
/* -------------------------------------------- */

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
 * Search for a way from one waypoint to the next. A generator, so the caller
 * decides how long it may run at a stretch.
 * @returns {Generator<void, object[]|null>} Corner waypoints to insert between
 *   the two, or null if there is no way round.
 */
function* cornersBetween(token, from, to, options) {
  if ((from.elevation ?? 0) !== (to.elevation ?? 0)) return null; // routes are planned on the flat
  const action = to.action;
  const config = CONFIG.Token.movement.actions[action];
  if (!config || config.teleport || (config.measure === false) || !config.walls) return null;

  const navigator = navigatorFor(token, from, action, options);
  const goal = navigator.offsetOf(to);
  if ((goal.i === navigator.start.i) && (goal.j === navigator.start.j)) return null;

  const grid = navigator.grid;
  const route = yield* findRoute({
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
 * Work out the whole route, leg by leg.
 * @returns {Generator<void, object[]|null>} The route, or null to keep the
 *   straight one.
 */
function* plan(token, full, options, findBelow) {
  const quick = { ...options, delay: 0 };
  const expanded = [full[0]];
  let bent = false;
  for (let n = 1; n < full.length; n++) {
    const from = full[n - 1];
    const to = full[n];
    const legEnd = findBelow([from, to], quick)?.result?.at(-1);
    if (!legEnd || !sameSpot(legEnd, to)) {
      const corners = yield* cornersBetween(token, from, to, options);
      if (!corners) {
        // No way round this leg. Hand the rest over as it was, and core will
        // take the route as far as it goes.
        expanded.push(...full.slice(n));
        break;
      }
      expanded.push(...corners);
      bent = true;
    }
    expanded.push(to);
  }
  if (!bent) return null;

  // One pass over the whole route, so limits that apply to the route as a
  // whole are applied to the whole route.
  return findBelow(expanded, quick)?.result ?? null;
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

  const started = performance.now();
  const work = plan(token, full, options, findBelow);
  const finish = (path, how) => {
    log.debug(`pathfinding: ${path ? 'route found' : 'no way round'} in `
      + `${(performance.now() - started).toFixed(1)} ms (${how})`);
    return path ?? direct.result;
  };

  // Answer now if at all possible.
  let step;
  do step = work.next();
  while (!step.done && (performance.now() - started < SYNC_BUDGET_MS));
  if (step.done) {
    const path = finish(step.value, 'at once');
    return { result: path, promise: Promise.resolve(path), cancel: () => {} };
  }

  // Too long for one frame: finish it over the next few. Until then core
  // shows the route as far as it is known.
  let cancelled = false;
  const promise = (async () => {
    for (;;) {
      await nextFrame();
      if (cancelled || !canvas.ready) return null;
      const sliceStart = performance.now();
      let result;
      do result = work.next();
      while (!result.done && (performance.now() - sliceStart < FRAME_BUDGET_MS));
      if (result.done) return finish(result.value, 'over several frames');
    }
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
