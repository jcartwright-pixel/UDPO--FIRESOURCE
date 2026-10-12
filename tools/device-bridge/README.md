# Device PC program: label readers now, receiving scanners later

`bridge.cjs` runs on the small PC next to a reading device. Today that is a production line's label reader; later it can be a Receiving station's handheld scanner (see Room to grow in the docs). It passes every piece the device sees to the app. The plain-words version is in [docs/plant-production/How-The-Reader-Connects.md](../../docs/plant-production/How-The-Reader-Connects.md).

## Set up

1. On **Line Targets**, pick the line and set **Counted by** to **Label reader**.
2. Press **Make Line Key** and copy the key. It is shown only once. The panel also shows the address to send to. A line reader's device id is its line id.
3. Set the reader to send each read as one line of text: `UPC`, or `UPC,DATE` for a camera that reads the code date. Have it act as a TCP server on a port.
   - Cognex, Keyence, Datalogic, Zebra and Hikrobot all have this setting. The supplier can set it up.
4. Install Node 18 or newer on the line PC, then run:

```
node bridge.cjs --address <address from Line Targets> --device <device id, e.g. ut_prod_gallon_filler> --key <key> --reader <reader IP>:<port>
```

To try it without a reader, use `--stdin` in place of `--reader` and type UPCs, one per line. A USB handheld scanner types into `--stdin` the same way.

## What happens

- **Counting:** each read counts one jug on the shift. The tablet, Production Lines and the TV update on their own.
- **Product:** the UPC finds the product on the plant's Products list (the **UPC on label** column on Line Targets). A new UPC starts a new product run.
- **Code date:** the date read is checked against the shift's day plus the product's shelf life. The tablet shows CODE DATE OK or CODE DATE WRONG, and counts missing and unreadable dates.
- **Stops:** if no jugs come for 3 minutes, the line shows **stopped**, and the operator taps why on the tablet. When jugs come again, the stop ends.
- **If the network drops:** reads that could not be sent are kept and go out with the next send.
