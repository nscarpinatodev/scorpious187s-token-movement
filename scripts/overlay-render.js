/**
 * Drawing the range overlay. Two looks:
 *
 *  - "tiles": every reachable space is its own rounded tile with a gap round
 *    it, the area has a soft pulsing edge, a slow shimmer crosses it, and the
 *    route being dragged is a lit strip with a ring on every step. This is
 *    the look of Aeris Tokens, redrawn here with plain geometry rather than
 *    its shaders.
 *  - "flat": a solid tint with a hard outline per band, on one of core's grid
 *    highlight layers. The route is left to core's ruler.
 *
 * Both take the same description of what to draw (a "painting"), so the
 * overlay itself does not care which is in use.
 *
 * @typedef {object} Painting
 * @property {{color: number, alpha: number}[]} ranges   Bands, nearest first
 * @property {Map<string, {band: number, vertices: object[]}>} cells  Reachable now
 * @property {object[][]} spent      Vertices of spaces the route has put out of reach
 * @property {number} accent         Colour to fall back on when no band is left
 * @property {object|null} route     The route being dragged (tiles look only)
 * @property {{color: number, alpha: number, polygons: object[][]}[]} route.strips
 *   The spaces the route crosses, grouped by the band each falls in
 * @property {object[][]} route.blocked    …and of those it cannot reach
 * @property {{x: number, y: number, blocked: boolean}[]} route.steps  Centre of each step
 */

import { MODULE_ID, SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { boundaryEdges, boundaryLoops } from './reachability.js';
import { roundedInsetPolygon, mixColor } from './shapes.js';
import { TILE, BLOCKED_COLOR, litColor, litAlpha, fillStrip, drawSteps } from './route-draw.js';

const LAYER = `${MODULE_ID}.range`;

/** Tint for spaces the planned route has put out of reach. */
export const SPENT_COLOR = 0x10141c;

const spentAlpha = () => Math.min((setting(SETTINGS.rangeOpacity) ?? 0.28) * 1.25, 0.6);

/* -------------------------------------------- */
/*  Flat                                        */
/* -------------------------------------------- */

class FlatRenderer {
  /** @param {Painting} painting */
  paint(painting) {
    const { ranges, cells, spent } = painting;
    const layer = canvas.interface.grid.addHighlightLayer(LAYER);
    layer.clear();
    layer.lineStyle(0);

    if (spent.length) {
      layer.beginFill(SPENT_COLOR, spentAlpha());
      for (const vertices of spent) layer.drawPolygon(vertices);
      layer.endFill();
    }

    // Fills, one band at a time so each batch shares a style.
    for (let band = 0; band < ranges.length; band++) {
      const { color, alpha } = ranges[band];
      layer.beginFill(color, alpha);
      for (const cell of cells.values()) {
        if (cell.band === band) layer.drawPolygon(cell.vertices);
      }
      layer.endFill();
    }

    // Outline each band's outer edge. Furthest first, so the nearer band's
    // line is drawn on top where the two coincide.
    const width = Math.max(4 * canvas.dimensions.uiScale, 2);
    for (let band = ranges.length - 1; band >= 0; band--) {
      const polygons = [];
      for (const cell of cells.values()) if (cell.band <= band) polygons.push(cell.vertices);
      layer.lineStyle({ width, color: ranges[band].color, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND });
      for (const [a, b] of boundaryEdges(polygons)) {
        layer.moveTo(a.x, a.y);
        layer.lineTo(b.x, b.y);
      }
    }
    layer.lineStyle(0);
  }

  clear() {
    if (canvas.ready) canvas.interface?.grid?.clearHighlightLayer(LAYER);
  }

  /** Nothing of ours outlives the canvas: core owns the highlight layer. */
  forget() {}
}

/* -------------------------------------------- */
/*  Tiles                                       */
/* -------------------------------------------- */

/** The edge breathes this many times a second. */
const PULSE_HZ = 0.35;

/** The shimmer: one band every this many spaces, moving this many spaces a second. */
const WAVE_SPACES = 5;
const WAVE_SPEED = 0.4;
const WAVE_STRENGTH = 0.16;

/** A seamless diagonal light-and-dark band pattern, made once. */
let shimmerTexture = null;
function getShimmerTexture() {
  if (shimmerTexture && !shimmerTexture.destroyed && shimmerTexture.baseTexture) return shimmerTexture;
  const size = 256;
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const context = element.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Periodic in x and in y, so the tile repeats without a seam.
      const wave = 0.5 + (0.5 * Math.sin((2 * Math.PI * (x + y)) / size));
      const at = ((y * size) + x) * 4;
      image.data[at] = 255;
      image.data[at + 1] = 255;
      image.data[at + 2] = 255;
      image.data[at + 3] = Math.round(255 * WAVE_STRENGTH * wave * wave);
    }
  }
  context.putImageData(image, 0, 0);
  shimmerTexture = PIXI.Texture.from(element, { wrapMode: PIXI.WRAP_MODES.REPEAT });
  return shimmerTexture;
}

class TileRenderer {
  #root = null;
  #glow = null;
  #tiles = null;
  #edges = null;
  #marks = null;
  #mask = null;
  #shimmer = null;
  #ticking = false;
  #started = 0;

  #ensure() {
    if (this.#root && !this.#root.destroyed && this.#root.parent) return;
    this.forget();
    const root = new PIXI.Container();
    root.eventMode = 'none';
    this.#glow = root.addChild(new PIXI.Graphics());
    this.#tiles = root.addChild(new PIXI.Graphics());
    this.#edges = root.addChild(new PIXI.Graphics());
    this.#shimmer = root.addChild(new PIXI.TilingSprite(getShimmerTexture(), 16, 16));
    this.#mask = root.addChild(new PIXI.Graphics());
    this.#marks = root.addChild(new PIXI.Graphics());
    this.#shimmer.mask = this.#mask;
    this.#shimmer.visible = false;
    // Alongside core's own grid highlights: above the map, below the tokens.
    canvas.interface.grid.highlight.addChild(root);
    this.#root = root;
  }

  /** @param {Painting} painting */
  paint(painting) {
    this.#ensure();
    const { ranges, cells, spent, route, accent } = painting;
    const size = canvas.grid.size;
    const tile = { inset: size * TILE.gap, radius: size * TILE.radius };
    const shape = (vertices) => roundedInsetPolygon(vertices, tile);

    const tiles = this.#tiles;
    const mask = this.#mask;
    tiles.clear();
    mask.clear();
    tiles.lineStyle(0);

    if (spent.length) {
      // Dark, with a trace of the range's own colour so it belongs to it.
      tiles.beginFill(mixColor(accent, SPENT_COLOR, 0.86), spentAlpha());
      for (const vertices of spent) tiles.drawPolygon(shape(vertices));
      tiles.endFill();
    }

    // The tiles themselves, and the same shapes again as the stencil that
    // keeps the shimmer inside them.
    const raw = [];
    mask.beginFill(0xffffff, 1);
    for (let band = 0; band < ranges.length; band++) {
      const { color, alpha } = ranges[band];
      tiles.beginFill(color, alpha);
      for (const cell of cells.values()) {
        if (cell.band !== band) continue;
        const points = shape(cell.vertices);
        tiles.drawPolygon(points);
        mask.drawPolygon(points);
        raw.push(cell.vertices);
      }
      tiles.endFill();
    }
    mask.endFill();

    // The route: a lit strip under the token's feet, a ring on every step.
    const marks = this.#marks;
    marks.clear();
    if (route) {
      // Each stretch in the colour of the band its distance falls in.
      for (const strip of route.strips) fillStrip(tiles, strip.polygons, litColor(strip.color), litAlpha(strip.alpha));
      fillStrip(tiles, route.blocked, BLOCKED_COLOR, 0.35);
      drawSteps(marks, route.steps);
    }

    // Where one band gives way to the next: a fine line in the gaps between
    // the tiles, round everything the nearer band reaches. The bands can be
    // shades of one colour, and this is what keeps them apart at a glance.
    const edges = this.#edges;
    edges.clear();
    const present = new Set();
    for (const cell of cells.values()) present.add(cell.band);
    const outermost = Math.max(...present);
    for (const band of present) {
      if (band === outermost) continue; // the glow marks the outside
      const within = [];
      for (const cell of cells.values()) if (cell.band <= band) within.push(cell.vertices);
      edges.lineStyle({
        width: Math.max(size * TILE.edge, 1.5),
        color: mixColor(ranges[band].color, 0xffffff, 0.35),
        alpha: 0.7,
        join: PIXI.LINE_JOIN.ROUND,
      });
      for (const loop of boundaryLoops(within)) edges.drawPolygon(loop);
    }
    edges.lineStyle(0);

    // The soft edge: the outline of the whole area, stroked several times
    // over, wider and fainter each time. Closed loops with round joins, so
    // the corners do not bead where two strokes would otherwise overlap.
    const glow = this.#glow;
    glow.clear();
    if (raw.length) {
      const color = mixColor(ranges[0]?.color ?? accent, 0xffffff, 0.25);
      const loops = boundaryLoops(raw);
      for (const fraction of TILE.glow) {
        glow.lineStyle({ width: size * fraction, color, alpha: 0.11, join: PIXI.LINE_JOIN.ROUND });
        for (const loop of loops) glow.drawPolygon(loop);
      }
      glow.lineStyle(0);
    }

    this.#animate(raw.length > 0);
  }

  #animate(hasTiles) {
    const moving = hasTiles && !!setting(SETTINGS.overlayMotion);
    const shimmer = this.#shimmer;
    shimmer.visible = moving;
    this.#glow.alpha = 1;
    if (moving) {
      const rect = canvas.dimensions.rect;
      const size = canvas.grid.size;
      shimmer.position.set(rect.x, rect.y);
      shimmer.width = rect.width;
      shimmer.height = rect.height;
      // The pattern repeats every `period` pixels along x and along y, which
      // puts its bands WAVE_SPACES apart measured across them.
      const period = WAVE_SPACES * Math.SQRT2 * size;
      shimmer.tileScale.set(period / 256);
    }
    if (moving && !this.#ticking) {
      this.#started = canvas.app.ticker.lastTime;
      canvas.app.ticker.add(this.#tick, this);
      this.#ticking = true;
    } else if (!moving) this.#stop();
  }

  #tick() {
    if (!this.#root || this.#root.destroyed) {
      this.#stop();
      return;
    }
    // The canvas's own clock, so the motion keeps step with everything else
    // drawn on it and stops when it does.
    const seconds = (canvas.app.ticker.lastTime - this.#started) / 1000;
    this.#glow.alpha = 0.72 + (0.28 * Math.sin(2 * Math.PI * PULSE_HZ * seconds));
    const shift = (WAVE_SPEED * canvas.grid.size * seconds) / Math.SQRT2;
    this.#shimmer.tilePosition.set(shift, shift);
  }

  #stop() {
    if (!this.#ticking) return;
    canvas.app?.ticker.remove(this.#tick, this);
    this.#ticking = false;
  }

  clear() {
    this.#stop();
    if (!this.#root || this.#root.destroyed) return;
    this.#glow.clear();
    this.#tiles.clear();
    this.#edges.clear();
    this.#marks.clear();
    this.#mask.clear();
    this.#shimmer.visible = false;
  }

  /** The canvas is going away, and our display objects with it. */
  forget() {
    this.#stop();
    if (this.#root && !this.#root.destroyed) this.#root.destroy({ children: true });
    this.#root = this.#glow = this.#tiles = this.#edges = this.#marks = this.#mask = this.#shimmer = null;
  }
}

/* -------------------------------------------- */

const renderers = { tiles: new TileRenderer(), flat: new FlatRenderer() };

/** Which look is in use. */
export function overlayStyle() {
  return setting(SETTINGS.overlayStyle) === 'flat' ? 'flat' : 'tiles';
}

/**
 * Are routes drawn in the tiles look here, in place of core's ruler line and
 * squares? True for the route being dragged and for a walking token's trail.
 */
export function routesStyled() {
  return canvas.ready && !canvas.grid.isGridless && !!setting(SETTINGS.rangeOverlay)
    && !!setting(SETTINGS.routeMarkers) && (overlayStyle() === 'tiles');
}

/** @param {Painting} painting */
export function paintRange(painting) {
  const style = overlayStyle();
  for (const [name, renderer] of Object.entries(renderers)) if (name !== style) renderer.clear();
  renderers[style].paint(painting);
}

export function clearRange() {
  for (const renderer of Object.values(renderers)) renderer.clear();
}

export function forgetRange() {
  for (const renderer of Object.values(renderers)) renderer.forget();
}
