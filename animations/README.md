SONOMA ANIMATION PACKS
======================

An animation is a folder with an animation.json file and the images it uses. Drop the folder
into this directory (Settings > Animations > Open animations folder). Sonoma notices new and
edited packs within a second, so there is nothing to download or reinstall.

Folder names may only use lowercase letters, digits and hyphens, for example my-big-boom.
A folder here with the same name as a built-in pack replaces it.

Using your own art
------------------
1. Copy one of the built-in folders (ember-wyrm-burn, kaiju-clash...) into this directory.
2. Rename the folder, put your own PNG, WebP or SVG files in it.
3. In animation.json change each layer's "src" to your file name and the beam's "at" point
   (see below) so it leaves from your character's mouth.

animation.json
--------------
{
  "name": "Shown in Settings",
  "trigger": "songchange",        // "songchange", "idle", or "manual" (only the Animate button)
  "weight": 1,                    // higher = picked more often among packs with the same trigger
  "duration": 4300,               // total length in milliseconds
  "layers":  [ ...images... ],
  "effects": [ ...beams, particles, flashes... ],
  "record":  { "burn": [1150, 2500], "destroyAt": 2550, "returnAt": 3250 }
}

Coordinates
-----------
x and y are measured in "deck units": 0 to 1 spans the record player, so 0.5, 0.5 is the middle
of the record. Values below 0 or above 1 are off to the side, so (-0.3, 0.7) is left of the
deck. Sizes ("w", "radius", "width") use the same unit. Times are milliseconds from the start.
Colors are 6-digit hex like #ff6a2b.

Layers (images)
---------------
{ "id": "wyrm", "src": "ember-wyrm.svg", "flip": false,
  "keys": [ { "t": 0, "x": -0.3, "y": 1.2, "w": 0.8, "rot": 14 },
            { "t": 900, "x": -0.27, "y": 0.72, "ease": "backOut" } ] }

Each key sets the layer's centre (x, y), width (w), rotation in degrees (rot), opacity and
scale. Anything left out is carried over from the previous key. "ease" shapes the movement
that arrives at that key: linear, easeIn, easeOut, easeInOut (default), backOut (overshoot).
A layer is only visible between its first and last key. "flip": true mirrors it.
Draw images facing right and flip them for the other side.

Places ("from", "to", "at")
---------------------------
"record"                                  the middle of the record
[0.2, 0.5]                                a point in deck units
{ "x": 0.2, "y": 0.5 }                    same thing
{ "layer": "wyrm", "at": [0.93, 0.52] }   a spot on a layer, as a fraction of its image
                                          (0,0 = top left, 1,1 = bottom right). It follows
                                          the layer as it moves, so beams leave the mouth.

Effects
-------
beam       { "type": "beam", "from": P, "to": P, "start": 1000, "end": 2600, "grow": 380,
             "width": 0.045, "color": "#ff6a2b", "core": "#fff1c9", "sparks": true }
particles  { "type": "particles", "at": P, "start": 1000, "count": 60 }          (one burst)
           { "type": "particles", "at": P, "start": 1000, "end": 2000, "rate": 40 }   (steady)
           optional: "kind" ember | spark | shard | smoke, "colors": [...], "speed": [min, max],
           "size": [min, max], "life": [min, max] ms, "angle": [min, max] degrees (0 = right,
           90 = down, -90 = up), "spread": 0.1, "gravity": 0.5
flash      { "type": "flash", "start": 3000, "end": 3550, "color": "#ffffff", "alpha": 0.8 }
shockwave  { "type": "shockwave", "at": "record", "start": 3000, "end": 3800, "radius": 1.3, "color": "#ffd9a0" }
shake      { "type": "shake", "start": 3000, "end": 3500, "amp": 0.035 }

The record block (song-change packs)
------------------------------------
"burn": [from, to]   the record darkens and glows between these times
"destroyAt": 2550    the record shatters (debris is added automatically; "debris": false turns that off)
"returnAt": 3250     the new record drops in, wearing the new song's art

Tips
----
- Press the Animate button on the stage to preview a random pack, or edit and save a pack
  while the stage is open and press it again.
- If a pack has a typo it simply won't appear in the list. Check the JSON with any JSON validator.
