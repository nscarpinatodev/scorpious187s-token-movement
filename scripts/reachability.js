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

/** The direction of a step on a square grid: how the offset changes. */
const offsetDirection = (a, b) => `${b.i - a.i},${b.j - a.j}`;

/** What a step and a turn weigh when choosing between routes of equal cost, in plain steps. */
const STEP_SLIVER = 1e-4;
const TURN_SLIVER = 1e-5;

/**
 * Find the cheapest route between two spaces (A*).
 *
 * The same rules as `explore` — the same step prices, the same per-edge
 * multiplier, the same diagonal bookkeeping — but aimed at one destination,
 * so it looks at far fewer spaces. Yields periodically for the same reason.
 *
 * Under the alternating diagonal rules many routes cost the same: two
 * diagonals are 15 ft, and so is a diagonal, a step sideways and a step
 * back. Of routes that cost the same the one with fewer steps is taken, and
 * of those the one with fewer turns, so a route does not wander when it has
 * no reason to. That is done by pricing each step and each turn at a sliver
 * of a plain step, far too little to outweigh any real difference in cost.
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
 * @param {(from: object, to: object) => string} [config.direction]
 *   Names the direction of a step, to tell a turn from a straight run. The
 *   default suits square grids; see `turningPoints`.
 * @returns {Generator<void, {cells: {i: number, j: number}[], cost: number}|null>}
 *   The spaces along the route, start and goal included, or null if there is
 *   no route within the limits.
 */
export function* findRoute({
  start, goal, unit, maxCost, maxNodes = 6000, neighbors, step, edge, heuristic = () => 0, startParity = 0,
  direction = offsetDirection,
}) {
  const goalKey = `${goal.i},${goal.j}`;
  const settled = new Set();
  const best = new Map();
  const edges = new Map();
  const heap = new Heap();
  const epsilon = unit * 1e-6;
  const perStep = unit * STEP_SLIVER;
  const perTurn = unit * TURN_SLIVER;

  // In the heap `cost` is the priority (the score so far plus the least it
  // could still take); `spent` is the true cost of getting here, and `score`
  // is that plus the slivers that settle ties.
  heap.push({
    i: start.i, j: start.j, parity: startParity, spent: 0, score: 0, cost: heuristic(start) * unit, parent: null,
  });
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
      const parent = node.parent;
      const turned = !!parent && (direction(parent, node) !== direction(node, next));
      const score = node.score + (units * unit * factor) + perStep + (turned ? perTurn : 0);
      const previous = best.get(nextState);
      if ((previous !== undefined) && (previous <= score)) continue;
      best.set(nextState, score);
      heap.push({
        i: next.i, j: next.j, parity, spent, score, cost: score + (heuristic(next) * unit), parent: node,
      });
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
export function turningPoints(cells, direction = offsetDirection) {
  const turns = [];
  for (let n = 1; n < cells.length - 1; n++) {
    if (direction(cells[n - 1], cells[n]) !== direction(cells[n], cells[n + 1])) turns.push(cells[n]);
  }
  return turns;
}

/**
 * Price a route that is already laid out space by space, by the same rules
 * the searches use, so it can be compared with a route `findRoute` returns.
 * @param {{i: number, j: number}[]} cells            Adjacent spaces, start first
 * @param {object} how
 * @param {number} how.unit                            Cost of one plain step
 * @param {(di: number, dj: number, parity: number) => {units: number, parity: number}} how.step
 * @param {(from: object, to: object) => number} how.edge
 * @param {number} [how.startParity=0]
 * @returns {{cost: number, open: number, diagonals: number}} `cost` as it
 *   stands (Infinity if a step is not allowed), `open` what the same steps
 *   would cost over open ground, and how many of them are diagonal.
 */
export function priceCells(cells, { unit, step, edge, startParity = 0 }) {
  let cost = 0;
  let open = 0;
  let diagonals = 0;
  let parity = startParity;
  for (let n = 1; n < cells.length; n++) {
    const from = cells[n - 1];
    const to = cells[n];
    const di = to.i - from.i;
    const dj = to.j - from.j;
    if ((di === 0) && (dj === 0)) continue;
    if ((di !== 0) && (dj !== 0)) diagonals++;
    const priced = step(di, dj, parity);
    parity = priced.parity;
    open += priced.units * unit;
    cost += priced.units * unit * edge(from, to);
  }
  return { cost, open, diagonals };
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
 * Are two waypoints the same place? Only what a dropped waypoint is sure to
 * carry is compared, and a pixel either way is let pass: a route that cannot
 * get to where the pointer is gets stopped by core a pixel short of the last
 * waypoint it reached.
 */
export function samePlace(a, b) {
  if ((Math.abs(a.x - b.x) > 1.5) || (Math.abs(a.y - b.y) > 1.5)) return false;
  if (Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) > 1e-6) return false;
  return (a.level == null) || (b.level == null) || (a.level === b.level);
}

/**
 * How far along a planned route the fixed part goes: the index, in the found
 * path, of the last waypoint the user dropped that the route gets to. 0 when
 * nothing is fixed and the whole route is still the pointer's to change.
 * @param {object[]} path         The found path
 * @param {object[]|null} dropped The dropped waypoints, if core's drag data could be read
 * @param {boolean} arrived       Does the found path get all the way to the pointer?
 */
export function fixedIndex(path, dropped, arrived) {
  let index = 0;
  if (dropped) {
    // Core drops a waypoint that repeats the one before it, so the same is done here.
    let previous = path[0];
    let n = 1;
    for (const waypoint of dropped) {
      if (samePlace(waypoint, previous)) continue;
      while ((n < path.length) && !samePlace(path[n], waypoint)) n++;
      if (n >= path.length) break;
      index = n;
      previous = waypoint;
    }
    return index;
  }
  // Without the drag data, go by how core marks the path: dropped waypoints
  // and the pointer's are the ones marked as both explicit and a checkpoint.
  const marked = [];
  for (let n = 1; n < path.length; n++) {
    const waypoint = path[n];
    if (waypoint.explicit && waypoint.checkpoint && !waypoint.intermediate) marked.push(n);
  }
  if (arrived) marked.pop();
  return marked.at(-1) ?? 0;
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

/**
 * The outline of a set of polygons that tile the plane, as closed loops.
 *
 * The same edges `boundaryEdges` finds, joined end to end. A loop can be
 * stroked as one continuous line with proper joins, where separate edges
 * would each end in a cap and overlap at every corner.
 * @param {Iterable<{x: number, y: number}[]>} polygons
 * @returns {number[][]} Each loop as flat [x0, y0, x1, y1, …]; closed by
 *   joining the last point back to the first.
 */
export function boundaryLoops(polygons) {
  const edges = boundaryEdges(polygons);
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

  // Which edges meet at each point, and by which end.
  const meeting = new Map();
  edges.forEach((edge, index) => {
    edge.forEach((point, end) => {
      const k = key(point);
      if (!meeting.has(k)) meeting.set(k, []);
      meeting.get(k).push({ index, end });
    });
  });

  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue;
    const loop = [];
    let index = first;
    let towards = 1; // travelling from the edge's first point to its second
    for (;;) {
      used[index] = true;
      const from = edges[index][1 - towards];
      const to = edges[index][towards];
      loop.push(from.x, from.y);
      const next = meeting.get(key(to)).find((candidate) => !used[candidate.index]);
      if (!next) break;
      index = next.index;
      towards = 1 - next.end; // we arrive at one end and leave by the other
    }
    loops.push(loop);
  }
  return loops;
}
