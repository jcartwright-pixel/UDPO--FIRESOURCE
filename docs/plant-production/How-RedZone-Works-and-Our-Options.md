# Replacing RedZone: how it gets its numbers, and how we could do it

## 1. How RedZone actually gets its data

RedZone is mostly not sensors. It is mostly people typing on tablets, with machine counts added on lines where someone wired them in.

| What you see in RedZone | Where it comes from |
|---|---|
| Cases / units made | Either an operator types the count on the line tablet (every hour or end of run), **or** a machine count comes in automatically. The automatic part is "RZLogger" (named in their help pages): a small program or box that reads a count from the filler/caser controller (PLC) or from a photo-eye sensor and sends it to RedZone over the internet. |
| Running / stopped (downtime) | If counts are automatic, RedZone sees the count stop and starts a downtime clock. An operator then picks the **reason** on the tablet (from your "Places & Downtime" list). If counts are manual, the operator enters the downtime and reason by hand. |
| Targets / how far behind | Typed in once by you: Product Targets (cases per hour per product) and Shift Patterns. RedZone just compares count against target. |
| Line TVs | A plain TV with a cheap stick computer or smart TV browser showing a RedZone web page. Nothing special. |
| Quality / compliance checks | Checklists filled out on the tablet. |
| Supervisor reviews, triggers | Rules on top of the data above ("if behind 10%, alert supervisor"). |
| Reports, Snowflake/AWS | Their copy of all the above, for exports. |

**What I could confirm vs. what is my inference:** RedZone's public pages only confirm it runs on Android/iPhone tablets, phones and TVs, and covers productivity (OEE), compliance checksheets, maintenance, training and scheduling. Their help site (which names RZLogger) is blocked from my computer, so the details of how RZLogger connects are my inference from how every system like this works. The quickest way to know for sure what Uniontown has: walk the filler and caser and look for a small box or wire labeled RedZone / RZLogger, or ask whoever set RedZone up "are our counts automatic or typed in?"

## 2. What United Dairy would need to copy it

**Software (we build it, in the new app, under the Plant Production card):** line tablet screen, downtime reasons, targets, line TVs, shift reports. No license fee.

**Hardware, only for automatic counts** (rough prices, each line):

| Piece | What it does | Rough cost |
|---|---|---|
| Option 1: read the PLC | If the filler/caser already counts (most do), a small gateway reads that number over the network. Needs your controls/maintenance person or the machine vendor to say where the count lives. | $300 to $1,000 per gateway (one gateway can read several machines) |
| Option 2: add a sensor | A photo-eye pointed at the conveyor after the caser counts each case going by. Works on any machine, no PLC touching. | $100 to $250 sensor + mount, wired to a $150 to $400 counter box with Wi-Fi/network |
| Line tablet | Operator picks downtime reason, enters counts if manual | $150 to $400 each (rugged case extra) |
| Line TV | Shows count vs target | $200 to $400 TV + $50 stick computer |
| Install | Electrician to run sensor wire and power | Your maintenance staff, or contractor |

So a line with automatic counts is roughly **$700 to $2,000 of hardware**, and a line that stays manual is just a tablet. The gateway sends counts to our app the same way MOCREO sends temperatures today.

## 3. What our app already has

- **Products** per plant with Areas (Boxing, Totes, Tanker, Cases) and Groups (Drinks, Milks, Teas): this is RedZone's product list. We can pull the 154 RedZone products once their admin gives us the API key.
- **Plant Shifts** with the Plant Production side: this is RedZone's Shift Patterns.
- **Production Line Status & Quality**: line status and quality checks, like RedZone Compliance.
- **Shift Notes, Shift Reports, Manager Center, Send Current Report**: like RedZone's supervisor reviews and huddles.
- **Plant Performance** kiosk page and **Plant Station** tablet links: the start of line TVs and line tablets.
- **MOCREO sensors**: we already take readings from sensors over the internet, the same pattern automatic counts would use.
- **Plant Maintenance card** (being built): where operator breakdown calls would go.

**What is missing:** product targets (cases per hour), the line tablet count/downtime screen, downtime reason list, the live count-vs-target TV, and the machine count connection.

## 4. How far to go (pick one)

- **A. Tablet first.** Line tablet screen where operators enter counts each hour and pick downtime reasons; product targets; line TVs showing count vs target; shift production report. No new hardware except tablets/TVs. Runs alongside RedZone until you trust it.
- **B. A, plus automatic counts on one line.** Same as A, then put one gateway or photo-eye on one line (your pick, for example the quart filler) so counts and downtime start on their own, and operators only pick the reason. Prove it before buying for the rest.
- **C. Full replacement.** A and B on every line, plus the RedZone extras you use (supervisor alerts, compliance checklists, maintenance requests from the line), then cancel RedZone.
- **D. Read RedZone for now.** Pull RedZone's numbers into our app through their API (keys you're already chasing) and show them on our screens, and only build our own once you've seen it side by side.

**My recommendation: B.** A gets every line covered with no wiring; one automatic line proves the hardware before you spend more, and you can keep RedZone running until our numbers match theirs.

## Sources
- [RedZone product page](https://www.rzsoftware.com/product)
- [RedZone on iOS and Android](https://www.rzsoftware.com/redzone-delivers-real-time-line-visibility-on-ios-and-android)
- [RedZone on Capterra](https://www.capterra.com/p/176109/Redzone/)
