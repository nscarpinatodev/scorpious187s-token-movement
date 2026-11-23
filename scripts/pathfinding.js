/**
 * Pathfinding: the route a drag takes, space by space.
 *
 * Core's `Token#findMovementPath` is a hook, not a pathfinder. On its own it
 * takes the straight line between the waypoints and stops it at the first
 * wall. This fills the hook in, and does two things with it.
 *
 * It looks for a better route when there is one to find: if the straight
 * route is stopped short, the cheapest way round; and if the straight route
 * gets there but crosses something that costs extra (difficult terrain, in
 * dnd5e another creature's space), a cheaper way if there is one. The range
 * overlay prices every space by its cheapest route, so the route a drag shows
 * has to be that route, or the two disagree about what a move costs.
 *
 * And it marks every turn of the route as a waypoint. Core prices and draws a
 * leg as the run of spaces under it, a staircase when the leg is at a shallow
 * angle, but moves the token along the leg itself, straight from one end to
 * the other. With a waypoint on each turn of the staircase the token walks
 * the spaces that were drawn and paid for.
 *
 * Either way the answer is only ever extra waypoints. Core then does
 * everything it always does with a list of waypoints: constrains it, prices
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
import { findRoute, priceCells, turningPoints } from './reachability.js';
import { diagonalsThisTurn } from './speed.js';

/** Longest a search may run before it is put off to later frames, in ms. */
const SYNC_BUDGET_MS = 30;

/** Longest a put-off search may hold each later frame, in ms. */
const FRAME_BUDGET_MS = 8;

/** A navigator is kept between searches for this long after its last use, in ms. */
const NAVIGATOR_TTL_MS = 3000;

/** How many navigators are kept at once: one for each leg of a drag with waypoints. */
const NAVIGATORS_KEPT = 6;

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
const kept = new Map();
let revision = 0;

/** Something that decides where tokens can go has changed. */
export function forgetRoutes() {
  revision++;
  kept.clear();
}

function navigatorFor(token, from, action, options) {
  const key = [
    token.document.uuid, Math.round(from.x), Math.round(from.y), action, revision,
    JSON.stringify(options.constrainOptions ?? null),
  ].join('|');
  const now = performance.now();
  let entry = kept.get(key);
  if (!entry || (now - entry.used >= NAVIGATOR_TTL_MS)) {
    for (const [other, { used }] of kept) if (now - used >= NAVIGATOR_TTL_MS) kept.delete(other);
    kept.delete(key);
    if (kept.size >= NAVIGATORS_KEPT) kept.delete(kept.keys().next().value);
    entry = {
      navigator: makeNavigator(token, {
        action,
        from,
        constrainOptions: options.constrainOptions,
        measureOptions: options.measureOptions,
      }),
    };
    kept.set(key, entry);
  }
  entry.used = now;
  return entry.navigator;
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

/** Can a leg be laid out on the grid? Teleports and changes of height are left alone. */
function plannable(from, to) {
  if ((from.elevation ?? 0) !== (to.elevation ?? 0)) return false; // routes are planned on the flat
  const config = CONFIG.Token.movement.actions[to.action];
  return !!config && !config.teleport && (config.measure !== false) && !!config.walls;
}

/**
 * Plan one leg, from one waypoint to the next. A generator, so the caller
 * decides how long it may run at a stretch.
 * @param {Token} token
 * @param {object} from
 * @param {object} to
 * @param {object} options           As passed to findMovementPath
 * @param {object} how
 * @param {boolean} how.reached      Does the straight leg get there?
 * @param {boolean} how.search       May a route other than the straight one be looked for?
 * @param {number} how.parity        Diagonal steps taken before this leg, odd or even
 * @returns {Generator<void, {corners: object[], diagonals: number}|null>}
 *   Waypoints to insert between the two and the diagonal steps the leg takes,
 *   or null to leave the leg as it is.
 */
function* planLeg(token, from, to, options, { reached, search, parity }) {
  if (!plannable(from, to)) return null;
  const navigator = navigatorFor(token, from, to.action, options);
  const goal = navigator.offsetOf(to);
  if ((goal.i === navigator.start.i) && (goal.j === navigator.start.j)) return null;

  const grid = navigator.grid;
  const unit = grid.distance;
  const rules = { unit, step: navigator.step, edge: navigator.edge, startParity: parity };
  // Which way a step goes, by where it leads on the map: on a hex grid the
  // same direction changes the offset differently on odd and even rows.
  const direction = (a, b) => {
    const p = navigator.deltaOf(a);
    const q = navigator.deltaOf(b);
    return `${Math.round(q.x - p.x)},${Math.round(q.y - p.y)}`;
  };

  // The straight leg as core lays it out: the run of spaces it draws, prices
  // and (in dnd5e) tests for creatures in the way.
  let straight = null;
  if (reached) {
    const cells = token.document.getCompleteMovementPath([from, to]).map((step) => navigator.offsetOf(step));
    straight = { cells, ...priceCells(cells, rules) };
  }
  const walkable = !!straight && Number.isFinite(straight.cost);

  // Look for another route if the straight one is stopped short, if one of
  // its steps is not allowed, or if something on it costs extra.
  let route = null;
  if (search && (!walkable || (straight.cost > straight.open + (unit * 1e-6)))) {
    // Far enough to get round most things, short enough that a route which
    // does not exist is given up on quickly.
    const limit = (setting(SETTINGS.maxSpaces) ?? 30) * unit * 2;
    route = yield* findRoute({
      start: navigator.start,
      goal,
      unit,
      // A route that gets there already is only replaced by a cheaper one.
      maxCost: walkable ? Math.min(limit, straight.cost - (unit * 1e-3)) : limit,
      neighbors: navigator.neighbors,
      step: navigator.step,
      edge: navigator.edge,
      heuristic: makeHeuristic(grid, goal),
      startParity: parity,
      direction,
    });
  }

  const cells = route?.cells ?? (walkable ? straight.cells : null);
  if (!cells) return null;

  // Only the corners matter: between two corners the route is a straight run
  // of identical steps, which is exactly the line core will draw.
  const corners = turningPoints(cells, direction).map((cell) => ({
    ...to,
    ...navigator.positionOf(cell),
    snapped: true,
    explicit: false,
    checkpoint: false,
    intermediate: false,
  }));
  return { corners, diagonals: route ? priceCells(cells, rules).diagonals : straight.diagonals };
}

/**
 * Work out the whole route, leg by leg.
 * @param {Token} token
 * @param {object[]} full         Complete waypoints, origin first
 * @param {object} options        As passed to findMovementPath
 * @param {(waypoints: object[], options: object) => object} findBelow
 * @param {boolean} search        May routes other than the straight one be looked for?
 * @returns {Generator<void, object[]|null>} The route, or null to keep the
 *   straight one.
 */
function* plan(token, full, options, findBelow, search) {
  const quick = { ...options, delay: 0 };
  const unconstrained = !!options.constrainOptions?.ignoreWalls;
  const expanded = [full[0]];
  let parity = canvas.grid.isSquare ? diagonalsThisTurn(token) % 2 : 0;
  let changed = false;
  for (let n = 1; n < full.length; n++) {
    const from = full[n - 1];
    const to = full[n];
    const legEnd = findBelow([from, to], quick)?.result?.at(-1);
    const reached = !!legEnd && sameSpot(legEnd, to);

    // With walls ignored, whatever stops a leg is not something to go round.
    const leg = (reached || (search && !unconstrained))
      ? yield* planLeg(token, from, to, options, { reached, search, parity })
      : null;
    if (!leg && !reached) {
      // No way round this leg. Hand the rest over as it was, and core will
      // take the route as far as it goes.
      expanded.push(...full.slice(n));
      break;
    }
    if (leg) {
      parity = (parity + leg.diagonals) % 2;
      if (leg.corners.length) {
        expanded.push(...leg.corners);
        changed = true;
      }
    }
    expanded.push(to);
  }
  if (!changed) return null;

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
  if (!canvas.ready || canvas.grid.isGridless) return direct;
  if (!Array.isArray(waypoints) || (waypoints.length < 2)) return direct;

  // An unfinished job means a pathfinder further down is already at work.
  // It was installed on purpose; leave the route to it.
  if (!direct || (direct.result === undefined)) return direct;

  const given = complete(token, waypoints);
  const destination = given.at(-1);
  const end = direct.result.at(-1);
  const arrives = !!end && sameSpot(end, destination);

  // A route that arrives is taken as it was found, so one that something
  // further down has already bent keeps its bends. Its turns are still marked.
  const full = arrives ? direct.result.map((waypoint) => ({ ...waypoint })) : given;
  const search = !!setting(SETTINGS.pathfinding);
  if (!arrives && !search) return direct;

  const started = performance.now();
  const work = plan(token, full, options, findBelow, search);
  const finish = (path, how) => {
    // Never trade a route that arrives for one that does not.
    const last = path?.at(-1);
    if (path && arrives && !(last && sameSpot(last, destination))) path = null;
    if (!arrives || path) {
      log.debug(`pathfinding: ${path ? 'route planned' : 'no way round'} in `
        + `${(performance.now() - started).toFixed(1)} ms (${how})`);
    }
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
