# Gallon Filler test run: parts, budget first

Two choices for the test on the Gallon Filler outfeed (about 74 jugs a minute):

- **Option 1, UPC only:** counts every jug and knows the product.
- **Option 2, UPC + code date:** does the same and also reads the printed date.

Each option has a **cheapest workable** build and a **vendor** build.

Prices are typical list prices I know of, not quotes. Get a quote before buying.

## What our app already covers (no cost)

- Counting, product, speed, target %, behind/ahead, and stops with reasons.
- The Line Tablet, the Production Lines board and the TV board are already built.
- **The tablet and TV are optional for the test.** Any existing PC, laptop or TV near the line with a web browser works.

The only new software is a small program on the line PC that sends each read to our app.

## Option 1: UPC only (counts + product)

### 1A. Cheapest workable (my pick for the test)

| Part | Example | Qty | Rough price |
|---|---|---|---|
| Low-cost fixed-mount barcode reader | Zebra FS10, Datalogic Matrix 120, or Cognex DataMan 150 | 1 | $700 to $1,500 |
| Splash shield (clear polycarbonate box with a window) | Generic | 1 | $50 to $100 |
| Mounting bracket (aluminum frame, clamps) | 80/20 aluminum or the reader's own bracket | 1 | $60 to $120 |
| 24 V power supply and cable | Generic DIN-rail 24 V | 1 | $40 to $80 |
| Line PC (sends each read to our app) | Raspberry Pi 5 kit or a used mini PC | 1 | $120 to $250 |
| Network cable or Wi-Fi to the plant network | From IT | 1 | $0 to $50 |

**Total: about $1,000 to $2,100.**

**Wet line reliability: good.** A barcode is easy to read. The reader just needs to stay out of direct spray.

### 1B. Vendor washdown reader

| Part | Example | Qty | Rough price |
|---|---|---|---|
| Washdown-rated (IP65/IP67) fixed reader | Cognex DataMan 280/370, Keyence SR-X | 1 | $1,500 to $3,500 |
| Mount, cable, power | Same supplier | 1 | $150 to $400 |
| Line PC | Industrial mini PC | 1 | $300 to $600 |

**Total: about $2,000 to $4,500.**

**Wet line reliability: best.** It can be washed down with the line.

### Do-it-ourselves version: not recommended

A handheld-style "presentation" scanner, such as a Zebra DS9308 or Honeywell 7980g, costs only $250 to $400. It isn't made for a moving line or for wet areas, so it would miss jugs and fail early. 1A costs only a few hundred dollars more and is built for this job.

## Option 2: UPC + code date (camera)

### 2A. Cheapest workable: entry smart camera

| Part | Example | Qty | Rough price |
|---|---|---|---|
| Entry smart camera with barcode + text reading (OCR) | Hikrobot SC2000 or SC3000 series, Datalogic Smart-VS / P-Series, Cognex In-Sight 2800 (low end) | 1 | $1,500 to $5,000 |
| Lens + LED light | Same supplier | 1 | $200 to $600 |
| Splash housing + mount | Same supplier or generic | 1 | $150 to $400 |
| Photo-eye to trigger each jug | Banner, SICK, or Omron | 1 | $60 to $150 |
| 24 V power + cable | Generic | 1 | $40 to $80 |
| Line PC | Mini PC | 1 | $150 to $400 |

**Total: about $2,100 to $6,600.**

**Wet line reliability: fair to good.** The camera reads the barcode reliably. The date is harder: inkjet dots on a curved, sweaty jug need good light and some tuning. Ask the supplier to set up the date reading as part of the sale.

### 2B. Do-it-ourselves camera

| Part | Example | Qty | Rough price |
|---|---|---|---|
| Industrial USB3 camera | Basler ace, FLIR Blackfly, or Hikrobot | 1 | $300 to $600 |
| Lens | Same brand | 1 | $100 to $250 |
| LED bar light | Generic machine-vision light | 1 | $150 to $400 |
| Photo-eye trigger | Banner or SICK | 1 | $60 to $150 |
| Enclosure + mount | Generic | 1 | $150 to $350 |
| Line PC with enough power to read images | Mini PC, Core i5 or better | 1 | $400 to $700 |
| Our own software (barcode + date reading) | We write it | 1 | $0 parts |

**Total: about $1,200 to $2,500.**

**Wet line reliability: weakest.** Reading the barcode is fine. Reading the date ourselves means weeks of tuning on the real line. Fog, splashes and turned jugs will cause misreads. It is cheapest on paper, but it is the most likely to disappoint in a test.

### 2C. Vendor smart camera

| Part | Example | Qty | Rough price |
|---|---|---|---|
| Smart camera with barcode + OCR | Cognex In-Sight 3800, Keyence IV4 or CV-X, Omron FHV | 1 | $4,000 to $9,000 |
| Lens, light, washdown housing | Same supplier | 1 | $700 to $2,000 |
| Line PC | Industrial mini PC | 1 | $300 to $600 |
| Setup of the date check | Supplier engineer | 1 | $0 to $2,500 |

**Total: about $5,000 to $14,000.** This is the full-production choice, not the test.

## Side by side

| | Counts + product | Reads date | Test-run cost | Wet line |
|---|---|---|---|---|
| **1A low-cost fixed reader** | Yes | No | **$1,000 to $2,100** | Good |
| 1B washdown reader | Yes | No | $2,000 to $4,500 | Best |
| **2A entry smart camera** | Yes | Yes | **$2,100 to $6,600** | Fair to good |
| 2B do-it-ourselves camera | Yes | Yes, with lots of tuning | $1,200 to $2,500 | Weakest |
| 2C vendor smart camera | Yes | Yes | $5,000 to $14,000 | Best |

## My pick

**Start with 1A, about $1,000 to $2,100.**

- It proves the counts, product and speed on the board for the least money.
- Mount it so a camera can go beside it later.
- Until then, the operator keeps checking the date by eye.
- If the test goes well, add **2A** for the date. The 1A reader keeps working next to it.

**Things to check on the line first:**

- Which way the jugs face when they pass.
- Where the date is printed (label, cap or neck).
- That there is a network jack or Wi-Fi nearby.

Ask the supplier for this: "Fixed barcode reader on a gallon line at about 75 per minute, wet area, test unit." Many suppliers will lend or demo a reader for a test.
