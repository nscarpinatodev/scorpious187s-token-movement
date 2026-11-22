import { MODULE_ID, LIB_ID, SETTINGS } from './constants.js';

// scorpious187s-lib is treated as optional here so a missing or late-loading
// library can never be the reason a token fails to move.
let cached = null;
function libLogger() {
  return game.modules.get(LIB_ID)?.api?.utils?.makeLogger?.(MODULE_ID) ?? null;
}

function debugEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.debug);
  } catch {
    return false;
  }
}

export const log = {
  // Not `lib?.log?.(...a) ?? console.log(...)`: the lib logger returns
  // undefined, so `??` would fall through and print every line twice.
  info: (...a) => {
    const lib = (cached ??= libLogger());
    if (lib?.log) lib.log(...a);
    else console.log(`${MODULE_ID} |`, ...a);
  },
  warn: (...a) => console.warn(`${MODULE_ID} |`, ...a),
  error: (...a) => console.error(`${MODULE_ID} |`, ...a),
  debug: (...a) => { if (debugEnabled()) console.log(`${MODULE_ID} | [debug]`, ...a); },
};

/**
 * Run `fn`, and if it throws, log once per `label` and return `fallback`.
 *
 * Everything this module does is cosmetic or advisory. It sits inside core's
 * token animation and drag handlers, so an exception here would otherwise
 * surface as "my token will not move" — far worse than a missing hop.
 */
const reported = new Set();
export function guarded(label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    if (!reported.has(label)) {
      reported.add(label);
      log.error(`${label} failed; continuing without it`, err);
    }
    return fallback;
  }
}
