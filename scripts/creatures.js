/**
 * What a creature is, as far as its sound goes: whether it walks on hooves,
 * and whether it flies on wings.
 *
 * No game system says either. A riding horse and a wolf are the same statblock
 * with different numbers, and a fly speed is as likely to be a spell as a pair
 * of wings. The name is what carries it, so the name is what is read: the
 * token's and its actor's, because one is often a pet name ("Bréagh") and the
 * other the species ("Riding Horse").
 *
 * Names are matched as whole words, with or without a plural s: "horse" is not
 * in "Horseshoe Crab", nor "dragon" in "Dragonborn". The lists are of what is
 * obvious. A miss costs one choice in Token Configuration, which also overrules
 * a wrong guess.
 */

import { MODULE_ID, FLAGS } from './constants.js';

/** Creatures whose steps are hoofbeats. */
export const HOOFED_NAMES = Object.freeze([
  'horse', 'warhorse', 'steed', 'pony', 'mule', 'donkey', 'stallion', 'mare', 'destrier',
  'pegasus', 'unicorn', 'nightmare', 'centaur', 'zebra',
  'elk', 'stag', 'deer', 'moose', 'reindeer', 'ox', 'oxen', 'bison', 'aurochs',
]);

/** Creatures whose flight is wingbeats. */
export const WINGED_NAMES = Object.freeze([
  'dragon', 'wyrmling', 'wyrm', 'drake', 'wyvern',
  'griffon', 'griffin', 'gryphon', 'hippogriff', 'pegasus', 'roc', 'phoenix',
  'eagle', 'hawk', 'falcon', 'owl', 'raven', 'crow', 'vulture', 'bird', 'bat',
  'harpy', 'manticore', 'chimera', 'peryton', 'gargoyle', 'sphinx', 'couatl',
  'pteranodon', 'pterosaur', 'angel', 'deva',
]);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One pattern per list, built the first time the list is used. */
const patterns = new WeakMap();
function patternFor(names) {
  let pattern = patterns.get(names);
  if (!pattern) {
    pattern = new RegExp(`\\b(?:${names.map(escapeRegex).join('|')})s?\\b`, 'i');
    patterns.set(names, pattern);
  }
  return pattern;
}

/**
 * Does a name hold one of the names in a list, as a whole word?
 * @param {unknown} name
 * @param {readonly string[]} names
 * @returns {boolean}
 */
export function namedIn(name, names) {
  return (typeof name === 'string') && !!names.length && patternFor(names).test(name);
}

/** The names a token goes by: its own and its actor's. */
function namesOf(document) {
  return `${document?.name ?? ''} ${document?.actor?.name ?? ''}`;
}

/**
 * Does this token walk on hooves, going by what it is called?
 * @param {object} token  A Token or a TokenDocument
 * @returns {boolean}
 */
export function hasHooves(token) {
  return namedIn(namesOf(token?.document ?? token), HOOFED_NAMES);
}

/**
 * Does this token fly on wings? What Token Configuration says, and otherwise
 * what it is called.
 * @param {object} token  A Token or a TokenDocument
 * @returns {boolean}
 */
export function hasWings(token) {
  const document = token?.document ?? token;
  const own = document?.flags?.[MODULE_ID]?.[FLAGS.flight];
  if (own === 'wings') return true;
  if (own === 'none') return false;
  return namedIn(namesOf(document), WINGED_NAMES);
}
