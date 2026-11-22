/**
 * Reachable-space search. Pure: no Foundry globals, so it runs under Node for
 * the checks in tools/check.mjs.
 *
 * It is Dijkstra over grid offsets. The one subtlety is diagonals. Under the
 * alternating rules (5-10-5) what a diagonal costs depends on how many came
 * before it, so two routes to the same space can arrive with different
 * "next diagonal" prices. The search therefore tracks (space, diagonal parity)
 * as its state and reports each space's cheapest arrival.
 */

/**
 * Build the function that prices one step between adjacent offsets, in grid
 * spaces, before terrain.
 * @param {object} grid
 * @param {boolean} grid.isSquare
 * @param {number} grid.diagonals            A CONST.GRID_DIAGONALS value
 * @param {Record<string, number>} DIAGONALS CONST.GRID_DIAGONALS
 * @returns {(di: number, dj: number, parity: number) => {units: number, parity: number}}
 */
export function makeStepMetric({ isSquare, diagonals }, DIAGONALS) {
  // Hex neighbours are all one space apart; "diagonals" only exist in 3D there.
  if (!isSquare) return (_di, _dj, parity) => ({ units: 1, parity });

  let diagonal;
  switch (diagonals) {
    case DIAGONALS.EXACT: diagonal = () => Math.SQRT2; break;
    case DIAGONALS.APPROXIMATE: diagonal = () => 1.5; break;
    case DIAGONALS.RECTILINEAR: diagonal = () => 2; break;
    case DIAGONALS.ALTERNATING_1: diagonal = (parity) => (parity === 0 ? 1 : 2); break;
    case DIAGONALS.ALTERNATING_2: diagonal = (parity) => (parity === 0 ? 2 : 1); break;
    case DIAGONALS.ILLEGAL: diagonal = () => Infinity; break;
    default: diagonal = () => 1; // EQUIDISTANT
  }
  const alternating = (diagonals === DIAGONALS.ALTERNATING_1) || (diagonals === DIAGONALS.ALTERNATING_2);

  return (di, dj, parity) => {
    if ((di === 0) || (dj === 0)) return { units: 1, parity };
    return { units: diagonal(parity), parity: alternating ? 1 - parity : parity };
  };
}

/** Minimal binary min-heap on `cost`. */
class Heap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  push(item) {
    const items = this.#items;
    let index = items.push(item) - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].cost <= item.cost) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    const length = items.length;
    if (length > 0) {
      let index = 0;
      for (;;) {
        let child = (index << 1) + 1;
        if (child >= length) break;
        if ((child + 1 < length) && (items[child + 1].cost < items[child].cost)) child++;
        if (items[child].cost >= last.cost) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
    }
    return top;
  }
}

/** How many spaces to settle between yields. */
const YIELD_EVERY = 48;

/**
 * Explore outward from `start`, yielding periodically so a caller can spread
 * a large search across frames. Each yield hands back the spaces settled so
 * far; because the search expands in order of cost, those are already final
 * and can be drawn while the rest is still being worked out. Drive it to
 * completion with `runToEnd` when none of that matters.
 *
 * @param {object} config
 * @param {{i: number, j: number}} config.start
 * @param {number} config.maxCost                  Budget, in the caller's units
 * @param {number} config.unit                     Cost of one plain step (grid distance)
 * @param {(offset: {i: number, j: number}) => {i: number, j: number}[]} config.neighbors
 * @param {(di: number, dj: number, parity: number) => {units: number, parity: number}} config.step
 * @param {(from: object, to: object) => number} config.edge
 *   Multiplier for moving between two adjacent spaces: 1 for open ground, more
 *   for difficult terrain, Infinity when a wall is in the way. Called at most
 *   once per directed pair.
 * @param {number} [config.startParity=0]
 * @returns {Generator<Map<string, {i: number, j: number, cost: number}>, Map<string, {i: number, j: number, cost: number}>>}
 *   Cheapest cost to each reachable space, keyed by "i,j".
 */
export function* explore({ start, maxCost, unit, neighbors, step, edge, startParity = 0 }) {
  const reached = new Map();
  const settled = new Set();
  const best = new Map();
  const edges = new Map();
  const heap = new Heap();
  const epsilon = unit * 1e-6;

  const first = { i: start.i, j: start.j, parity: startParity, cost: 0 };
  best.set(`${first.i},${first.j},${first.parity}`, 0);
  heap.push(first);

  let sinceYield = 0;
  while (heap.size) {
    const node = heap.pop();
    const cellKey = `${node.i},${node.j}`;
    const stateKey = `${cellKey},${node.parity}`;
    if (settled.has(stateKey)) continue;
    settled.add(stateKey);

    const known = reached.get(cellKey);
    if (!known || (node.cost < known.cost)) reached.set(cellKey, { i: node.i, j: node.j, cost: node.cost });

    for (const next of neighbors(node)) {
      const { units, parity } = step(next.i - node.i, next.j - node.j, node.parity);
      if (!Number.isFinite(units)) continue;
      const nextCell = `${next.i},${next.j}`;
      const nextState = `${nextCell},${parity}`;
      if (settled.has(nextState)) continue;

      const edgeKey = `${cellKey}>${nextCell}`;
      let factor = edges.get(edgeKey);
      if (factor === undefined) {
        factor = edge(node, next);
        edges.set(edgeKey, factor);
      }
      if (!Number.isFinite(factor)) continue;

      const cost = node.cost + (units * unit * factor);
      if (cost > maxCost + epsilon) continue;
      const previous = best.get(nextState);
      if ((previous !== undefined) && (previous <= cost)) continue;
      best.set(nextState, cost);
      heap.push({ i: next.i, j: next.j, parity, cost });
    }

    if (++sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      yield reached;
    }
  }
  return reached;
}

/**
 * Run a search synchronously.
 * @param {Parameters<typeof explore>[0]} config
 * @returns {Map<string, {i: number, j: number, cost: number}>}
 */
export function runToEnd(config) {
  const search = explore(config);
  for (;;) {
    const { done, value } = search.next();
    if (done) return value;
  }
}

/**
 * Find the cheapest route between two spaces (A*).
 *
 * The same rules as `explore` — the same step prices, the same per-edge
 * multiplier, the same diagonal bookkeeping — but aimed at one destination,
 * so it looks at far fewer spaces. Yields periodically for the same reason.
 *
 * @param {object} config
 * @param {{i: number, j: number}} config.start
 * @param {{i: number, j: number}} config.goal
 * @param {number} config.unit                     Cost of one plain step
 * @param {number} config.maxCost                  Give up on routes dearer than this
 * @param {number} [config.maxNodes=6000]          Give up after settling this many states
 * @param {(offset: object) => object[]} config.neighbors
 * @param {(di: number, dj: number, parity: number) => {units: number, parity: number}} config.step
 * @param {(from: object, to: object) => number} config.edge
 * @param {(offset: object) => number} [config.heuristic]
 *   A lower bound on the number of plain steps left to the goal. It must
 *   never overestimate, or the route found may not be the cheapest.
 * @param {number} [config.startParity=0]
 * @returns {Generator<void, {cells: {i: number, j: number}[], cost: number}|null>}
 *   The spaces along the route, start and goal included, or null if there is
 *   no route within the limits.
 */
export function* findRoute({
  start, goal, unit, maxCost, maxNodes = 6000, neighbors, step, edge, heuristic = () => 0, startParity = 0,
}) {
  const goalKey = `${goal.i},${goal.j}`;
  const settled = new Set();
  const best = new Map();
  const edges = new Map();
  const heap = new Heap();
  const epsilon = unit * 1e-6;

  // In the heap `cost` is the priority (spent so far plus the least it could
  // still take); `spent` is the true cost of getting here.
  heap.push({ i: start.i, j: start.j, parity: startParity, spent: 0, cost: heuristic(start) * unit, parent: null });
  best.set(`${start.i},${start.j},${startParity}`, 0);

  let sinceYield = 0;
  while (heap.size) {
    const node = heap.pop();
    const cellKey = `${node.i},${node.j}`;
    const stateKey = `${cellKey},${node.parity}`;
    if (settled.has(stateKey)) continue;
    settled.add(stateKey);

    if (cellKey === goalKey) {
      const cells = [];
      for (let at = node; at; at = at.parent) cells.push({ i: at.i, j: at.j });
      return { cells: cells.reverse(), cost: node.spent };
    }
    if (settled.size > maxNodes) return null;

    for (const next of neighbors(node)) {
      const { units, parity } = step(next.i - node.i, next.j - node.j, node.parity);
      if (!Number.isFinite(units)) continue;
      const nextCell = `${next.i},${next.j}`;
      const nextState = `${nextCell},${parity}`;
      if (settled.has(nextState)) continue;

      const edgeKey = `${cellKey}>${nextCell}`;
      let factor = edges.get(edgeKey);
      if (factor === undefined) {
        factor = edge(node, next);
        edges.set(edgeKey, factor);
      }
      if (!Number.isFinite(factor)) continue;

      const spent = node.spent + (units * unit * factor);
      if (spent > maxCost + epsilon) continue;
      const previous = best.get(nextState);
      if ((previous !== undefined) && (previous <= spent)) continue;
      best.set(nextState, spent);
      heap.push({ i: next.i, j: next.j, parity, spent, cost: spent + (heuristic(next) * unit), parent: node });
    }

    if (++sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      yield;
    }
  }
  return null;
}

/**
 * Run a route search synchronously.
 * @param {Parameters<typeof findRoute>[0]} config
 */
export function runRoute(config) {
  const search = findRoute(config);
  for (;;) {
    const { done, value } = search.next();
    if (done) return value;
  }
}

/**
 * The spaces where a route changes direction, not counting its two ends.
 * Between consecutive turning points the route is a straight run.
 * @param {{i: number, j: number}[]} cells
 * @param {(from: object, to: object) => string} [direction]
 *   Names the direction of a step. Defaults to the change in offset, which is
 *   right for square grids; hex grids need a geometric answer, because the
 *   same direction changes offsets differently on odd and even rows.
 * @returns {{i: number, j: number}[]}
 */
export function turningPoints(cells, direction = (a, b) => `${b.i - a.i},${b.j - a.j}`) {
  const turns = [];
  for (let n = 1; n < cells.length - 1; n++) {
    if (direction(cells[n - 1], cells[n]) !== direction(cells[n], cells[n + 1])) turns.push(cells[n]);
  }
  return turns;
}

/**
 * Add up a planned route: what it costs and how many diagonal steps it takes.
 *
 * Each waypoint after the first carries the cost of the step that reached it,
 * as core measured it. A step core could not price makes the whole route
 * unaffordable.
 * @param {{cost?: number}[]} path                    Waypoints, origin first
 * @param {object} how
 * @param {(waypoint: object) => {i: number, j: number}} how.toOffset
 * @param {(waypoint: object) => boolean} [how.measured]  Does the step to this
 *   waypoint count as travel? Teleports and displacements do not.
 * @param {boolean} [how.square=true]                 Diagonals only exist on square grids
 * @returns {{cost: number, diagonals: number}}
 */
export function summarisePath(path, { toOffset, measured = () => true, square = true }) {
  let cost = 0;
  let diagonals = 0;
  let previous = null;
  for (let n = 0; n < path.length; n++) {
    const waypoint = path[n];
    const offset = toOffset(waypoint);
    if (n > 0) {
      cost += Number.isFinite(waypoint.cost) ? waypoint.cost : Infinity;
      if (square && measured(waypoint)) {
        diagonals += Math.min(Math.abs(offset.i - previous.i), Math.abs(offset.j - previous.j));
      }
    }
    previous = offset;
  }
  return { cost, diagonals };
}

/**
 * Find the edges on the outside of a set of polygons that tile the plane.
 * An edge shared by two polygons in the set is interior; one that appears
 * once is boundary. Works for squares and hexes alike.
 * @param {Iterable<{x: number, y: number}[]>} polygons
 * @returns {[{x: number, y: number}, {x: number, y: number}][]}
 */
export function boundaryEdges(polygons) {
  const seen = new Map();
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  for (const vertices of polygons) {
    for (let n = 0; n < vertices.length; n++) {
      const a = vertices[n];
      const b = vertices[(n + 1) % vertices.length];
      const ka = key(a);
      const kb = key(b);
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(edgeKey)) seen.set(edgeKey, null);
      else seen.set(edgeKey, [a, b]);
    }
  }
  const edges = [];
  for (const edge of seen.values()) if (edge) edges.push(edge);
  return edges;
}
