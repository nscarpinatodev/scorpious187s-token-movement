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

## Classic tap (`step-1.wav`, `step-2.wav`)

Synthesised by `tools/gen-sounds.mjs`. No third-party audio.
