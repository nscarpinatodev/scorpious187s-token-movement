/**
 * Small pieces of geometry and colour. Pure, so tools/check.mjs can run them.
 */

/**
 * Shrink a convex polygon towards its centre and round its corners.
 *
 * This is what turns a grid space into a tile: a square or hexagon with a gap
 * round it and soft corners. Works on whatever `grid.getVertices` returns.
 *
 * @param {{x: number, y: number}[]} vertices   A convex polygon
 * @param {object} [options]
 * @param {number} [options.inset=0]      Gap left on each side, in pixels
 * @param {number} [options.radius=0]     Corner radius, in pixels
 * @param {number} [options.segments=3]   Straight pieces per rounded corner
 * @returns {number[]} Flat [x0, y0, x1, y1, …] ready for `Graphics#drawPolygon`
 */
export function roundedInsetPolygon(vertices, { inset = 0, radius = 0, segments = 3 } = {}) {
  const count = vertices.length;
  let cx = 0;
  let cy = 0;
  for (const vertex of vertices) {
    cx += vertex.x;
    cy += vertex.y;
  }
  cx /= count;
  cy /= count;

  // Shrink by moving every side inwards by `inset`. For a regular polygon
  // that is a uniform scale about the centre by (apothem - inset) / apothem.
  const a = vertices[0];
  const b = vertices[1];
  const sideLength = Math.hypot(b.x - a.x, b.y - a.y);
  const apothem = Math.abs(((b.x - a.x) * (a.y - cy)) - ((a.x - cx) * (b.y - a.y))) / (sideLength || 1);
  const scale = apothem > 0 ? Math.max((apothem - inset) / apothem, 0.05) : 1;
  const points = vertices.map((vertex) => ({ x: cx + ((vertex.x - cx) * scale), y: cy + ((vertex.y - cy) * scale) }));

  if (!(radius > 0) || (segments < 1)) return points.flatMap((point) => [point.x, point.y]);

  const flat = [];
  for (let n = 0; n < count; n++) {
    const corner = points[n];
    const before = points[(n + count - 1) % count];
    const after = points[(n + 1) % count];
    const toBefore = { x: before.x - corner.x, y: before.y - corner.y };
    const toAfter = { x: after.x - corner.x, y: after.y - corner.y };
    const lengthBefore = Math.hypot(toBefore.x, toBefore.y);
    const lengthAfter = Math.hypot(toAfter.x, toAfter.y);

    // How far back along each side the curve starts: for a corner of interior
    // angle θ a circle of the given radius touches the sides r / tan(θ/2) away.
    const cos = ((toBefore.x * toAfter.x) + (toBefore.y * toAfter.y)) / ((lengthBefore * lengthAfter) || 1);
    const half = Math.acos(Math.min(Math.max(cos, -1), 1)) / 2;
    const back = Math.min(radius / (Math.tan(half) || 1), lengthBefore / 2, lengthAfter / 2);
    const start = {
      x: corner.x + ((toBefore.x / lengthBefore) * back),
      y: corner.y + ((toBefore.y / lengthBefore) * back),
    };
    const end = {
      x: corner.x + ((toAfter.x / lengthAfter) * back),
      y: corner.y + ((toAfter.y / lengthAfter) * back),
    };

    // A quadratic curve through the corner is indistinguishable from an arc
    // at this size and needs no trigonometry per point.
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      const u = 1 - t;
      flat.push(
        (u * u * start.x) + (2 * u * t * corner.x) + (t * t * end.x),
        (u * u * start.y) + (2 * u * t * corner.y) + (t * t * end.y),
      );
    }
  }
  return flat;
}

/**
 * Blend two 0xRRGGBB colours.
 * @param {number} from
 * @param {number} to
 * @param {number} amount   0 gives `from`, 1 gives `to`
 * @returns {number}
 */
export function mixColor(from, to, amount) {
  const t = Math.min(Math.max(amount, 0), 1);
  const channel = (shift) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + ((b - a) * t)) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * How far along a polyline each of its points is.
 * @param {{x: number, y: number}[]} points
 * @returns {number[]} `lengths[k]` is the distance from the first point to point k
 */
export function cumulativeLengths(points) {
  const lengths = [0];
  for (let n = 1; n < points.length; n++) {
    lengths.push(lengths[n - 1] + Math.hypot(points[n].x - points[n - 1].x, points[n].y - points[n - 1].y));
  }
  return lengths;
}

/**
 * How far along a route a point travelling it has got.
 *
 * The answer never goes backwards, and it is looked for from where the point
 * was last time, so a route that doubles back on itself or crosses itself is
 * followed in order rather than jumping to whichever stretch is nearest.
 *
 * @param {{x: number, y: number}[]} points   The route
 * @param {number[]} lengths                  From `cumulativeLengths(points)`
 * @param {{x: number, y: number}} point      Where the traveller is now
 * @param {number} [from=0]                   How far it had got last time
 * @param {number} [tolerance=0]              How far off the line still counts as on it
 * @returns {number} Distance along the route, at least `from`
 */
export function advanceAlong(points, lengths, point, from = 0, tolerance = 0) {
  const last = points.length - 1;
  if (last < 1) return from;
  let first = 0;
  while ((first < last - 1) && (lengths[first + 1] <= from)) first++;

  let near = null;   // best stretch among those the point is on, starting from where it was
  let any = null;    // nearest stretch ahead of all, in case it is on none of them
  for (let n = first; n < last; n++) {
    const a = points[n];
    const b = points[n + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = (dx * dx) + (dy * dy);
    const t = squared > 0
      ? Math.min(Math.max((((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / squared, 0), 1)
      : 0;
    const off = Math.hypot(point.x - (a.x + (dx * t)), point.y - (a.y + (dy * t)));
    const along = lengths[n] + ((lengths[n + 1] - lengths[n]) * t);
    // A stretch that would put the traveller further back than it already
    // was is one it has finished with: it is on a later one that overlaps.
    const behind = along < from - 0.5;
    const candidate = { off, along: Math.max(along, from), behind };
    if (!any || (off < any.off)) any = candidate;
    if (off <= tolerance) {
      if (!near || (near.behind && !behind) || ((near.behind === behind) && (off < near.off))) near = candidate;
    } else if (near && !near.behind) break; // left the stretches it is on; anything further is a later pass
  }
  return (near ?? any).along;
}

/**
 * How each band departs from the one colour they all share, nearest first:
 * how far it is darkened, and how its opacity compares with the opacity the
 * user has set. The nearest band is the colour itself, drawn bolder than
 * that setting; each band further out is 20% darker than the one before and
 * fainter, so the range deepens and thins towards its edge while staying
 * recognisably the same colour.
 */
const SHADES = Object.freeze([
  Object.freeze({ dark: 0, fade: 1.4 }),
  Object.freeze({ dark: 0.2, fade: 1 }),
  Object.freeze({ dark: 0.4, fade: 0.7 }),
]);

/**
 * The shade of a base colour that a band is drawn in.
 * @param {number} base    0xRRGGBB, the colour of the nearest band
 * @param {number} index   Which band, nearest first; beyond the last shade repeats it
 * @returns {{color: number, fade: number}} The colour, and a multiplier for its opacity
 */
export function shadeOf(base, index) {
  const shade = SHADES[Math.min(Math.max(index, 0), SHADES.length - 1)];
  return { color: mixColor(base, 0x000000, shade.dark), fade: shade.fade };
}

/** How many distinct shades there are. */
export const SHADE_COUNT = SHADES.length;

/**
 * The band a distance falls in: the first one that reaches that far.
 *
 * A step 30 ft along a route is in the 30 ft band, since a 30 ft move gets
 * there. Past the last band it is still drawn as the last.
 * @template {{distance: number}} T
 * @param {T[]} ranges    Bands, nearest first
 * @param {number} used   How far along, in the bands' units
 * @returns {T|null} null only if there are no bands
 */
export function bandAt(ranges, used) {
  if (!ranges.length) return null;
  return ranges.find((range) => used <= range.distance + 1e-6) ?? ranges[ranges.length - 1];
}
