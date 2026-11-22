/**
 * "Follow me": the GM, and only the GM, can bring every player's view along
 * with a move by holding a key while making it.
 *
 * A player's movement never touches anyone else's camera. There is no setting
 * that turns that on, and no code path that could: the request is honoured
 * only when the server says the update came from a GM.
 *
 * Nothing is sent over a module socket. The GM's client marks the token
 * update itself; update options travel to every client with the update, the
 * same way core's own movement data does.
 */

import { MODULE_ID } from './constants.js';
import { guarded, log } from './logger.js';

const KEYBINDING = 'followMe';

/**
 * Is the follow key (with its modifiers) down right now? Read live rather
 * than tracked, so a key-up lost to a focus change cannot leave following on.
 */
export function followKeyHeld() {
  const bindings = game.keybindings.get(MODULE_ID, KEYBINDING) ?? [];
  return bindings.some((binding) => game.keyboard.downKeys.has(binding.key)
    && (binding.modifiers ?? []).every((modifier) => game.keyboard.isModifierActive(modifier)));
}

/**
 * Should this client's view follow this token update?
 * Exported so the rule can be exercised directly.
 * @param {TokenDocument} document
 * @param {object} changed
 * @param {object} options     The update operation's options
 * @param {string} userId      Who made the update, as reported by the server
 * @returns {boolean}
 */
export function shouldFollow(document, changed, options, userId) {
  if (!options?.[MODULE_ID]?.follow) return false;
  if (!game.users.get(userId)?.isGM) return false; // a player can never pull a camera
  if (userId === game.user.id) return false;       // the GM's own view stays theirs
  if (!('x' in changed) && !('y' in changed)) return false;
  if (!canvas.ready || (document.parent !== canvas.scene)) return false;
  // Do not lead players to something they are not meant to know is there.
  if (document.hidden && !game.user.isGM) return false;
  return true;
}

/** Tokens moved in the current batch, waiting to be framed together. */
let pending = [];

function frame() {
  const tokens = pending;
  pending = [];
  if (!canvas.ready || !tokens.length) return;

  // Frame where the group is going, not where it was.
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let duration = 0;
  for (const document of tokens) {
    const { x, y } = document._source;
    const { width, height } = document.getSize();
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
    duration = Math.max(duration, document.movement?.animation?.duration ?? 0);
  }

  // Keep the viewer's zoom unless the group would not fit on their screen.
  const margin = canvas.grid.size * 2;
  const { width: screenWidth, height: screenHeight } = canvas.app.renderer.screen;
  const fit = Math.min(screenWidth / ((right - left) + margin), screenHeight / ((bottom - top) + margin));
  const scale = Math.min(canvas.stage.scale.x, fit);

  canvas.animatePan({
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    scale,
    duration: Math.min(Math.max(duration || 600, 300), 4000),
  });
}

export function registerFollow() {
  game.keybindings.register(MODULE_ID, KEYBINDING, {
    name: 'S187MOVE.Keybindings.followMe.Name',
    hint: 'S187MOVE.Keybindings.followMe.Hint',
    editable: [{ key: 'KeyG' }],
    restricted: true, // only a GM can see, bind or trigger it
    onDown: () => !!game.user.isGM,
    onUp: () => !!game.user.isGM,
  });

  // The GM's client: mark moves made while the key is held.
  Hooks.on('preUpdateToken', (_document, changed, options) => {
    if (!game.user.isGM) return;
    if (!('x' in changed) && !('y' in changed)) return;
    guarded('follow mark', () => {
      if (followKeyHeld()) options[MODULE_ID] = { ...options[MODULE_ID], follow: true };
    });
  });

  // Every client: follow, but only on a GM's say-so.
  Hooks.on('updateToken', (document, changed, options, userId) => {
    guarded('follow', () => {
      if (!shouldFollow(document, changed, options, userId)) return;
      if (!pending.length) queueMicrotask(() => guarded('follow frame', frame));
      pending.push(document);
      log.debug(`following ${document.name}`);
    });
  });
}
