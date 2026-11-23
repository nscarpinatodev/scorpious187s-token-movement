import { MODULE_ID, HOOKS, FLAGS, ARMOR_CLASSES, STEP_CLASSES } from './constants.js';
import { SYSTEM_PRESETS, armorCategory } from './systems.js';
import { hasHooves } from './creatures.js';

/** What a token with nothing to say for itself sounds like. */
export const DEFAULT_ARMOR = ARMOR_CLASSES[0];

/** The class set on the token itself in Token Configuration, whatever it is. */
function ownClass(document) {
  return document.flags?.[MODULE_ID]?.[FLAGS.armor];
}

/** The armor class another package supplies through the getArmorClass hook, if any. */
function hookedArmor(document) {
  const result = { armor: null };
  Hooks.callAll(HOOKS.getArmorClass, document, result);
  return ARMOR_CLASSES.includes(result.armor) ? result.armor : null;
}

/** The armor the actor wears, where the game system is known. */
function wornArmor(document) {
  // A system getter may throw on a half-prepared actor; that is not worth
  // losing a step sound over.
  try {
    return armorCategory(SYSTEM_PRESETS[game.system.id]?.armor?.(document.actor));
  } catch {
    return null;
  }
}

/**
 * What a token wears, for the sound of its steps. In order: a class set on the
 * token itself (Token Configuration), one supplied by another package through
 * the getArmorClass hook, the armor its actor wears where the game system is
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
  const own = ownClass(document);
  if (ARMOR_CLASSES.includes(own)) return own;
  return hookedArmor(document) ?? wornArmor(document) ?? DEFAULT_ARMOR;
}

/**
 * What a token's steps sound like: what it wears, or that it walks on hooves.
 * In order: a class set on the token itself, one supplied through the
 * getArmorClass hook, hooves for a creature named as a hoofed one, the armor
 * its actor wears, and otherwise unarmored.
 *
 * Hooves come before worn armor because a horse in barding still walks on
 * hooves; they come after the token's own choice and the hook because those
 * are someone saying otherwise.
 *
 * @param {object} token  A Token or a TokenDocument
 * @returns {'unarmored'|'light'|'medium'|'heavy'|'hooves'}
 */
export function stepClassOf(token) {
  const document = token?.document ?? token;
  if (!document) return DEFAULT_ARMOR;
  const own = ownClass(document);
  if (STEP_CLASSES.includes(own)) return own;
  return hookedArmor(document) ?? (hasHooves(document) ? 'hooves' : null) ?? wornArmor(document) ?? DEFAULT_ARMOR;
}
