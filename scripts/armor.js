import { MODULE_ID, HOOKS, FLAGS, ARMOR_CLASSES } from './constants.js';
import { SYSTEM_PRESETS, armorCategory } from './systems.js';

/** What a token with nothing to say for itself sounds like. */
export const DEFAULT_ARMOR = ARMOR_CLASSES[0];

/**
 * What a token's steps should sound like. In order: a class set on the token
 * itself (Token Configuration), one supplied by another package through the
 * getArmorClass hook, the armor its actor wears where the game system is
 * known, and otherwise unarmored.
 *
 * Read fresh each time rather than remembered: it is a handful of property
 * reads, and armor is put on and taken off in the middle of a session.
 *
 * @param {object} token  A Token or a TokenDocument
 * @returns {'unarmored'|'light'|'medium'|'heavy'}
 */
export function armorClassOf(token) {
  const document = token?.document ?? token;
  if (!document) return DEFAULT_ARMOR;

  const own = document.flags?.[MODULE_ID]?.[FLAGS.armor];
  if (ARMOR_CLASSES.includes(own)) return own;

  const result = { armor: null };
  Hooks.callAll(HOOKS.getArmorClass, document, result);
  if (ARMOR_CLASSES.includes(result.armor)) return result.armor;

  // A system getter may throw on a half-prepared actor; that is not worth
  // losing a step sound over.
  let worn = null;
  try {
    worn = armorCategory(SYSTEM_PRESETS[game.system.id]?.armor?.(document.actor));
  } catch {
    worn = null;
  }
  return worn ?? DEFAULT_ARMOR;
}
