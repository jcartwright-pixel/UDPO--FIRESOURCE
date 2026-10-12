# How the Gallon Filler reader connects to our app

## The path of one jug

1. **On the line.** A jug passes the reader. The reader is either a barcode reader (option 1) or a camera that also reads the date (option 2). It reads the UPC, and with the camera it also reads the code date.
2. **The line PC.** A small computer near the line is plugged into the reader by network cable or USB. It runs a short program we write. Each time the reader sends "I read UPC 070852503050" (and the date), the program passes it on.
3. **Over the internet to our app.** The program sends each read to our app's server through a door we add for line readers. To use it, the program needs a line key, which an administrator makes on Line Targets (Make Line Key). With that key, a stranger can't send fake counts.
4. **The server.** For each read, the server does five things:
   - looks up the UPC on the plant's Products list (the UPC column on Line Targets) to know the product;
   - adds one to the shift's count;
   - starts a new product run on its own if the UPC changed;
   - checks the date against what it should be (today + shelf life);
   - counts reads with no barcode or no date as "unreadable" or "missing date".
5. **The screens.** Nothing new to build. The line's "Counted by" is set to **Label reader** on Line Targets. Then:
   - the tablet stops asking for typed counts and shows "Label reader on" and **CODE DATE OK / WRONG / MISSING**;
   - the board and the TV count up on their own;
   - the speed comes from the real jug counts, so TOO FAST / TOO SLOW is real.

Operators still tap **Line Stopped** and pick the reason. A reader can count jugs, but it can't tell why the line stopped.

## Should we wait for the model?

**No.** The screens are already built, and only the last step depends on the model: how the line PC talks to that reader. Every reader we listed can send its reads as plain text over the network, so the program on the line PC is short.

What I can build now, with no hardware:
- the server door for line readers, plus the line key on Line Targets;
- a **test feed**: a pretend reader that sends about 74 jugs a minute, wrong dates now and then, and a product change, so you can watch the tablet and TV work on the sandbox;
- the program for the line PC, ready except for the one setting that depends on the reader model.

When the reader arrives, the last steps are:
1. Plug it in.
2. Point the program at it.
3. Scan a few jugs to fill in their UPCs on Line Targets.
4. Switch "Counted by" to Label reader.

## Room to grow: Receiving

Joe, 10/11/2026: a Receiving side is coming, for raw milk and for products from outside suppliers checked in with a barcode scanner. It may not work like RedZone, with an operator reading and writing at a line. The reader setup is built so Receiving plugs in without redoing anything:

- **One door for every device.** The line PC sends to `deviceReads`, not to something only for lines. A receiving scanner will send to the same address, the same way.
- **Every device is tagged.** Each key belongs to one device, and the app keeps (with only the key's fingerprint, never the key) its **plant**, its **area** (Production now, Receiving later), its **kind** (line reader, camera or handheld scanner), **what it reads** (UPC, UPC and date, or a count) and **where it is** (the line, or later the receiving station).
- **Each area decides what reads mean.** Production counts jugs on the line's shift. Receiving will check items in against the load or the supplier. Until Receiving is built, a Receiving device's reads are turned away with "being built", so nothing lands in the wrong place.
- **The same PC program.** `tools/device-bridge` works with a fixed reader on the network or a USB handheld scanner that types into the PC.

What is not built yet: the Receiving screens and what a receiving scan should do. They start with lettered mock-ups when Joe asks.
