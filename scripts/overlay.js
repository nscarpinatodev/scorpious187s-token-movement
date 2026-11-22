/**
 * The reachable-space overlay.
 *
 * Shown while a token is dragged (and optionally pinned with a keybinding).
 * The search itself lives in reachability.js; this file supplies it with the
 * live grid, walls and terrain, and paints the answer on a grid highlight
 * layer — the same mechanism core's ruler uses for its path squares.
 *
 * Costs come from core. Each step is priced by asking the token to measure
 * that step with its own cost function, so difficult terrain, a system's
 * movement-action rules and anything a module layers on top are all honoured
 * without this module knowing about any of them.
 */

import { MODULE_ID, SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { guarded, log } from './logger.js';
import { getMovementRanges, diagonalsThisTurn } from './speed.js';
import { explore, makeStepMetric, boundaryEdges } from './reachability.js';

const LAYER = `${MODULE_ID}.range`;

/** Longest the search may hold a single frame, in ms. */
const FRAME_BUDGET_MS = 9;

/** While a long search runs, redraw what is known so far this often, in ms. */
const PARTIAL_DRAW_MS = 90;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Gather everything the search needs for one token, or null if there is
 * nothing to draw (gridless scene, unknown speed, teleporting…).
 */
function buildPlan(token) {
  if (!canvas.ready) return null;
  const grid = canvas.grid;
  if (grid.isGridless) return null;

  const document = token.document;
  const action = token._getDragMovementAction?.() ?? document.movementAction;
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
  const maxCost = ranges.at(-1).distance;

  // Everything is laid out relative to the token's snapped starting position.
  // Space centres form a lattice on both square and hex grids, so the token's
  // position for any other space is the start plus the difference of centres.
  const source = document._source;
  const anchor = document.getSnappedPosition({ x: source.x, y: source.y });
  const tokenCenter = document.getCenterPoint({ x: anchor.x, y: anchor.y });
  const start = grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
  const startCenter = grid.getCenterPoint(start);

  const deltas = new Map();
  const deltaOf = (offset) => {
    const key = `${offset.i},${offset.j}`;
    let delta = deltas.get(key);
    if (!delta) {
      const center = grid.getCenterPoint(offset);
      delta = { x: center.x - startCenter.x, y: center.y - startCenter.y };
      deltas.set(key, delta);
    }
    return delta;
  };

  // The spaces a (possibly large) token covers, relative to its reference space.
  let occupied = guarded('token footprint',
    () => document.getOccupiedGridSpaceOffsets({ x: anchor.x, y: anchor.y }), []);
  if (!occupied?.length) occupied = [start];
  const footprint = occupied.map((offset) => {
    const center = grid.getCenterPoint(offset);
    return { x: center.x - startCenter.x, y: center.y - startCenter.y };
  });

  // Can the token step from one space to the next? Rather than testing walls
  // here, ask the token class to constrain the one-step path, exactly as a
  // drag would. That is the system's own answer, so it already includes
  // everything the system counts as blocking — walls, surfaces between
  // levels, dnd5e's enemy-occupied spaces — and core's rule that a player's
  // preview is only stopped by walls they have actually seen. It also honours
  // the GM's "unconstrained movement" toggle through the drag options.
  const constrainOptions = {
    ...(guarded('constrain options', () => token._getDragConstrainOptions(), {}) ?? {}),
    preview: true,
  };
  const blocked = (from, to) => {
    const a = deltaOf(from);
    const b = deltaOf(to);
    const destination = { x: Math.round(anchor.x + b.x), y: Math.round(anchor.y + b.y) };
    const [path] = token.constrainMovementPath([
      { x: anchor.x + a.x, y: anchor.y + a.y, action, snapped: true },
      { ...destination, action, snapped: true },
    ], constrainOptions);
    const end = path.at(-1);
    // "Constrained" alone is not "blocked": a token whose centre sits exactly
    // on a wall line is nudged by a pixel and still arrives.
    return !end || (path.length < 2)
      || (Math.abs(end.x - destination.x) > 1) || (Math.abs(end.y - destination.y) > 1);
  };

  // Players are only shown spaces they have seen, so the tint never spills
  // into parts of the map that are still unexplored.
  const limited = !game.user.isGM && !!canvas.visibility?.tokenVision;
  const known = (point) => canvas.fog.isPointExplored(point)
    || canvas.visibility.testVisibility(point, { tolerance: 1 });

  // Price of a step relative to open ground, straight from core's measurement.
  const costFunction = guarded('movement cost function',
    () => token._getMovementCostFunction({ ...(token._getDragMeasureOptions?.() ?? {}), preview: true }),
    undefined);
  const factor = (from, to) => {
    const a = deltaOf(from);
    const b = deltaOf(to);
    const measured = document.measureMovementPath([
      { x: anchor.x + a.x, y: anchor.y + a.y, action },
      { x: anchor.x + b.x, y: anchor.y + b.y, action },
    ], { cost: costFunction });
    if (!(measured.distance > 0)) return 1;
    return measured.cost / measured.distance;
  };

  const bounds = canvas.dimensions.rect;
  const neighbors = (offset) => grid.getAdjacentOffsets(offset).filter((next) => {
    const delta = deltaOf(next);
    return bounds.contains(tokenCenter.x + delta.x, tokenCenter.y + delta.y);
  });

  return {
    grid,
    ranges,
    footprint,
    limited,
    known,
    deltaOf,
    startCenter,
    search: {
      start,
      maxCost,
      unit: grid.distance,
      neighbors,
      // The scene's grid carries the world's "Square Grid Diagonals" setting,
      // so the rule in force is whatever the GM has chosen there. Under the
      // alternating rules, carry on counting from the diagonals already taken
      // this turn.
      step: makeStepMetric(grid, CONST.GRID_DIAGONALS),
      startParity: diagonalsThisTurn(token) % 2,
      edge: (from, to) => (blocked(from, to) ? Infinity : factor(from, to)),
    },
  };
}

/** Paint a finished search onto the highlight layer. */
function draw(plan, reached) {
  const { grid, ranges, footprint, limited, known, deltaOf, startCenter } = plan;
  const layer = canvas.interface.grid.addHighlightLayer(LAYER);
  layer.clear();

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
  }

  for (const cell of cells.values()) cell.vertices = grid.getVertices(cell.offset);

  // Fills, one band at a time so each batch shares a style.
  layer.lineStyle(0);
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

  get pinned() {
    return this.#pinned;
  }

  onDragStart(token) {
    if (!setting(SETTINGS.rangeOverlay)) return;
    this.#dragged = token;
    this.#show(token);
  }

  onDragEnd(token) {
    if (this.#dragged !== token) return;
    this.#dragged = null;
    this.refresh();
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
    if (token && !token.destroyed && setting(SETTINGS.rangeOverlay)) this.#show(token);
    else this.clear();
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
  }

  async #show(token) {
    const generation = ++this.#generation;
    try {
      const started = performance.now();
      const plan = buildPlan(token);
      if (!plan) {
        canvas.interface.grid.clearHighlightLayer(LAYER);
        return;
      }

      // Usually done well inside one frame. A very fast token on a busy map
      // is spread across several instead of freezing the drag, and the nearer
      // bands are painted as soon as they are known rather than all at the end.
      const search = explore(plan.search);
      let reached;
      let lastDraw = performance.now();
      for (;;) {
        const sliceStart = performance.now();
        let result;
        do result = search.next();
        while (!result.done && (performance.now() - sliceStart < FRAME_BUDGET_MS));
        if (result.done) {
          reached = result.value;
          break;
        }
        if (performance.now() - lastDraw > PARTIAL_DRAW_MS) {
          draw(plan, result.value);
          lastDraw = performance.now();
        }
        await nextFrame();
        if ((generation !== this.#generation) || !canvas.ready) return;
      }

      if (!canvas.ready) return;
      draw(plan, reached);
      log.debug(`range: ${reached.size} spaces in ${(performance.now() - started).toFixed(1)} ms`);
    } catch (err) {
      log.error('range overlay failed', err);
      guarded('range overlay cleanup', () => canvas.interface.grid.clearHighlightLayer(LAYER));
    }
  }
}

export const rangeOverlay = new RangeOverlay();
