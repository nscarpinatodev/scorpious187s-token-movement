/**
 * Borrowing colours from Scorpious187's Sci-Fi Character HUD.
 *
 * The HUD dresses the interface as a "device", and each device carries a
 * palette as CSS custom properties on <body>. Reading those — rather than
 * keeping a copy of the palettes here — means every device and look, including
 * ones added later, works without this module changing.
 */

import { SETTINGS } from './constants.js';
import { setting } from './settings.js';

/** HUD palette variables, in the order the range bands use them. */
const HUD_VARIABLES = ['--sfh-hot', '--sfh-acc', '--sfh-bad'];

/** Body attributes whose change means the HUD's palette may have changed. */
export const HUD_ATTRIBUTES = ['data-sfh-device', 'data-sfh-look', 'data-sfh-dark'];

let probe = null;

/**
 * Resolve a CSS custom property on <body> to 0xRRGGBB, whatever notation it
 * was written in, by letting the browser compute it as a colour.
 * @param {string} variable
 * @returns {number|null}
 */
function resolveColor(variable) {
  if (!probe?.isConnected) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  // Fall back to a sentinel the palette will never use, so a missing
  // variable can be told apart from a real colour.
  probe.style.color = `var(${variable}, rgb(1, 2, 3))`;
  const match = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(getComputedStyle(probe).color);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map(Number);
  if ((r === 1) && (g === 2) && (b === 3)) return null;
  return (r << 16) | (g << 8) | b;
}

/** Is the HUD dressing the interface right now? */
export function hudActive() {
  return !!document.body?.dataset.sfhDevice;
}

/**
 * The band colours taken from the HUD's current device, nearest band first,
 * or null when the user has chosen their own colours or the HUD is not there.
 * @returns {number[]|null}
 */
export function hudBandColors() {
  if (setting(SETTINGS.colorScheme) === 'custom') return null;
  if (!hudActive()) return null;
  const colors = HUD_VARIABLES.map(resolveColor);
  return colors.every((color) => color !== null) ? colors : null;
}
