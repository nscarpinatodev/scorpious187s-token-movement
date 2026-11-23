# Step sounds

## Armor steps (`steps/`)

The sixteen files in `steps/` are mixed from three packs, all released by their authors into the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). CC0 asks for no credit; it is given here because the work is theirs.

| Pack | Author | Used for |
|---|---|---|
| [Footsteps Leather, Cloth, Armor](https://opengameart.org/content/footsteps-leather-cloth-armor) | HaelDB | The sound of what is worn: cloth, leather and plate |
| [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney (kenney.nl) | The footfall under each step |
| [RPG Sound Pack](https://opengameart.org/content/rpg-sound-pack) | artisticdude | The mail in the medium and heavy steps |

Each step is a footfall with the worn layer over it:

| Set | Footfall | Worn layer |
|---|---|---|
| `unarmored` | Softened (low-passed) | Cloth |
| `light` | As recorded | Leather |
| `medium` | As recorded | Leather and mail |
| `heavy` | With more bass | Plate and a trace of mail |

`tools/build-step-sounds.mjs` is the exact recipe and rebuilds the files from the unpacked packs.

## Hooves and wings (`steps/hooves-1.ogg`, `flight/wings-1.ogg`)

Both are made from recordings their authors released into the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

| File | Made from | By |
|---|---|---|
| `steps/hooves-1.ogg` | `grass.mp3` in [Horse gallop on different surfaces](https://opengameart.org/content/horse-gallop-on-different-surfaces), one stride cut from [SRS_Foley_Horse_Galloping.wav](https://freesound.org/people/StephenSaldanha/sounds/165532/) | congusbongus, from a recording by StephenSaldanha |
| `flight/wings-1.ogg` | [Large Wings Flap](https://opengameart.org/content/large-wings-flap), based on [fast simple chop 5](https://freesound.org/s/127197/) | AntumDeluge, from a recording by dave.des |

The pack the gallop comes from is offered as a whole under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), because two of its other clips need credit; its `credits.txt` gives this clip's source as CC0. The credit above is what CC BY asks for, so it is covered on either reading.

What was changed: the stride had seven ticks in it, a few milliseconds each and several times louder than the sound round them, which are turned down to the level of what surrounds them; nothing else about it is altered. The wing recording is one flap played three times, and one is kept. Both are levelled and faded at the ends. `tools/build-creature-sounds.mjs` is the exact recipe.

## Classic tap (`step-1.wav`, `step-2.wav`)

Synthesised by `tools/gen-sounds.mjs`. No third-party audio.
