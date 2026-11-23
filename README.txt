SONOMA WEB
==========
Upload every file in this folder (keep the animations folder) to any static website host,
for example GitHub Pages. Then:

1. In developer.spotify.com/dashboard open your app > Settings > Redirect URIs and add the
   exact address of the page, including the final slash, for example
   https://YOURNAME.github.io/sonoma/
2. Open that address on your phone or PC, paste your Client ID, and press Connect Spotify.

Wallpaper layout: add ?wallpaper=1 to the address, for example
https://YOURNAME.github.io/sonoma/?wallpaper=1
Use that address as an interactive wallpaper in Lively Wallpaper.

Adding animations: put a new pack folder next to the others inside "animations", then add its
folder name to animations/index.json. The format is described in animations/README.md.
