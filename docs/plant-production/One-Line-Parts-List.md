# Gallon Filler outfeed: label reader parts list

**Where:** on the conveyor coming off the Gallon Filler, after the labeler and date coder.

**What you asked for:** read each jug's UPC so it counts and knows exactly what product is running, and read the printed code date to make sure it's there and correct.

## Plain answer: is it possible?

- **Reading the UPC: yes, this is common.** A fixed barcode reader mounted at the conveyor reads every label as the jug passes. Each read counts one jug and tells us the product. At about 74 jugs a minute that's well within what these readers do.
- **Reading the code date: yes, with a camera that reads printed text** (called OCR). It checks that the date is there, is readable, and matches what it should be today for that product. This is harder than the barcode, so it costs more and needs good lighting and setup.
- **One catch, my inference:** jugs often come down the line turned different ways. If the label or date faces away from the reader, it gets missed. Fixes are a second reader on the other side, a guide rail that turns jugs the same way, or reading the date where it's printed (cap or neck) instead of the label. Whoever installs it should look at the line first.
- **Optional later:** the camera can tell a kicker to push a jug with no date off the line. That needs a reject device and is not in the prices below.

## Option 1: UPC reader only (counts + product)

| Part | Example (any equal part works) | Rough price |
|---|---|---|
| Fixed-mount barcode reader, washdown model | Cognex DataMan 370 or 280, Keyence SR-X, Zebra FS40 | $1,500 to $3,500 |
| Mount, light if needed, cables | From the same supplier | $150 to $400 |
| Small plant computer (passes reads to our app) | Industrial mini PC or the reader's own network output | $300 to $600 |

**About $2,000 to $4,500.**

## Option 2: camera that reads UPC and code date (my pick)

| Part | Example (any equal part works) | Rough price |
|---|---|---|
| Smart vision camera with barcode + OCR | Cognex In-Sight 2800/3800, Keyence IV4 or CV-X, Omron FHV | $4,000 to $9,000 |
| Lens and LED light made for that camera | From the same supplier | $400 to $1,200 |
| Washdown housing and mount | From the same supplier | $300 to $800 |
| Small plant computer (passes reads to our app) | Industrial mini PC | $300 to $600 |
| Setup and teaching the date check | Supplier's application engineer (many do this with the sale) | $0 to $2,500 |

**About $5,000 to $14,000.**

## Either option also needs

| Part | Rough price |
|---|---|
| Line tablet (operator picks why the line stopped), e.g. Samsung Galaxy Tab Active5 or a regular tablet in a rugged case | $250 to $550 |
| Line TV, 43 to 50 inch, plus a Fire TV Stick or Chromebox | $300 to $450 |
| 24 volt power, washdown box, cable, network jack from IT | $150 to $300 |

## How the date check works in our app

Each product gets a **shelf life** on the Line Targets page. The app works out what today's code date should be, and the camera reports what it read. The tablet and TV turn red when a jug has **no date**, an **unreadable date** or the **wrong date**.

## Cheapest start

If you want to start cheap, a $150 photo-eye counts jugs but can't tell the product or the date. The operator would then pick the product on the tablet.

Prices are typical list prices I know of, not quotes. Cognex, Keyence and Omron all have local reps who will come look at the line for free and quote it. Ask them for "barcode and OCR code-date verification on a gallon line at about 75 per minute, washdown."
