# Plant Production: replacing RedZone

Notes for building our own production tracking (Joe, 10/11/2026).

| File | What it is |
|---|---|
| [How-RedZone-Works-and-Our-Options.md](How-RedZone-Works-and-Our-Options.md) | How RedZone works (sensors, tablets, TV) and the options for doing it ourselves. Joe picked option B: tablet counts and stops on every line, plus automatic counts on the Gallon Filler. |
| [Gallon-Filler-Test-Parts.md](Gallon-Filler-Test-Parts.md) | Budget parts list for the Gallon Filler test run. Option 1 reads the UPC only (about $1,000 to $2,100). Option 2 reads the UPC and the code date with a camera (about $2,100 to $6,600). The recommendation is option 1 first. |
| [One-Line-Parts-List.md](One-Line-Parts-List.md) | The first, fuller parts list for one line, with the vendor washdown reader and the vendor smart camera. Use it for full production. |
| [Gallon-Filler-Copy-Paste-List.md](Gallon-Filler-Copy-Paste-List.md) | The short list for both options, who to ask for quotes and what to tell them, in one block to copy and paste. |
| [How-The-Reader-Connects.md](How-The-Reader-Connects.md) | In plain words: how a jug read on the line reaches the tablet, the board and the TV, and why we do not need to wait for the reader model. |
| [Reader-For-Each-Machine.md](Reader-For-Each-Machine.md) | Every Uniontown machine: which reader fits it, where it mounts, and the sandbox test feed each line already has. The Gallon Filler is the only line marked for real hardware so far. |

The screens are in the app under Plant Production: Production Lines (`public/production.html`, with `?tv=1` for the TV), Line Tablet (`public/line.html`) and Line Targets (`public/linetargets.html`).

The label reader: the line PC program is in [tools/line-reader](../../tools/line-reader/README.md). It posts reads to the `lineReads` function (`functions/src/reader.js`). On Line Targets, an administrator sets Counted by to Label reader, makes the line key, and on the sandbox can start a test feed on one line or on every line, which sends pretend pieces every minute at each line's own products' full speed.

Prices are typical list prices, not quotes.
