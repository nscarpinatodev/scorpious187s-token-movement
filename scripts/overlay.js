/**
 * The reachable-space overlay.
 *
 * Shown while a token is dragged (and optionally pinned with a keybinding).
 * The search itself lives in reachability.js and the drawing in
 * overlay-render.js; this file decides what there is to show and when.
 *
 * Whether a step is allowed and what it costs come from the token itself
 * (see navigation.js), so difficult terrain, a system's movement rules and
 * anything a module layers on top are all honoured without this module
 * knowing about any of them.
 *
 * During a drag the overlay follows the route core is planning. When a drag
 * starts it shows everything the token could reach. As the route grows it is
 * redrawn from the route's end with whatever movement the route leaves, and
 * the spaces that were reachable at the start but no longer are get dimmed —
 * so the price of the chosen route is visible before the token is dropped.
 */

import { SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { guarded, log } from './logger.js';
import { getMovementRanges, diagonalsThisTurn, bandColors, routeBands } from './speed.js';
import { explore, summarisePath } from './reachability.js';
import { bandAt } from './shapes.js';
import { makeNavigator } from './navigation.js';
import { paintRange, clearRange, forgetRange, overlayStyle, routesStyled } from './overlay-render.js';

/** Longest the search may hold a single frame, in ms. */
const FRAME_BUDGET_MS = 9;

/** While a long search runs, redraw what is known so far this often, in ms. */
const PARTIAL_DRAW_MS = 90;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const keyOf = (offset) => `${offset.i},${offset.j}`;

/**
 * @typedef {object} LivePlan   Where a drag's planned route has got to.
 * @property {{x: number, y: number}} from  The route's last reachable position
 * @property {string} action                Movement action at that point
 * @property {number} spent                 Cost of the route so far, scene units
 * @property {number} diagonals             Diagonal steps the route takes
 */

/**
 * Read the route core is planning for this user's drag of a token.
 * @param {Token} token
 * @returns {LivePlan|null}
 *   null when there is no route yet (still on the starting space).
 *
 * While a pathfinder is still searching, core keeps the part of the route it
 * is sure of — up to the last waypoint already reached, often just the start
 * — and that is what is read here. So the overlay never stops: it shows the
 * range from as far as the route is known, which at worst is the full range
 * from the start, and moves on the moment the search reports back.
 */
function readLivePlan(token) {
  const planned = token._plannedMovement?.[game.user.id];
  if (!planned) return null;
  const path = planned.foundPath ?? [];
  if (path.length < 2) return null;

  // Core has already priced every step of the route, continuing from this
  // turn's movement history, so its numbers are used as they are.
  const grid = canvas.grid;
  const document = token.document;
  const toOffset = (waypoint) => {
    const center = document.getCenterPoint(waypoint);
    return grid.getOffset({ x: center.x, y: center.y });
  };
  const measured = (waypoint) => {
    const config = CONFIG.Token.movement.actions[waypoint.action];
    return !config?.teleport && (config?.measure !== false);
  };
  const { cost, diagonals } = summarisePath(path, { toOffset, measured, square: grid.isSquare });

  const end = path.at(-1);
  const source = document._source;
  const atStart = (Math.round(end.x) === Math.round(source.x)) && (Math.round(end.y) === Math.round(source.y));
  if (atStart && (cost === 0)) return null;

  return { from: { x: end.x, y: end.y }, action: end.action, spent: cost, diagonals };
}

/**
 * Where the spaces a token covers lie, relative to its own centre. Worked
 * out once per drag: asking core for a token's footprint is not cheap, and
 * the route asks it for every step.
 */
function footprintOf(token) {
  const grid = canvas.grid;
  const document = token.document;
  const source = document._source;
  const anchor = document.getSnappedPosition({ x: source.x, y: source.y });
  const center = document.getCenterPoint({ x: anchor.x, y: anchor.y });
  let occupied = guarded('token footprint',
    () => document.getOccupiedGridSpaceOffsets({ x: anchor.x, y: anchor.y }), []);
  if (!occupied?.length) occupied = [grid.getOffset({ x: center.x, y: center.y })];
  return occupied.map((offset) => {
    const point = grid.getCenterPoint(offset);
    return { x: point.x - center.x, y: point.y - center.y };
  });
}

/**
 * The route being dragged, as shapes to draw: the spaces it crosses and the
 * centre of each step. The part that can be reached is split by band, so
 * each stretch can be drawn in the colour of the band its distance falls in;
 * the part that cannot be reached is kept apart.
 * @returns {{strips: {color: number, alpha: number, polygons: object[][]}[], blocked: object[][],
 *   steps: object[], signature: string}|null}
 */
function readRoute(token, footprint) {
  const planned = token._plannedMovement?.[game.user.id];
  if (!planned) return null;
  const found = planned.foundPath ?? [];
  const unreachable = planned.unreachableWaypoints ?? [];
  if ((found.length < 2) && !unreachable.length) return null;

  const grid = canvas.grid;
  const document = token.document;
  const action = token._getDragMovementAction?.() ?? document.movementAction;
  const { ranges, start } = routeBands(token, action);
  const seen = new Set();
  const steps = [];
  const spacesOf = (waypoint, blocked) => {
    const list = [];
    const center = document.getCenterPoint({ x: waypoint.x, y: waypoint.y });
    steps.push({ x: center.x, y: center.y, blocked });
    for (const part of footprint) {
      const offset = grid.getOffset({ x: center.x + part.x, y: center.y + part.y });
      const key = keyOf(offset);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(grid.getVertices(offset));
    }
    return list;
  };

  // Core has priced every step; adding them up says which band each is in.
  const byBand = new Map();
  let used = start;
  for (const waypoint of found) {
    if (Number.isFinite(waypoint.cost)) used += waypoint.cost;
    const band = bandAt(ranges, used);
    if (!byBand.has(band)) byBand.set(band, { color: band.color, alpha: band.alpha, polygons: [] });
    byBand.get(band).polygons.push(...spacesOf(waypoint, false));
  }
  const strips = [...byBand.values()].filter((strip) => strip.polygons.length);
  const blocked = unreachable.flatMap((waypoint) => spacesOf(waypoint, true));
  return {
    strips,
    blocked,
    steps,
    signature: [
      steps.map((step) => `${Math.round(step.x)},${Math.round(step.y)}${step.blocked ? '!' : ''}`).join(' '),
      strips.map((strip) => `${strip.color.toString(16)}x${strip.polygons.length}`).join(' '),
    ].join('|'),
  };
}

/**
 * Gather everything the search needs for one token, or null if there is
 * nothing to draw (gridless scene, unknown speed, teleporting…).
 * @param {Token} token
 * @param {LivePlan|null} [live]  Start from the end of a planned route
 *   instead of from where the token stands.
 */
function buildPlan(token, live = null) {
  if (!canvas.ready) return null;
  const grid = canvas.grid;
  if (grid.isGridless) return null;

  const document = token.document;
  const action = live?.action ?? token._getDragMovementAction?.() ?? document.movementAction;
  const actionConfig = CONFIG.Token.movement.actions[action];
  if (!actionConfig || actionConfig.teleport || (actionConfig.measure === false)) return null;

  let ranges = getMovementRanges(token, action);
  if (!ranges.length) return null;
  const accent = ranges[0].color;

  // Clip absurd speeds so a drag can never stall on the search.
  const cap = (setting(SETTINGS.maxSpaces) ?? 30) * grid.distance;
  if (ranges.at(-1).distance > cap) {
    log.debug(`range ${ranges.at(-1).distance} clipped to ${cap}`);
    ranges = ranges.map((range) => ({ ...range, distance: Math.min(range.distance, cap) }));
  }

  // What the planned route has used is no longer available. Each band keeps
  // its own colour as it shrinks; a band the route has used up drops out.
  if (live) {
    ranges = ranges
      .map((range) => ({ ...range, distance: range.distance - live.spent }))
      .filter((range) => range.distance > 0);
  }
  const maxCost = ranges.at(-1)?.distance ?? 0;

  // Laid out from where the token stands, or from the end of the planned route.
  const navigator = makeNavigator(token, { action, from: live?.from ?? null });
  const { anchor, start, startCenter, deltaOf } = navigator;

  // The spaces a (possibly large) token covers, relative to its reference space.
  let occupied = guarded('token footprint',
    () => document.getOccupiedGridSpaceOffsets({ x: anchor.x, y: anchor.y }), []);
  if (!occupied?.length) occupied = [start];
  const footprint = occupied.map((offset) => {
    const center = grid.getCenterPoint(offset);
    return { x: center.x - startCenter.x, y: center.y - startCenter.y };
  });

  // Players are only shown spaces they have seen, so the tint never spills
  // into parts of the map that are still unexplored.
  const limited = !game.user.isGM && !!canvas.visibility?.tokenVision;
  const known = (point) => canvas.fog.isPointExplored(point)
    || canvas.visibility.testVisibility(point, { tolerance: 1 });

  return {
    grid,
    ranges,
    accent,
    footprint,
    limited,
    known,
    deltaOf,
    startCenter,
    // With nothing left there is nothing to search; the caller still paints,
    // because the spaces the route has cost are worth showing.
    search: !ranges.length ? null : {
      start,
      maxCost,
      unit: grid.distance,
      neighbors: navigator.neighbors,
      step: navigator.step,
      edge: navigator.edge,
      // Under the alternating diagonal rules, carry on counting from the
      // diagonals already taken this turn and along the planned route.
      startParity: (diagonalsThisTurn(token) + (live?.diagonals ?? 0)) % 2,
    },
  };
}

/**
 * Turn a search result into the grid spaces to paint.
 * @returns {Map<string, {offset: object, band: number, vertices: object[]}>}
 */
function collectCells(plan, reached) {
  const { grid, ranges, footprint, limited, known, deltaOf, startCenter } = plan;

  // Which band does each grid space fall in? A large token covers several
  // spaces per position; a space takes the nearest band of any that cover it.
  const epsilon = grid.distance * 1e-6;
  const cells = new Map();
  for (const node of reached.values()) {
    const band = ranges.findIndex((range) => node.cost <= range.distance + epsilon);
    if (band < 0) continue;
    const delta = deltaOf(node);
    for (const part of footprint) {
      const offset = grid.getOffset({
        x: startCenter.x + delta.x + part.x,
        y: startCenter.y + delta.y + part.y,
      });
      const key = keyOf(offset);
      const existing = cells.get(key);
      if (!existing) cells.set(key, { offset, band });
      else if (band < existing.band) existing.band = band;
    }
  }

  // A large token near the edge overhangs the canvas; do not paint out there.
  // And never tint somewhere the player has not seen.
  const bounds = canvas.dimensions.rect;
  for (const [key, cell] of cells) {
    const center = grid.getCenterPoint(cell.offset);
    if (!bounds.contains(center.x, center.y) || (limited && !known(center))) cells.delete(key);
    else cell.vertices = grid.getVertices(cell.offset);
  }
  return cells;
}

class RangeOverlay {
  /** Bumped on every show/clear; a search that finds it changed gives up. */
  #generation = 0;

  /** The token being dragged, while a drag is in progress. */
  #dragged = null;

  /** A token whose range is pinned with the keybinding. */
  #pinned = null;

  /** What the dragged token could reach when the drag began. */
  #baseline = null;

  /** The dragged token's footprint, for laying out the route. */
  #footprint = null;

  /** The planned route the overlay currently reflects ("start" = none). */
  #signature = null;

  /** What was last painted, for `snapshot()`. */
  #painted = null;

  get pinned() {
    return this.#pinned;
  }

  /**
   * Is the route this user is dragging for `token` being drawn here? Core's
   * ruler asks, and stands its own line down when the answer is yes.
   * @param {Token} token
   */
  drawsRouteFor(token) {
    return (this.#dragged === token) && routesStyled();
  }

  onDragStart(token) {
    if (!setting(SETTINGS.rangeOverlay)) return;
    this.#dragged = token;
    this.#baseline = null;
    this.#footprint = null;
    this.#signature = 'start';
    this.#show(token);
  }

  onDragEnd(token) {
    if (this.#dragged !== token) return;
    this.#dragged = null;
    this.#baseline = null;
    this.#footprint = null;
    this.#signature = null;
    this.refresh();
  }

  #route(token) {
    if (!this.drawsRouteFor(token)) return null;
    this.#footprint ??= footprintOf(token);
    return readRoute(token, this.#footprint);
  }

  /**
   * Core has (re)planned the dragged token's route. Called whenever the
   * token's ruler refreshes, which is often; nothing is recomputed unless the
   * route actually changed.
   */
  onPlanChanged(token) {
    if ((this.#dragged !== token) || !setting(SETTINGS.rangeOverlay)) return;
    const live = readLivePlan(token);
    const route = this.#route(token);
    const signature = live
      ? [Math.round(live.from.x), Math.round(live.from.y), live.action, live.spent.toFixed(3), live.diagonals,
        route?.signature ?? ''].join('|')
      : `start|${route?.signature ?? ''}`;
    if (signature === this.#signature) return;
    this.#signature = signature;
    this.#show(token, live);
  }

  /** Pin the range of `token`, or unpin if it is already pinned (or null). */
  togglePin(token) {
    this.#pinned = (!token || (this.#pinned === token)) ? null : token;
    this.refresh();
  }

  /** Forget a token that has gone away or been deselected. */
  release(token) {
    if (this.#pinned === token) this.#pinned = null;
    if (this.#dragged === token) this.#dragged = null;
    this.refresh();
  }

  /** Redraw for whatever should currently be showing, or clear. */
  refresh() {
    const token = this.#dragged ?? this.#pinned;
    if (!token || token.destroyed || !setting(SETTINGS.rangeOverlay)) {
      this.clear();
      return;
    }
    // Something the range depends on changed (a wall, a setting, the HUD's
    // colours), so what was reachable at the start of a drag is stale too.
    if (token === this.#dragged) {
      this.#baseline = null;
      this.#show(token, readLivePlan(token));
    } else this.#show(token);
  }

  clear() {
    this.#generation++;
    this.#painted = null;
    if (canvas.ready) clearRange();
  }

  /** Drop all state. Called when the canvas is torn down. */
  reset() {
    this.#generation++;
    this.#dragged = null;
    this.#pinned = null;
    this.#baseline = null;
    this.#footprint = null;
    this.#signature = null;
    this.#painted = null;
    forgetRange();
  }

  /**
   * What is on screen, in plain data. For tests and for other packages.
   * @returns {{style: string, bands: object[], spaces: Record<string, number>, spent: string[],
   *   route: {spaces: number, blocked: number, steps: number}|null}|null}
   *   `spaces` maps "x,y" (the top-left corner of a grid space, in pixels) to
   *   the index of the band it is in.
   */
  snapshot() {
    return this.#painted;
  }

  #paint(plan, cells, before, route) {
    const grid = canvas.grid;
    const spent = [];
    const spentKeys = [];
    if (before) {
      for (const [key, cell] of before) {
        if (cells.has(key)) continue;
        spent.push(cell.vertices);
        spentKeys.push(cell.offset);
      }
    }
    const ranges = plan?.ranges ?? [];
    const accent = plan?.accent ?? bandColors()[0];
    paintRange({ ranges, cells, spent, accent, route });

    const corner = (offset) => {
      const point = grid.getTopLeftPoint(offset);
      return `${Math.round(point.x)},${Math.round(point.y)}`;
    };
    const spaces = {};
    for (const cell of cells.values()) spaces[corner(cell.offset)] = cell.band;
    this.#painted = {
      style: overlayStyle(),
      bands: ranges.map((range) => ({ distance: range.distance, color: range.color })),
      spaces,
      spent: spentKeys.map(corner),
      route: route ? {
        spaces: route.strips.reduce((sum, strip) => sum + strip.polygons.length, 0),
        blocked: route.blocked.length,
        steps: route.steps.length,
        colors: route.strips.map((strip) => strip.color),
      } : null,
    };
  }

  /**
   * Run a search across as many frames as it needs.
   * @returns {Promise<Map|null>} The result, or null if it was superseded.
   */
  async #search(plan, generation, onPartial = null) {
    const search = explore(plan.search);
    let lastDraw = performance.now();
    for (;;) {
      const sliceStart = performance.now();
      let result;
      do result = search.next();
      while (!result.done && (performance.now() - sliceStart < FRAME_BUDGET_MS));
      if (result.done) return result.value;
      if (onPartial && (performance.now() - lastDraw > PARTIAL_DRAW_MS)) {
        onPartial(result.value);
        lastDraw = performance.now();
      }
      await nextFrame();
      if ((generation !== this.#generation) || !canvas.ready) return null;
    }
  }

  /**
   * @param {Token} token
   * @param {LivePlan|null} [live]  The drag's planned route, if it has one
   */
  async #show(token, live = null) {
    const generation = ++this.#generation;
    try {
      const started = performance.now();
      const dragging = this.#dragged === token;
      const route = dragging ? this.#route(token) : null;
      let before = dragging ? this.#baseline : null;

      // The range from where the token stands. Always what a pinned range
      // shows; during a drag it is also what the route is compared against.
      if (!live || (dragging && !before)) {
        const plan = buildPlan(token);
        if (!plan) {
          // No range to show (unknown speed, say), but the route still is.
          if (route) this.#paint(null, new Map(), null, route);
          else this.clear();
          return;
        }
        // Usually done well inside one frame. A very fast token on a busy map
        // is spread across several instead of freezing the drag, and the
        // nearer bands are painted as soon as they are known.
        const reached = await this.#search(plan, generation,
          live ? null : (partial) => this.#paint(plan, collectCells(plan, partial), null, route));
        if (!reached || !canvas.ready) return;
        const cells = collectCells(plan, reached);
        if (dragging) this.#baseline = before = cells;
        if (!live) {
          this.#paint(plan, cells, null, route);
          log.debug(`range: ${reached.size} spaces in ${(performance.now() - started).toFixed(1)} ms`);
          return;
        }
      }

      // The range from the end of the planned route, with what the route
      // leaves. No partial painting here: a half-finished search would show
      // spaces as lost that are merely not reached yet.
      const plan = buildPlan(token, live);
      if (!plan) {
        if (route) this.#paint(null, new Map(), null, route);
        else this.clear();
        return;
      }
      const reached = plan.search ? await this.#search(plan, generation) : new Map();
      if (!reached || !canvas.ready) return;
      this.#paint(plan, collectCells(plan, reached), before, route);
      log.debug(`range after route (${live.spent} used): ${reached.size} spaces in `
        + `${(performance.now() - started).toFixed(1)} ms`);
    } catch (err) {
      log.error('range overlay failed', err);
      guarded('range overlay cleanup', () => clearRange());
    }
  }
}

export const rangeOverlay = new RangeOverlay();
