# How the case counters connect to our app

Joe, 10/22/2026: a case counter right before the palletizer (the United Dairy Case Counter Hookup Guide), and later a second one where the case returns come out of the trailers. Joe, 10/23/2026: "the cases need to be put in prior to loading. And then the case counter counts and does a comparison."

## What it does

- **Cases Out is typed before loading**, the same box as today on Daily Case Loadout.
- **The counter counts while the load is loading.** A **Counted** column beside Cases Out counts up in blue: "486 of 612 · counting".
- **When the load is done**, Counted turns green **matches**, or red with the difference: **short 12** or **over 8**. It stays red.
- **The top line** shows the cases counted on the day's loads, how many loads match, and the loads that are off in red. **Case counter not sending** shows in red if the plant PC goes quiet for 2 minutes while a load is loading.
- **The counter never changes Cases Out.** What it counted is kept on its own, so the typed number stays what the loader typed.
- **Case Returns** works the same way on **Unloading & Washing**. The cases go on the trailer being unloaded, beside **Cases In**.
- The Counted column only shows once a counter is set up, and only on Cases.

Which load gets the cases: the Case load that is **loading** now (not paused). If two are loading, the one started last gets them. Cases counted while nothing is loading are kept for the day, and Administration > Case Counters shows how many.

## Read-only, always

The plant PC only **asks** the counter box for one number, its running case total. The program has only *read* requests, so it cannot change anything on the counter box. The guide's step that sends counts to the old Apps Script app is not used: the old app is off, and the counts go to the Operations app.

## For whoever sets up the counter box (the PLC)

The guide's PLC program (steps 1 to 5) stays the same. The app needs only one thing from it:

1. **Keep one running total of the cases counted**, in one 32-bit register that only goes up (a retentive counter, kept through a power loss). On the CLICK PLC in the guide, use **DD1**. Its Modbus address is **416385**.
2. Count each stack by its number of cases (1 to 6), once per stack, as the guide says. A stack the PLC is not sure about should not be added to the total.
3. Leave Modbus TCP on (port 502) and give the PLC a fixed IP address on the plant network. No internet access is needed on the PLC.

If the total is ever reset to 0, that is fine: the app counts from the new number.

## Set it up in the app (an administrator)

Go to **Administration > Case Counters**. There is a box for **Palletizer** and one for **Case Returns**. Each box saves as you leave it.

| Box | What to type |
|---|---|
| Brand | **Modbus TCP (many brands)** for the CLICK PLC. |
| IP address | The PLC's fixed IP address. |
| Port | Leave empty (502). |
| Unit id | Leave empty (1). |
| Where the case total is | **416385** (DD1 on the CLICK). |
| Size | Leave empty (32 bits). |
| Word order | **Low word first** for the CLICK's DD registers. If Test read shows a strange, huge number, switch it to High word first. |

Press **Test read**. The plant PC reads the total now and the number shows next to the button.

## Start the plant PC

1. Press **Make Counter Key** and copy the key. It is shown only once.
2. On the plant PC (any always-on Windows PC on the plant network, or the Raspberry Pi from the guide, in a dry spot), install Node 18 or newer and copy the `tools/device-bridge` folder onto it.
3. Run the line shown under the key. It looks like this:

```
node bridge.cjs --address https://us-east4-ud-distribution.cloudfunctions.net/deviceReads --device palletizer --key <the key> --controller
```

It reads the counter box every 5 seconds and sends the total. If the internet drops, it keeps reading and the new cases are counted on the next send. Set it to start when the PC starts (Windows Task Scheduler, "At startup").

The Case Returns counter is the same, with `--device case_returns` and its own key. One plant PC can run both, as two copies of the program.

## Try it first

Run a supervised trial as the guide says: type Cases Out before each load, load it, and compare the Counted column to a hand tally before relying on it.
