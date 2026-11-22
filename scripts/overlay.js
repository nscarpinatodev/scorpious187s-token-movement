/**
 * The reachable-space overlay.
 *
 * Shown while a token is dragged (and optionally pinned with a keybinding).
 * The search itself lives in reachability.js; this file supplies it with the
 * live grid, walls and terrain, and paints the answer on a grid highlight
 * layer — the same mechanism core's ruler uses for its path squares.
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

import { MODULE_ID, SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { guarded, log } from './logger.js';
import { getMovementRanges, diagonalsThisTurn } from './speed.js';
import { explore, boundaryEdges, summarisePath } from './reachability.js';
import { makeNavigator } from './navigation.js';

const LAYER = `${MODULE_ID}.range`;

/** Longest the search may hold a single frame, in ms. */
const FRAME_BUDGET_MS = 9;

/** While a long search runs, redraw what is known so far this often, in ms. */
const PARTIAL_DRAW_MS = 90;

/** Tint for spaces the planned route has put out of reach. */
const SPENT_COLOR = 0x10141c;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * @typedef {object} LivePlan   Where a drag's planned route has got to.
 * @property {{x: number, y: number}} from  The route's last reachable position
 * @property {string} action                Movement action at that point
 * @property {number} spent                 Cost of the route so far, scene units
 * @property {number} diagonals             Diagonal steps the route takes
 * @property {string} signature             Changes when any of the above does
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

  return {
    from: { x: end.x, y: end.y },
    action: end.action,
    spent: cost,
    diagonals,
    signature: [Math.round(end.x), Math.round(end.y), end.action, cost.toFixed(3), diagonals].join('|'),
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
      const key = `${offset.i},${offset.j}`;
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

/**
 * Paint the highlight layer.
 * @param {object} plan
 * @param {Map<string, object>} cells       Spaces reachable now
 * @param {Map<string, object>|null} before Spaces that were reachable when the
 *   drag began; those no longer in `cells` are dimmed.
 */
function paint(plan, cells, before = null) {
  const { ranges } = plan;
  const layer = canvas.interface.grid.addHighlightLayer(LAYER);
  layer.clear();
  layer.lineStyle(0);

  // What the route has cost: reachable at the start, not any more.
  if (before) {
    const alpha = Math.min((setting(SETTINGS.rangeOpacity) ?? 0.28) * 1.25, 0.6);
    layer.beginFill(SPENT_COLOR, alpha);
    for (const [key, cell] of before) {
      if (!cells.has(key)) layer.drawPolygon(cell.vertices);
    }
    layer.endFill();
  }

  // Fills, one band at a time so each batch shares a style.
  for (let band = 0; band < ranges.length; band++) {
    const { color, alpha } = ranges[band];
    layer.beginFill(color, alpha);
    for (const cell of cells.values()) {
      if (cell.band === band) layer.drawPolygon(cell.vertices);
    }
    layer.endFill();
  }

  // Outline each band's outer edge. Furthest first, so the nearer band's line
  // is drawn on top where the two coincide.
  const width = Math.max(4 * canvas.dimensions.uiScale, 2);
  for (let band = ranges.length - 1; band >= 0; band--) {
    const { color } = ranges[band];
    const polygons = [];
    for (const cell of cells.values()) if (cell.band <= band) polygons.push(cell.vertices);
    layer.lineStyle({ width, color, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND });
    for (const [a, b] of boundaryEdges(polygons)) {
      layer.moveTo(a.x, a.y);
      layer.lineTo(b.x, b.y);
    }
  }
  layer.lineStyle(0);
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

  /** The planned route the overlay currently reflects ("start" = none). */
  #signature = null;

  get pinned() {
    return this.#pinned;
  }

  onDragStart(token) {
    if (!setting(SETTINGS.rangeOverlay)) return;
    this.#dragged = token;
    this.#baseline = null;
    this.#signature = 'start';
    this.#show(token);
  }

  onDragEnd(token) {
    if (this.#dragged !== token) return;
    this.#dragged = null;
    this.#baseline = null;
    this.#signature = null;
    this.refresh();
  }

  /**
   * Core has (re)planned the dragged token's route. Called whenever the
   * token's ruler refreshes, which is often; nothing is recomputed unless the
   * route's end or cost actually changed.
   */
  onPlanChanged(token) {
    if ((this.#dragged !== token) || !setting(SETTINGS.rangeOverlay)) return;
    const live = readLivePlan(token);
    const signature = live?.signature ?? 'start';
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
    if (canvas.ready) canvas.interface?.grid?.clearHighlightLayer(LAYER);
  }

  /** Drop all state. Called when the canvas is torn down. */
  reset() {
    this.#generation++;
    this.#dragged = null;
    this.#pinned = null;
    this.#baseline = null;
    this.#signature = null;
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
      let before = dragging ? this.#baseline : null;

      // The range from where the token stands. Always what a pinned range
      // shows; during a drag it is also what the route is compared against.
      if (!live || (dragging && !before)) {
        const plan = buildPlan(token);
        if (!plan) {
          canvas.interface.grid.clearHighlightLayer(LAYER);
          return;
        }
        // Usually done well inside one frame. A very fast token on a busy map
        // is spread across several instead of freezing the drag, and the
        // nearer bands are painted as soon as they are known.
        const reached = await this.#search(plan, generation,
          live ? null : (partial) => paint(plan, collectCells(plan, partial)));
        if (!reached || !canvas.ready) return;
        const cells = collectCells(plan, reached);
        if (dragging) this.#baseline = before = cells;
        if (!live) {
          paint(plan, cells);
          log.debug(`range: ${reached.size} spaces in ${(performance.now() - started).toFixed(1)} ms`);
          return;
        }
      }

      // The range from the end of the planned route, with what the route
      // leaves. No partial painting here: a half-finished search would show
      // spaces as lost that are merely not reached yet.
      const plan = buildPlan(token, live);
      if (!plan) {
        canvas.interface.grid.clearHighlightLayer(LAYER);
        return;
      }
      const reached = plan.search ? await this.#search(plan, generation) : new Map();
      if (!reached || !canvas.ready) return;
      paint(plan, collectCells(plan, reached), before);
      log.debug(`range after route (${live.spent} used): ${reached.size} spaces in `
        + `${(performance.now() - started).toFixed(1)} ms`);
    } catch (err) {
      log.error('range overlay failed', err);
      guarded('range overlay cleanup', () => canvas.interface.grid.clearHighlightLayer(LAYER));
    }
  }
}

export const rangeOverlay = new RangeOverlay();
