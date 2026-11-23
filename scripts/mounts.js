/**
 * Tokens that ride other tokens.
 *
 * This module does not mount anything. When Scorpious187's Token Mounting is
 * active, three things here depend on who is riding what:
 *
 *  - whose movement a drag spends. The rider in the first seat steers: their
 *    drag is turned into a move of the mount, so the range to show is the
 *    mount's. A passenger cannot move at all until they dismount.
 *  - who rises and falls together. A rider is drawn on top of its mount, so
 *    when the mount hops the rider has to go up with it.
 *  - what is not a journey. A rider carried along is moved with an action of
 *    its own; that is handled by what the action says about itself (see
 *    animation.js and trail.js), with no need to ask here.
 *
 * Everything is asked through Token Mounting's public API, and every answer
 * falls back to "nobody is riding anything" when the module is absent.
 */

const MOUNTING_ID = 'scorpious187s-token-mounting';

function mounting() {
  const module = globalThis.game?.modules?.get(MOUNTING_ID);
  return module?.active ? (module.api ?? null) : null;
}

/**
 * The token a token is riding, and whether it is the one steering.
 * @param {Token} token
 * @returns {{mount: Token, steers: boolean}|null} null when it rides nothing,
 *   or its mount is not on the canvas.
 */
function rideOf(token) {
  const api = mounting();
  const document = token?.document;
  if (!api || !document) return null;
  const mount = api.getMount?.(document)?.object ?? null;
  if (!mount || (mount === token) || mount.destroyed) return null;
  // Token Mounting 0.5.1 answers this itself; before that, the seat is on the rider's flag.
  const steers = typeof api.isPilot === 'function'
    ? !!api.isPilot(document)
    : (document.getFlag?.(MOUNTING_ID, 'mount')?.seat ?? 0) === (api.pilotSeat ?? 0);
  return { mount, steers };
}

/**
 * The token this one is riding, whichever seat it has.
 * @param {Token} token
 * @returns {Token|null}
 */
export function carrierOf(token) {
  return rideOf(token)?.mount ?? null;
}

/**
 * Every token this one is carrying: its riders, and whoever rides them.
 * @param {Token} token
 * @returns {Token[]}
 */
export function ridersOf(token) {
  const api = mounting();
  const document = token?.document;
  if (!api || !document) return [];
  const riders = api.allRiders?.(document) ?? api.getRiders?.(document) ?? [];
  return riders.map((rider) => rider.object).filter((rider) => rider && !rider.destroyed);
}

/**
 * Whose movement is spent when this token is dragged.
 * @param {Token} token
 * @returns {Token|null} The token itself; or, when it steers a mount, the
 *   mount (and on down, when that mount steers another); or null when it is a
 *   passenger, who goes nowhere until they dismount.
 */
export function moverOf(token) {
  const seen = new Set([token]);
  let current = token;
  for (;;) {
    const ride = rideOf(current);
    if (!ride) return current;
    if (!ride.steers) return null;
    if (seen.has(ride.mount)) return current;
    seen.add(ride.mount);
    current = ride.mount;
  }
}
