/**
 * Pre-flight checks. No dependencies; run with:
 *
 *   node tools/check.mjs
 *   node tools/check.mjs "C:/Program Files/Foundry Virtual Tabletop/resources/app"
 *
 * Two kinds of check:
 *   1. The package is well-formed — manifest parses, every file it names
 *      exists, every setting has its strings, every script parses.
 *   2. The reachability search agrees with Foundry. When a v14 install is
 *      found, its real grid classes are imported and every space within range
 *      is compared against `grid.measurePath`, for each diagonal rule and each
 *      hex layout. Skipped (not failed) when no install is present, as on CI.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const close = (a, b) => Math.abs(a - b) < 1e-6;

/* ---------------- 1. Package ---------------- */

const manifest = JSON.parse(readFileSync(join(root, 'module.json'), 'utf8'));

check('manifest has no BOM', () => {
  assert(readFileSync(join(root, 'module.json'))[0] !== 0xef, 'module.json starts with a UTF-8 BOM');
});
check('manifest files exist', () => {
  const named = [
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []).map((s) => s.src ?? s),
    ...(manifest.languages ?? []).map((l) => l.path),
  ];
  for (const file of named) assert(existsSync(join(root, file)), `missing ${file}`);
});
check('download URL matches version', () => {
  assert(manifest.download.includes(`/v${manifest.version}/`), `download does not point at v${manifest.version}`);
});

const scripts = readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.js'));
for (const file of scripts) {
  check(`scripts/${file} parses`, () => {
    execFileSync(process.execPath, ['--check', join(root, 'scripts', file)], { stdio: 'pipe' });
  });
}

const { SETTINGS, BUILT_IN_STEP_SOUNDS, MODULE_ID } = await import(pathToFileURL(join(root, 'scripts/constants.js')));
const lang = JSON.parse(readFileSync(join(root, 'lang/en.json'), 'utf8'));

check('every setting has a name and hint', () => {
  for (const key of Object.values(SETTINGS)) {
    const entry = lang.S187MOVE.Settings[key];
    assert(entry?.Name && entry?.Hint, `lang/en.json lacks Settings.${key}.Name/Hint`);
  }
});
check('every setting is registered', () => {
  const source = readFileSync(join(root, 'scripts/settings.js'), 'utf8');
  for (const key of Object.keys(SETTINGS)) {
    assert(source.includes(`register(SETTINGS.${key},`), `settings.js never registers ${key}`);
  }
});
check('built-in sounds exist', () => {
  for (const src of BUILT_IN_STEP_SOUNDS) {
    const relative = src.replace(`modules/${MODULE_ID}/`, '');
    assert(existsSync(join(root, relative)), `missing ${relative} (run node tools/gen-sounds.mjs)`);
  }
});

/* ---------------- 2. Speed presets ---------------- */

const { resolveSpeed, readNumber, parseBands, SYSTEM_PRESETS } = await import(pathToFileURL(join(root, 'scripts/systems.js')));

check('readNumber unwraps values', () => {
  assert(readNumber(30) === 30, 'plain number');
  assert(readNumber('25') === 25, 'numeric string');
  assert(readNumber({ value: 40 }) === 40, '{value}');
  assert(readNumber({ total: 20 }) === 20, '{total}');
  assert(readNumber(0) === null, 'zero is not a speed');
  assert(readNumber(null) === null, 'null');
  assert(readNumber({}) === null, 'empty object');
});
check('dnd5e 6.x and 5.x layouts', () => {
  const v6 = { system: { attributes: { movement: { speeds: { walk: 30, fly: 60, swim: 0 } } } } };
  const v5 = { system: { attributes: { movement: { walk: 25, fly: 0 } } } };
  assert(resolveSpeed(v6, 'walk', SYSTEM_PRESETS.dnd5e).value === 30, 'v6 walk');
  assert(resolveSpeed(v6, 'fly', SYSTEM_PRESETS.dnd5e).value === 60, 'v6 fly');
  assert(resolveSpeed(v6, 'swim', SYSTEM_PRESETS.dnd5e).value === 30, 'no swim speed falls back to walk');
  assert(resolveSpeed(v5, 'walk', SYSTEM_PRESETS.dnd5e).value === 25, 'v5 walk');
});
check('pf2e speeds and aliases', () => {
  const actor = { system: { movement: { speeds: { land: { value: 25 }, fly: { value: 40 }, swim: null } } } };
  assert(resolveSpeed(actor, 'walk', SYSTEM_PRESETS.pf2e).value === 25, 'walk reads land');
  assert(resolveSpeed(actor, 'fly', SYSTEM_PRESETS.pf2e).value === 40, 'fly');
  assert(resolveSpeed(actor, 'swim', SYSTEM_PRESETS.pf2e).value === 25, 'null swim falls back to land');
  const legacy = { system: { attributes: { speed: { total: 30 } } } };
  assert(resolveSpeed(legacy, 'walk', SYSTEM_PRESETS.pf2e).value === 30, 'legacy total');
});
check('range bands parse', () => {
  assert(parseBands('') === null, 'blank means use the default');
  assert(parseBands('abc') === null, 'junk means use the default');
  assert(JSON.stringify(parseBands('1, 2, 3')) === '[1,2,3]', 'comma list');
  assert(JSON.stringify(parseBands('2 1')) === '[1,2]', 'sorted');
  assert(JSON.stringify(parseBands('1,1,0,-2,1.5')) === '[1,1.5]', 'deduplicated, positive only');
  assert(parseBands('1,2,3,4,5,6').length === 4, 'capped at four');
});
check('unknown actor or preset resolves to null', () => {
  assert(resolveSpeed(null, 'walk', SYSTEM_PRESETS.dnd5e) === null, 'no actor');
  assert(resolveSpeed({ system: {} }, 'walk', SYSTEM_PRESETS.dnd5e) === null, 'no data');
  assert(resolveSpeed({ system: {} }, 'walk', null) === null, 'no preset');
});

/* ---------------- 3. Reachability ---------------- */

const { runToEnd, makeStepMetric, boundaryEdges, boundaryLoops, summarisePath, runRoute, turningPoints } = await import(pathToFileURL(join(root, 'scripts/reachability.js')));

check('a planned route is summed from its waypoints', () => {
  const at = (i, j, cost) => ({ i, j, cost });
  const toOffset = (w) => ({ i: w.i, j: w.j });
  // two straight steps, then two diagonals priced 5 and 10
  const route = [at(0, 0, 0), at(0, 1, 5), at(0, 2, 5), at(1, 3, 5), at(2, 4, 10)];
  const summary = summarisePath(route, { toOffset });
  assert(summary.cost === 25, `cost ${summary.cost}`);
  assert(summary.diagonals === 2, `diagonals ${summary.diagonals}`);
  assert(summarisePath([at(0, 0, 0)], { toOffset }).cost === 0, 'a route of one waypoint is free');
  assert(summarisePath(route, { toOffset, square: false }).diagonals === 0, 'no diagonals on hex');
  assert(summarisePath([at(0, 0, 0), at(3, 3, 0)], { toOffset, measured: () => false }).diagonals === 0,
    'a teleport is not three diagonals');
  assert(summarisePath([at(0, 0, 0), at(0, 1, Infinity)], { toOffset }).cost === Infinity, 'unpriceable step');
  assert(summarisePath([at(0, 0, 0), at(0, 1, undefined)], { toOffset }).cost === Infinity, 'missing cost');
});

check('turning points are where a route changes direction', () => {
  const c = (i, j) => ({ i, j });
  const key = (cells) => cells.map((cell) => `${cell.i},${cell.j}`).join(' ');
  assert(key(turningPoints([c(0, 0), c(0, 1), c(0, 2), c(0, 3)])) === '', 'a straight run has none');
  assert(key(turningPoints([c(0, 0), c(0, 1), c(0, 2), c(1, 3), c(2, 4), c(2, 5)])) === '0,2 2,4', 'two turns');
  assert(key(turningPoints([c(0, 0), c(1, 1)])) === '', 'a single step has none');
  assert(key(turningPoints([c(0, 0)])) === '', 'nor does a single space');
});

const { roundedInsetPolygon, mixColor, cumulativeLengths, advanceAlong, shadeOf, SHADE_COUNT, bandAt } = await import(pathToFileURL(join(root, 'scripts/shapes.js')));

check('the outline joins up into closed loops', () => {
  const square = (x, y) => [{ x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 }];
  const one = boundaryLoops([square(0, 0)]);
  assert((one.length === 1) && (one[0].length === 8), 'one square is one loop of four points');
  const block = boundaryLoops([square(0, 0), square(100, 0), square(0, 100), square(100, 100)]);
  assert((block.length === 1) && (block[0].length === 16), 'a 2x2 block is one loop of eight points');
  assert(boundaryLoops([square(0, 0), square(300, 0)]).length === 2, 'two separate squares are two loops');
  const ring = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((i !== 1) || (j !== 1)) ring.push(square(i * 100, j * 100));
  assert(boundaryLoops(ring).length === 2, 'a ring has an outside and an inside');
  const points = boundaryLoops(ring).reduce((sum, loop) => sum + (loop.length / 2), 0);
  assert(points === boundaryEdges(ring).length, 'every outline edge is used exactly once');
});

check('a tile is a space shrunk and rounded', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const plain = roundedInsetPolygon(square, { inset: 5 });
  assert(plain.join(',') === '5,5,95,5,95,95,5,95', `inset square: ${plain.join(',')}`);
  const rounded = roundedInsetPolygon(square, { inset: 5, radius: 9, segments: 3 });
  assert(rounded.length === 4 * 4 * 2, 'four corners of four points each');
  for (let n = 0; n < rounded.length; n += 2) {
    const x = rounded[n];
    const y = rounded[n + 1];
    assert((x >= 5 - 1e-9) && (x <= 95 + 1e-9) && (y >= 5 - 1e-9) && (y <= 95 + 1e-9), 'stays inside the gap');
    const corner = [[5, 5], [95, 5], [95, 95], [5, 95]].some(([cx, cy]) => (Math.abs(x - cx) < 1e-6) && (Math.abs(y - cy) < 1e-6));
    assert(!corner, 'no sharp corner survives');
  }
  // A hexagon across its flats: every side moves in by the same amount.
  const hex = Array.from({ length: 6 }, (_, k) => ({ x: 100 * Math.cos((Math.PI / 3) * k), y: 100 * Math.sin((Math.PI / 3) * k) }));
  const small = roundedInsetPolygon(hex, { inset: 10 });
  const apothem = 100 * Math.cos(Math.PI / 6);
  assert(close(Math.hypot(small[0], small[1]), 100 * ((apothem - 10) / apothem)), 'hexagon shrinks by its apothem');
});

check('colours blend channel by channel', () => {
  assert(mixColor(0x000000, 0xffffff, 0.5) === 0x808080, 'halfway to white');
  assert(mixColor(0x3ddc84, 0xffffff, 0) === 0x3ddc84, 'none');
  assert(mixColor(0x3ddc84, 0xffffff, 1) === 0xffffff, 'all');
  assert(mixColor(0xff0000, 0x0000ff, 0.25) === 0xbf0040, 'a quarter of the way from red to blue');
});

check('bands are shades of one colour', () => {
  const base = 0x2f8fd0;
  const channels = (color) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  assert(shadeOf(base, 0).color === base, 'the nearest band is the colour itself');
  assert(shadeOf(base, 0).fade > 1, 'and bolder than the opacity setting on its own');
  let previous = shadeOf(base, 0);
  for (let index = 1; index < SHADE_COUNT; index++) {
    const shade = shadeOf(base, index);
    const [r, g, b] = channels(shade.color);
    const [pr, pg, pb] = channels(previous.color);
    assert((r < pr) && (g < pg) && (b < pb), `band ${index} is darker than the one before`);
    assert(shade.fade < previous.fade, `band ${index} is fainter than the one before`);
    // Darker, not a different colour: the order of the channels is unchanged.
    assert((b >= g) && (g >= r), `band ${index} keeps its hue`);
    previous = shade;
  }
  // The second band is 20% of the way to black.
  assert(shadeOf(0xc86432, 1).color === 0xa05028, `20% darker: ${shadeOf(0xc86432, 1).color.toString(16)}`);
  assert(shadeOf(base, SHADE_COUNT + 4).color === shadeOf(base, SHADE_COUNT - 1).color, 'bands beyond the last repeat it');
});

check('a step is in the band its distance falls in', () => {
  const bands = [{ distance: 30, name: 'move' }, { distance: 60, name: 'dash' }];
  assert(bandAt(bands, 0).name === 'move', 'where the token stands');
  assert(bandAt(bands, 30).name === 'move', 'the last step of the move is still the move');
  assert(bandAt(bands, 35).name === 'dash', 'one step further needs the dash');
  assert(bandAt(bands, 60).name === 'dash', 'the last step of the dash');
  assert(bandAt(bands, 75).name === 'dash', 'past every band is drawn as the last');
  assert(bandAt([], 10) === null, 'no bands');
  assert(bandAt([{ distance: Infinity, name: 'any' }], 1e9).name === 'any', 'a band without end');
});

check('three-action systems have their own band colours', () => {
  for (const id of ['pf2e', 'sf2e']) {
    const preset = SYSTEM_PRESETS[id];
    assert(preset.colors?.length === preset.bands.length, `${id}: one colour per Stride`);
    const [green, yellow, red] = preset.colors.map((color) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]);
    assert((green[1] > green[0]) && (green[1] > green[2]), `${id}: first Stride is green`);
    assert((yellow[0] > 200) && (yellow[1] > 180) && (yellow[2] < 120), `${id}: second Stride is yellow`);
    assert((red[0] > red[1] * 2) && (red[0] > red[2] * 2), `${id}: third Stride is red`);
  }
  assert(!SYSTEM_PRESETS.dnd5e.colors, 'D&D is left to the HUD');
});

check('a walking token is followed along its route', () => {
  const P = (x, y) => ({ x, y });
  // Along, then up: an L.
  const bend = [P(0, 0), P(100, 0), P(200, 0), P(200, 100)];
  const lengths = cumulativeLengths(bend);
  assert(lengths.join(',') === '0,100,200,300', `lengths: ${lengths.join(',')}`);
  assert(close(advanceAlong(bend, lengths, P(50, 0), 0, 35), 50), 'half way along the first step');
  assert(close(advanceAlong(bend, lengths, P(200, 20), 190, 35), 220), 'round the corner');
  assert(close(advanceAlong(bend, lengths, P(60, 0), 150, 35), 150), 'never goes backwards');
  assert(close(advanceAlong(bend, lengths, P(200, 100), 0, 35), 300), 'a long frame still gets to the end');

  // Out and straight back over the same spaces.
  const back = [P(0, 0), P(100, 0), P(200, 0), P(100, 0), P(0, 0)];
  const there = cumulativeLengths(back);
  let far = 0;
  const seen = [];
  for (const x of [0, 40, 80, 120, 160, 200, 160, 120, 80, 40, 0]) {
    far = advanceAlong(back, there, P(x, 0), far, 35);
    seen.push(Math.round(far));
  }
  assert(seen.join(',') === '0,40,80,120,160,200,240,280,320,360,400', `out and back: ${seen.join(',')}`);

  // A route that crosses itself: the second pass is not mistaken for the first.
  const cross = [P(0, 0), P(200, 0), P(200, 200), P(100, 200), P(100, -100)];
  const crossing = cumulativeLengths(cross);
  assert(close(advanceAlong(cross, crossing, P(100, 0), 60, 35), 100), 'first time over the crossing');
  assert(close(advanceAlong(cross, crossing, P(100, 0), 520, 35), 700), 'second time over the crossing');
});

check('boundaryEdges drops shared edges', () => {
  const square = (x, y) => [{ x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 }];
  assert(boundaryEdges([square(0, 0)]).length === 4, 'one square has four edges');
  assert(boundaryEdges([square(0, 0), square(100, 0)]).length === 6, 'two adjacent squares share one');
  assert(boundaryEdges([square(0, 0), square(100, 0), square(0, 100), square(100, 100)]).length === 8, '2x2 block');
});

function findFoundry() {
  const candidates = [
    process.argv[2],
    process.env.FOUNDRY_APP,
    'C:/Program Files/Foundry Virtual Tabletop/resources/app',
    '/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app',
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, 'common/grid/square.mjs'))) ?? null;
}

const foundry = findFoundry();
if (!foundry) {
  console.log('note: no Foundry install found; skipping grid agreement checks');
} else {
  // The grid classes lean on Foundry's primitive extensions (Math.clamp etc.).
  const primitives = join(foundry, 'common/primitives/_module.mjs');
  if (existsSync(primitives)) await import(pathToFileURL(primitives));
  const CONSTANTS = await import(pathToFileURL(join(foundry, 'common/constants.mjs')));
  const { default: SquareGrid } = await import(pathToFileURL(join(foundry, 'common/grid/square.mjs')));
  const { default: HexagonalGrid } = await import(pathToFileURL(join(foundry, 'common/grid/hexagonal.mjs')));
  const DIAGONALS = CONSTANTS.GRID_DIAGONALS;

  const searchOn = (grid, start, maxCost, edge = () => 1) => runToEnd({
    start,
    maxCost,
    unit: grid.distance,
    neighbors: (offset) => grid.getAdjacentOffsets(offset),
    step: makeStepMetric(grid, DIAGONALS),
    edge,
  });

  /** Compare every space in a window against grid.measurePath. */
  function agree(grid, start, radius, maxCost) {
    const reached = searchOn(grid, start, maxCost);
    const from = grid.getCenterPoint(start);
    let compared = 0;
    for (let i = start.i - radius; i <= start.i + radius; i++) {
      for (let j = start.j - radius; j <= start.j + radius; j++) {
        const expected = grid.measurePath([from, grid.getCenterPoint({ i, j })]).distance;
        const found = reached.get(`${i},${j}`);
        if (expected <= maxCost + 1e-6) {
          assert(found, `(${i},${j}) should be reachable at ${expected}`);
          assert(close(found.cost, expected), `(${i},${j}) cost ${found.cost}, Foundry says ${expected}`);
          compared++;
        } else {
          assert(!found, `(${i},${j}) is ${expected} away but was reached at ${found?.cost}`);
        }
      }
    }
    assert(compared > 20, `only compared ${compared} spaces`);
  }

  for (const [name, rule] of Object.entries(DIAGONALS)) {
    check(`square grid, diagonals ${name}, agrees with measurePath`, () => {
      const grid = new SquareGrid({ size: 100, distance: 5, diagonals: rule });
      agree(grid, { i: 20, j: 20 }, 9, 30);
      agree(grid, { i: 20, j: 20 }, 9, 35);
    });
  }

  for (const columns of [false, true]) {
    for (const even of [false, true]) {
      check(`hex grid (${columns ? 'columns' : 'rows'}, ${even ? 'even' : 'odd'}) agrees with measurePath`, () => {
        const grid = new HexagonalGrid({ size: 100, distance: 5, columns, even });
        agree(grid, { i: 20, j: 20 }, 8, 30);
        agree(grid, { i: 21, j: 21 }, 8, 30);
      });
    }
  }

  check('a wall forces the long way round', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.EQUIDISTANT });
    // A wall along the east edge of column 20, spanning rows 15-25.
    const wall = (from, to) => {
      const crosses = (Math.min(from.j, to.j) === 20) && (Math.max(from.j, to.j) === 21);
      const inSpan = [from.i, to.i].every((i) => (i >= 15) && (i <= 25));
      return crosses && inSpan ? Infinity : 1;
    };
    const open = searchOn(grid, { i: 20, j: 20 }, 60);
    const walled = searchOn(grid, { i: 20, j: 20 }, 60, wall);
    assert(close(open.get('20,21').cost, 5), 'adjacent space is one step without the wall');
    assert(walled.get('20,21').cost > 30, `expected a detour, got ${walled.get('20,21').cost}`);
    assert(!searchOn(grid, { i: 20, j: 20 }, 20, wall).has('20,21'), 'out of budget behind the wall');
  });

  const routeOn = (grid, start, goal, extra = {}) => runRoute({
    start,
    goal,
    unit: grid.distance,
    maxCost: 400,
    neighbors: (offset) => grid.getAdjacentOffsets(offset),
    step: makeStepMetric(grid, DIAGONALS),
    edge: () => 1,
    heuristic: (offset) => Math.max(Math.abs(offset.i - goal.i), Math.abs(offset.j - goal.j)),
    ...extra,
  });

  for (const [name, rule] of Object.entries(DIAGONALS)) {
    check(`route search, diagonals ${name}, costs what the range search says`, () => {
      const grid = new SquareGrid({ size: 100, distance: 5, diagonals: rule });
      const start = { i: 20, j: 20 };
      const reached = searchOn(grid, start, 60);
      const heuristic = rule === DIAGONALS.ILLEGAL
        ? (goal) => (offset) => Math.abs(offset.i - goal.i) + Math.abs(offset.j - goal.j)
        : (goal) => (offset) => Math.max(Math.abs(offset.i - goal.i), Math.abs(offset.j - goal.j));
      for (const goal of [{ i: 20, j: 26 }, { i: 25, j: 25 }, { i: 17, j: 28 }, { i: 12, j: 19 }]) {
        const route = routeOn(grid, start, goal, { heuristic: heuristic(goal) });
        const expected = reached.get(`${goal.i},${goal.j}`).cost;
        assert(route, `no route to ${goal.i},${goal.j}`);
        assert(close(route.cost, expected), `to ${goal.i},${goal.j}: route ${route.cost}, range ${expected}`);
        const first = route.cells[0];
        const last = route.cells.at(-1);
        assert((first.i === start.i) && (first.j === start.j) && (last.i === goal.i) && (last.j === goal.j),
          'route runs from start to goal');
        for (let n = 1; n < route.cells.length; n++) {
          assert(grid.testAdjacency(route.cells[n - 1], route.cells[n]), 'every step is to an adjacent space');
        }
      }
    });
  }

  check('a route goes round a wall and never through it', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.ALTERNATING_1 });
    // A wall along the east edge of column 20, spanning rows 15-25.
    const wall = (from, to) => {
      const crosses = (Math.min(from.j, to.j) === 20) && (Math.max(from.j, to.j) === 21);
      const inSpan = [from.i, to.i].every((i) => (i >= 15) && (i <= 25));
      return crosses && inSpan ? Infinity : 1;
    };
    const start = { i: 20, j: 20 };
    const goal = { i: 20, j: 21 };
    const route = routeOn(grid, start, goal, { edge: wall });
    const expected = searchOn(grid, start, 400, wall).get('20,21').cost;
    assert(route && close(route.cost, expected), `route ${route?.cost}, range search ${expected}`);
    assert(route.cells.length > 6, 'it is a detour');
    for (let n = 1; n < route.cells.length; n++) {
      assert(Number.isFinite(wall(route.cells[n - 1], route.cells[n])), 'no step crosses the wall');
    }
    assert(turningPoints(route.cells).length >= 2, 'a detour has corners');
  });

  check('a route that does not exist is given up on', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.EQUIDISTANT });
    // The goal is boxed in on every side.
    const boxed = (_from, to) => ((to.i === 30) && (to.j === 30) ? Infinity : 1);
    const bounded = (offset) => grid.getAdjacentOffsets(offset)
      .filter((next) => (next.i >= 0) && (next.i < 60) && (next.j >= 0) && (next.j < 60));
    assert(routeOn(grid, { i: 20, j: 20 }, { i: 30, j: 30 }, { edge: boxed, neighbors: bounded }) === null,
      'boxed-in goal');
    assert(routeOn(grid, { i: 20, j: 20 }, { i: 20, j: 50 }, { maxCost: 100 }) === null, 'dearer than the limit');
    assert(routeOn(grid, { i: 20, j: 20 }, { i: 20, j: 50 }, { maxNodes: 5 }) === null, 'too much searching');
  });

  check('hex route costs what the range search says', () => {
    for (const columns of [false, true]) {
      const grid = new HexagonalGrid({ size: 100, distance: 5, columns, even: false });
      const start = { i: 20, j: 20 };
      const reached = searchOn(grid, start, 60);
      for (const goal of [{ i: 20, j: 27 }, { i: 26, j: 23 }, { i: 15, j: 17 }]) {
        const target = grid.getCenterPoint(goal);
        const heuristic = (offset) => {
          const center = grid.getCenterPoint(offset);
          return Math.hypot(center.x - target.x, center.y - target.y) / grid.size;
        };
        const route = routeOn(grid, start, goal, { heuristic });
        const expected = reached.get(`${goal.i},${goal.j}`)?.cost;
        assert(route && (expected !== undefined) && close(route.cost, expected),
          `to ${goal.i},${goal.j}: route ${route?.cost}, range ${expected}`);
      }
    }
  });

  check('difficult terrain costs double', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.EQUIDISTANT });
    const mud = (_from, to) => (to.j >= 22 ? 2 : 1);
    const reached = searchOn(grid, { i: 20, j: 20 }, 30, mud);
    assert(close(reached.get('20,21').cost, 5), 'open ground');
    assert(close(reached.get('20,22').cost, 15), 'first muddy space');
    assert(close(reached.get('20,23').cost, 25), 'second muddy space');
    assert(!reached.has('20,24'), 'third muddy space is out of reach');
  });

  check('alternating diagonals carry on from diagonals already taken', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.ALTERNATING_1 });
    const config = {
      start: { i: 0, j: 0 },
      maxCost: 30,
      unit: grid.distance,
      neighbors: (offset) => grid.getAdjacentOffsets(offset),
      step: makeStepMetric(grid, DIAGONALS),
      edge: () => 1,
    };
    const fresh = runToEnd(config);
    const afterOne = runToEnd({ ...config, startParity: 1 });
    assert(close(fresh.get('1,1').cost, 5), 'first diagonal of the turn is 5');
    assert(close(afterOne.get('1,1').cost, 10), 'second diagonal of the turn is 10');
    assert(close(afterOne.get('2,2').cost, 15), 'then 5 again');
    assert(close(fresh.get('3,3').cost, 20) && close(afterOne.get('3,3').cost, 25),
      'three diagonals are 20 fresh and 25 after one already taken');
    // Foundry agrees: measure a path that already contains one diagonal.
    const c = (i, j) => grid.getCenterPoint({ i, j });
    const measured = grid.measurePath([c(-1, -1), c(0, 0), c(1, 1)]);
    assert(close(measured.waypoints[2].backward.distance, 10), 'measurePath prices the second diagonal at 10');
  });

  check('alternating diagonals track parity per route', () => {
    const grid = new SquareGrid({ size: 100, distance: 5, diagonals: DIAGONALS.ALTERNATING_1 });
    const reached = searchOn(grid, { i: 0, j: 0 }, 30);
    assert(close(reached.get('1,1').cost, 5), 'first diagonal is 5');
    assert(close(reached.get('2,2').cost, 15), 'second diagonal is 10');
    assert(close(reached.get('4,4').cost, 30), 'four diagonals are 30');
    assert(!reached.has('5,5'), 'five diagonals are 35');
  });
}

/* ---------------- Report ---------------- */

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log(`ok: ${passed} checks passed`);
