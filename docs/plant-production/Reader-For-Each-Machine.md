# A reader for each Uniontown machine

Joe, 10/11/2026: "right now we're just going to do the gallon filler, but all the machines that we have listed, let's build models for those."

**Every machine already has a test setup on the sandbox.** On Line Targets, an administrator can press **Start Test Feed (1 hour)** on any line, or **Test Feed on Every Line**. Pretend pieces then come in at that line's own products' full speed (from the Products list), so the tablet, Production Lines and the TV count each line on their own. A line counted by typing switches to Label reader for the test and goes back when the feed stops. Nothing here is bought yet. **The Gallon Filler is the only line marked for real hardware right now.**

The two options are the same as for the Gallon Filler (see [Gallon-Filler-Test-Parts.md](Gallon-Filler-Test-Parts.md)):
- **Option 1, UPC only:** a fixed barcode reader counts each piece and knows the product. About $1,000 to $2,100 a line.
- **Option 2, UPC and code date:** a smart camera also reads the printed date and checks it. About $2,100 to $6,600 a line.

Prices are typical list prices, not quotes. Speeds are RedZone's full speeds for the line's products.

| Machine | What passes | Speed | Reader that fits | Where it mounts | Notes |
|---|---|---|---|---|---|
| **Gallon Filler** (first, real hardware) | Gallon jugs with label UPC and printed code date | 50 to 80 a minute | Option 1 to start, option 2 later | Side of the conveyor just after the capper and labeler, in a splash shield, reading the label as the jug passes | The test unit. Check which way the label faces and where the date prints. |
| **New 1/2 Gallon** | Half gallon cartons | 70 to 120 a minute | Option 1, or option 2 to check the date | Over or beside the carton conveyor after the filler's date coder | Faster line: ask the supplier for a reader rated for about 2 a second, and a photo-eye trigger. |
| **Old 1/2 Gallon** | Half gallons, quarts, pints | 70 to 120 a minute | Option 1, or option 2 | Same place as the New 1/2 Gallon, after the date coder | Mixed sizes: mount at a height that sees the smallest carton's UPC, or use a camera with a wider view. |
| **Boxing** | 2.5 and 5 gallon bag-in-box | 8 to 12 a minute | Option 1 | Beside the take-away conveyor after the box is closed, reading the box label | Slow line: the cheapest reader is plenty. Option 2 only if the date is printed on the box. |
| **Raypak** | 2.5 and 5 gallon bags | 8 to 12 a minute | Option 1 | After the bag filler, reading the bag or box label | Same products as Boxing; the same reader model keeps spares simple. |
| **Totes** | Totes | About 1 a minute | Option 1 handheld, or no reader | A handheld scanner at the tote station, scanned as each tote is filled | Too slow for a fixed reader to pay off. A $100 to $250 handheld scanner on the line PC, or keep typing the count. |
| **HTST #1** and **HTST #2** | Milk flowing in a pipe, no packages | (follows the fillers) | No label reader | Nothing to read: there is no label | Count from the fillers it feeds, or later read the HTST's own flow meter or recorder (option 1 of the RedZone write-up: read the PLC). Keep typed for now. |
| **Blow Mold** | Empty gallon bottles, no label yet | About 50 a minute | Photo-eye counter, not a UPC reader | On the bottle conveyor leaving the blow molder | No UPC on an empty bottle. A $100 to $250 photo-eye counts bottles; a camera could check for bad bottles later. |

## What it takes per line, once the Gallon Filler test works

1. Buy the reader for that line (the table above).
2. Mount it and plug it into a line PC. One small PC can serve two lines that are close together.
3. Run the line PC program from [tools/line-reader](../../tools/line-reader/README.md) with that line's key from Line Targets (**Make Line Key**).
4. Scan a few of each product to fill in the **UPC on label** column on Line Targets.
5. Set **Counted by** to **Label reader**.

The screens, the server, and the stop and date checks are the same for every line, so nothing new is built per machine.
