# Changelog

## 0.1.0 (unreleased)

First version.

- Lift animation for moving tokens: hop from space to space, or lift, glide and set down. Per-user, with adjustable height and zoom.
- Walk speed setting: how fast tokens travel, in spaces per second, for the whole world.
- Step sounds on each landing, with a synthesised built-in sound or a custom file.
- Pathfinding: when the straight route is blocked, the cheapest route round is planned, using whatever the game system counts as blocking. Per-user switch.
- The overlay follows the route as you drag: it re-centres on the route's end with the movement that is left, and dims the spaces the route has put out of reach.
- Reachable-space overlay while dragging, in bands, on square and hex grids. Honours walls, terrain cost, the grid's diagonal rule and whatever the game system adds to movement constraints.
- Speed presets for dnd5e, pf2e, sf2e, pf1, D35E, sfrpg, a5e and swade, plus a configurable data path and fallback speed for everything else.
- In combat, the range shrinks by movement already used this turn.
- Keybinding (M) to pin the selected token's range without dragging.
- GM-only hold key (G) that brings every player's view along with the tokens the GM moves. Players' movement never moves anyone else's view.
- Range colours follow the Character HUD's device by default, with your own colours as the alternative.
- The diagonal rule comes from core's Square Grid Diagonals setting; under the alternating rules the count carries across a turn as core's ruler counts it.
- `getMovementRanges` and `step` hooks and a small API for integrations.
