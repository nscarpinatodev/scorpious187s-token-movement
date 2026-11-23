# Changelog

## 0.1.1 (unreleased)

Works with Scorpious187's Token Mounting.

- A rider who steers a mount is shown the mount's range: its speed and what it has left this turn. Before, the range was the rider's own, though it is the mount that moves and pays.
- A passenger is shown no range and no lit route, since they cannot move until they dismount.
- Riders rise and fall with their mount. Before, the mount hopped underneath riders who slid along flat.
- A token carried by its mount no longer gets a trail for the ride. Any movement action marked as not visualized is now left out of trails, as core's ruler leaves it out.

## 0.1.0

First version.

- Lift animation for moving tokens: hop from space to space, or lift, glide and set down. Per-user, with adjustable height and zoom.
- Walk speed setting: how fast tokens travel, in spaces per second, for the whole world.
- Step sounds on each landing that match what the token wears: unarmored, light, medium and heavy armor each have their own set of four recorded footsteps. The armor is read from the actor in D&D 5e, Pathfinder 2e and Starfinder 2e; a GM can set it for any token in Token Configuration (Identity tab, Step sound), and other packages can supply it through the `getArmorClass` hook. Per user, Step sound picks between matching the armor, one set for everyone, and the original synthesised tap; a custom file for the world still overrides them all. The recordings are public-domain (CC0) work by HaelDB, Kenney and artisticdude, credited in `assets/sounds/CREDITS.md`.
- Big creatures sound big: steps from a token two or more spaces across are played lower, with more bass, and ring in the room after they land. A little for Large, more for Huge, most for Gargantuan. It goes by the token's footprint, so it works in any system and with any step sound, the world's custom file included. Per user, on by default.
- Pathfinding: when the straight route is blocked, the cheapest route round is planned, using whatever the game system counts as blocking. When it gets there but crosses something that costs extra (difficult terrain; in D&D 5e the space of a creature the token can pass through), a cheaper route is taken if there is one, so the cost on the ruler matches the range overlay. Per-user switch. Routes are found within the same frame, so the ruler and the range overlay never wait on a search.
- Tokens walk the spaces their route shows: every turn of a route is a waypoint, where core slides a token along the straight line between the two ends of a leg.
- The overlay follows the route as you drag: it re-centres on the route's end with the movement that is left, and dims the spaces the route has put out of reach.
- Tiles style for the overlay, after the look of Aeris Tokens: each reachable space is a rounded tile, the area has a soft pulsing glow round it and a slow shimmer across it, and the route being dragged is a lit strip with a ring on every step in place of core's line and squares (the distance label stays). The trail a token walks is drawn the same way: the dropped route stays, keeps its colour, and dims step by step behind the token; in combat the turn's movement so far shows as faint tiles. Following the HUD, the Tiles style is all shades of the device's main colour: bold nearest the token, each band further out 20% darker and fainter, with a fine line between bands. Every step of a route and of a trail is in the colour of the band its distance falls in. Per-user settings: Range style (Tiles or Flat), Animate the range, Light up the route.
- Reachable-space overlay while dragging, in bands, on square and hex grids. Honours walls, terrain cost, the grid's diagonal rule and whatever the game system adds to movement constraints.
- Speed presets for dnd5e, pf2e, sf2e, pf1, D35E, sfrpg, a5e and swade, plus a configurable data path and fallback speed for everything else.
- In combat, the range shrinks by movement already used this turn.
- Keybinding (M) to pin the selected token's range without dragging.
- GM-only hold key (G) that brings every player's view along with the tokens the GM moves. Players' movement never moves anyone else's view.
- Colour scheme, per user: Suit the game system (the default: green, yellow and red for the three Strides in Pathfinder and Starfinder 2e, the Character HUD's device everywhere else), Match my Character HUD, or My own colours.
- The diagonal rule comes from core's Square Grid Diagonals setting; under the alternating rules the count carries across a turn as core's ruler counts it.
- `getMovementRanges`, `getArmorClass` and `step` hooks and a small API for integrations.
