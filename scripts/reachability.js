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
