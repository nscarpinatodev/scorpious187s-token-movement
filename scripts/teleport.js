/**
 * Teleport: the GM, and only the GM, puts the selected tokens down where the
 * pointer is, with one key and no drag.
 *
 * It is for setting a scene: a token is made ready out in the padding round
 * the map, hidden or whatever else it needs, and then put where it belongs.
 * Nothing is walked, so nothing is measured, no wall is in the way, no
 * movement is spent and no route is shown to anyone. It is core's own
 * `displace` action, the one core uses for undo and for cut and paste, so
 * Ctrl+Z takes a teleport back like any other move.
 *
 * A group lands as a group. The middle of the selection goes to the pointer
 * and every token keeps its place round it, each on a space of its own.
 *
 * Nobody's view moves, the GM's included. To bring the players along, hold
 * the follow key (see follow.js) while teleporting, as with any other move.
 */

import { MODULE_ID } from './constants.js';
import { guarded, log } from './logger.js';
import { carrierOf } from './mounts.js';

const KEYBINDING = 'teleport';

/** How far out, in spaces, a token whose own space is taken looks for a free one. */
const SEARCH_RINGS = 6;

const centreOf = (box) => ({ x: box.x + (box.width / 2), y: box.y + (box.height / 2) });

/** Do two rectangles share more than an edge? */
function overlaps(a, b) {
  return (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1)
    && (Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1);
}

/**
 * Where each token of a group lands when the group is put down at a point.
 *
 * The middle of the group (the mean of the tokens' centres, as core's paste
 * counts it) goes to the point. The token nearest the middle is placed first
 * and snapped; how far that moved it is how far every other token moves. A
 * shift between two snapped positions of one token is a whole number of
 * spaces, so tokens that stood on the grid land on the grid in the same
 * formation, on square and hex grids alike.
 *
 * Tokens that did not stand on the grid are snapped one by one, and two of
 * them can come down on the same space. The one further from the middle then
 * takes the nearest space that is free. Tokens that overlapped where they
 * stood (a rider on its mount, a stack made on purpose) are left overlapping.
 *
 * Pure: no Foundry globals, so it can be checked without a canvas.
 *
 * @param {Array<{id: string, x: number, y: number, width: number, height: number}>} boxes
 *   Each token's top-left corner and size, in pixels.
 * @param {{x: number, y: number}} target   Where the middle of the group goes.
 * @param {object} [options]
 * @param {(box: object, position: {x: number, y: number}) => {x: number, y: number}} [options.snap]
 *   Snap a top-left position for this token. Leave out for no snapping.
 * @param {{x: number, y: number}} [options.step]   One space, in pixels, each way.
 * @param {(box: object, position: {x: number, y: number}) => {x: number, y: number}} [options.clamp]
 *   Keep a top-left position on the canvas.
 * @returns {Map<string, {x: number, y: number}>} Top-left corner by token id.
 */
export function planLandings(boxes, target, { snap = null, step = null, clamp = null } = {}) {
  const landings = new Map();
  if (!boxes.length) return landings;

  const origin = { x: 0, y: 0 };
  for (const box of boxes) {
    const centre = centreOf(box);
    origin.x += centre.x / boxes.length;
    origin.y += centre.y / boxes.length;
  }
  const fromMiddle = (box) => {
    const centre = centreOf(box);
    return Math.hypot(centre.x - origin.x, centre.y - origin.y);
  };
  // Nearest the middle first; Array#sort is stable, so ties keep the order given.
  const order = [...boxes].sort((a, b) => fromMiddle(a) - fromMiddle(b));

  const place = (box, position) => {
    const snapped = snap ? snap(box, position) : position;
    const rounded = { x: Math.round(snapped.x), y: Math.round(snapped.y) };
    return clamp ? clamp(box, rounded) : rounded;
  };

  const anchor = order[0];
  const landed = place(anchor, { x: anchor.x + (target.x - origin.x), y: anchor.y + (target.y - origin.y) });
  const shift = { x: landed.x - anchor.x, y: landed.y - anchor.y };

  // A group put down at the edge would have its outer tokens pushed back onto
  // the canvas one by one, on top of each other. Slide the whole group in
  // instead, by whole spaces so it stays on the grid. A group too wide for
  // the canvas cannot be slid; its tokens are kept on it one by one.
  if (clamp) {
    const push = { x: 0, y: 0 };
    let fits = true;
    for (const box of order) {
      const ideal = { x: box.x + shift.x, y: box.y + shift.y };
      const kept = clamp(box, ideal);
      for (const axis of ['x', 'y']) {
        const needed = kept[axis] - ideal[axis];
        if (needed && push[axis] && (Math.sign(needed) !== Math.sign(push[axis]))) fits = false;
        if (Math.abs(needed) > Math.abs(push[axis])) push[axis] = needed;
      }
    }
    if (fits) {
      for (const axis of ['x', 'y']) {
        const space = snap ? step?.[axis] : 0;
        shift[axis] += space > 0 ? Math.sign(push[axis]) * Math.ceil(Math.abs(push[axis]) / space) * space : push[axis];
      }
    }
  }

  const taken = [];
  for (const box of order) {
    const ideal = { x: box.x + shift.x, y: box.y + shift.y };
    let position = place(box, ideal);
    if (snap && (step?.x > 0) && (step?.y > 0)) {
      // Only tokens that stood apart are kept apart.
      const others = taken.filter((other) => !overlaps(other.from, box));
      const clear = (candidate) => !others.some((other) => overlaps(other.to, { ...box, ...candidate }));
      if (!clear(position)) position = freeSpaceNear(box, ideal, { place, step, clear }) ?? position;
    }
    taken.push({ from: box, to: { ...box, ...position } });
    landings.set(box.id, position);
  }
  return landings;
}

/** The free snapped position nearest to where a token wanted to be, or null if there is none nearby. */
function freeSpaceNear(box, ideal, { place, step, clear }) {
  for (let ring = 1; ring <= SEARCH_RINGS; ring++) {
    const candidates = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const position = place(box, { x: ideal.x + (i * step.x), y: ideal.y + (j * step.y) });
        candidates.push({ position, distance: Math.hypot(position.x - ideal.x, position.y - ideal.y) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const free = candidates.find((candidate) => clear(candidate.position));
    if (free) return free.position;
  }
  return null;
}

/* -------------------------------------------- */
/*  On the canvas                               */
/* -------------------------------------------- */

/**
 * The tokens a teleport of these tokens really moves: none that is locked,
 * and for a rider, what it rides. A mount takes its riders with it (that is
 * Token Mounting's doing), so a rider is never sent anywhere on its own.
 */
function movers(tokens) {
  const moving = new Set();
  for (const token of tokens) {
    if (!token?.document || token.destroyed) continue;
    let mover = token;
    const seen = new Set([mover]);
    for (let carrier = carrierOf(mover); carrier && !seen.has(carrier); carrier = carrierOf(mover)) {
      seen.add(carrier);
      mover = carrier;
    }
    if (mover.document.locked) continue;
    moving.add(mover);
  }
  return [...moving];
}

function boxOf(token) {
  const { x, y } = token.document._source;
  const { width, height } = token.document.getSize();
  return { id: token.document.id, x, y, width, height };
}

function snapFor(document, position) {
  const { elevation, width, height, shape } = document._source;
  return document.getSnappedPosition({ x: position.x, y: position.y, elevation, width, height, shape });
}

/**
 * A token stays wholly on the canvas. Core's paste lets one hang half off the
 * edge; here that would also knock a group off the grid, because the canvas
 * ends on a grid line and half a token short of it is not one.
 */
function clampFor(document, position) {
  const { width, height } = document.getSize();
  const { width: canvasWidth, height: canvasHeight } = canvas.dimensions;
  return {
    x: Math.clamp(position.x, 0, Math.max(canvasWidth - width, 0)),
    y: Math.clamp(position.y, 0, Math.max(canvasHeight - height, 0)),
  };
}

/**
 * A token is put down on the level being looked at, as high above that
 * level's floor as it stood above its own. Nothing changes for a token that
 * is on the viewed level already.
 */
function levelFor(document) {
  const viewed = canvas.level;
  const { level, elevation, depth } = document._source;
  if (!viewed || (level === viewed.id)) return {};
  const base = document.parent.levels?.get(level)?.elevation?.base ?? 0;
  const raised = (elevation - base) + (viewed.elevation?.base ?? 0);
  return { level: viewed.id, elevation: viewed.clampElevation?.(raised, depth) ?? raised };
}

/**
 * Put tokens down at a point, without moving them there. GM only.
 * @param {Token[]} tokens                     The tokens to teleport
 * @param {{x: number, y: number}} point       Where the middle of the group lands, in canvas pixels
 * @param {object} [options]
 * @param {boolean} [options.snap=true]        Land on the grid
 * @returns {Promise<TokenDocument[]>}         The tokens that were moved
 */
export async function teleportTokens(tokens, point, { snap = true } = {}) {
  if (!game.user.isGM || !canvas.ready) return [];
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return [];
  const moving = movers(Array.from(tokens ?? []));
  if (!moving.length) return [];

  const byId = new Map(moving.map((token) => [token.document.id, token.document]));
  const onGrid = snap && !canvas.grid.isGridless;
  const landings = planLandings(moving.map(boxOf), point, {
    snap: onGrid ? (box, position) => snapFor(byId.get(box.id), position) : null,
    step: { x: canvas.grid.sizeX, y: canvas.grid.sizeY },
    clamp: (box, position) => clampFor(byId.get(box.id), position),
  });

  const instructions = {};
  for (const [id, position] of landings) {
    const document = byId.get(id);
    const source = document._source;
    const level = levelFor(document);
    if ((position.x === source.x) && (position.y === source.y) && !('level' in level)) continue;
    const exact = onGrid ? snapFor(document, position) : null;
    instructions[id] = {
      waypoints: [{
        x: position.x,
        y: position.y,
        ...level,
        action: 'displace',
        snapped: !!exact && (Math.round(exact.x) === position.x) && (Math.round(exact.y) === position.y),
      }],
      method: 'api',
      autoRotate: false,
      showRuler: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
    };
  }
  if (!Object.keys(instructions).length) return [];

  const results = await canvas.scene.moveTokens(instructions, { animate: false });
  const moved = [...byId.values()].filter((document) => results?.[document.id]);
  log.debug(`teleported ${moved.map((document) => document.name).join(', ') || 'nothing'}`);
  return moved;
}

/**
 * Is the pointer over the map itself? With it over a sidebar or a window the
 * canvas only knows where it last was, and tokens would land there.
 */
function pointerOnMap() {
  return !!canvas.app?.view?.matches?.(':hover');
}

function onTeleportKey(context) {
  if (!game.user.isGM || !canvas.ready || !canvas.tokens?.active) return false;
  const tokens = canvas.tokens.controlled;
  if (!tokens.length) return false;
  // Mid-drag the same tokens are already going somewhere.
  if (canvas.tokens._draggedToken) return false;
  if (!movers(tokens).length) {
    ui.notifications.warn('S187MOVE.Notify.TeleportLocked', { localize: true });
    return true;
  }
  if (!pointerOnMap()) {
    ui.notifications.warn('S187MOVE.Notify.TeleportOffMap', { localize: true });
    return true;
  }
  const { x, y } = canvas.mousePosition;
  // Shift as the key press itself reports it; the keyboard's own record of
  // held keys misses a Shift that went down while the window was elsewhere.
  const shift = context?.isShift ?? game.keyboard.isModifierActive('Shift');
  teleportTokens(tokens, { x, y }, { snap: !shift }).catch((err) => log.error('teleport failed', err));
  return true;
}

export function registerTeleport() {
  game.keybindings.register(MODULE_ID, KEYBINDING, {
    name: 'S187MOVE.Keybindings.teleport.Name',
    hint: 'S187MOVE.Keybindings.teleport.Hint',
    editable: [{ key: 'KeyJ' }],
    reservedModifiers: ['Shift'],
    restricted: true, // only a GM can see, bind or trigger it
    onDown: (context) => guarded('teleport key', () => onTeleportKey(context), false),
  });
}
