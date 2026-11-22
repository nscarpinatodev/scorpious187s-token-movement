# Changelog

## 0.1.0 (unreleased)

First version.

- Lift animation for moving tokens: hop from space to space, or lift, glide and set down. Per-user, with adjustable height and zoom.
- Walk speed setting: how fast tokens travel, in spaces per second, for the whole world.
- Step sounds on each landing, with a synthesised built-in sound or a custom file.
- Pathfinding: when the straight route is blocked, the cheapest route round is planned, using whatever the game system counts as blocking. Per-user switch. Routes are found within the same frame, so the ruler and the range overlay never wait on a search.
- The overlay follows the route as you drag: it re-centres on the route's end with the movement that is left, and dims the spaces the route has put out of reach.
- Tiles style for the overlay, after the look of Aeris Tokens: each reachable space is a rounded tile, the area has a soft pulsing glow round it and a slow shimmer across it, and the route being dragged is a lit strip with a ring on every step in place of core's line and squares (the distance label stays). The trail a token walks is drawn the same way: the dropped route stays, keeps its colour, and dims step by step behind the token; in combat the turn's movement so far shows as faint tiles. Following the HUD, the Tiles style is all shades of the device's main colour: bold nearest the token, each band further out 20% darker and fainter, with a fine line between bands. Every step of a route and of a trail is in the colour of the band its distance falls in. Per-user settings: Range style (Tiles or Flat), Animate the range, Light up the route.
- Reachable-space overlay while dragging, in bands, on square and hex grids. Honours walls, terrain cost, the grid's diagonal rule and whatever the game system adds to movement constraints.
- Speed presets for dnd5e, pf2e, sf2e, pf1, D35E, sfrpg, a5e and swade, plus a configurable data path and fallback speed for everything else.
- In combat, the range shrinks by movement already used this turn.
- Keybinding (M) to pin the selected token's range without dragging.
- GM-only hold key (G) that brings every player's view along with the tokens the GM moves. Players' movement never moves anyone else's view.
- Colour scheme, per user: Suit the game system (the default: green, yellow and red for the three Strides in Pathfinder and Starfinder 2e, the Character HUD's device everywhere else), Match my Character HUD, or My own colours.
- The diagonal rule comes from core's Square Grid Diagonals setting; under the alternating rules the count carries across a turn as core's ruler counts it.
- `getMovementRanges` and `step` hooks and a small API for integrations.
