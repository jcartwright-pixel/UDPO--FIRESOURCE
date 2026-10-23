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

## A machine's own controller (read-only)

For a machine whose controller already keeps the count (Joe 10/14: the Blow Mold), run with `--controller` in place of `--reader`:

```
node bridge.cjs --address <address from Line Targets> --device ut_prod_blow_mold --key <key> --controller
```

On **Line Targets**, set **Counted by** to **Machine controller (read-only)**. Then pick the brand, type the IP address and where the jug count, speed and temperature are, and set the speed and temperature ranges. Each reading has a **Test read**. The program picks up the setup with its key, reads every 5 seconds, and sends the numbers.

`controllers.cjs` speaks Allen-Bradley EtherNet/IP (ControlLogix, CompactLogix and Micro800 tags), Modbus TCP (holding and input registers, plus on/off inputs: discrete inputs `DI 0` or `10001`, coils `COIL 0` or `00001`) and Siemens S7 (data block and memory addresses, plus bits like `DB10.DBX4.0`, `M2.1` or `I0.3`). It has only the read requests, so nothing is ever written to the machine. The plain-words version is in [docs/plant-production/How-The-Blow-Mold-Controller-Connects.md](../../docs/plant-production/How-The-Blow-Mold-Controller-Connects.md).

## Add-on sensors on a filler (read-only)

For a filler counted by its label reader (Joe 10/14: the Gallon Filler, sensors B), a small Modbus TCP I/O module can add a **motor running** input (a current switch on the motor wire) and a **jugs in** counter (a photo-eye on the infeed). On **Line Targets**, the filler shows **Add-on sensors · read-only** under any **Counted by**. Type the module's IP address and the two inputs, then press **Test read**.

Run a second copy of the program with `--controller` and the **same key** as the label reader:

```
node bridge.cjs --address <address> --device ut_prod_gallon_filler --key <the label reader's key> --controller
```

When the motor switch goes off, a stop opens on the tablet (by "motor switch"), and it ends when the motor runs again. Rejects and spills = jugs in minus jugs the label reader counted. The add-on sensors never count jugs themselves, and nothing is written to the module.

## Case counters (read-only)

For the case counter boxes (Joe 10/22: right before the palletizer, and later on the case returns), run with `--controller` and the counter's id as the device:

```
node bridge.cjs --address <address> --device palletizer --key <the counter key> --controller
node bridge.cjs --address <address> --device case_returns --key <the counter key> --controller
```

The setup and the key are on **Administration > Case Counters**: brand (Modbus TCP for the CLICK PLC), IP address and where the running case total is, with a **Test read**. The program reads the total every 5 seconds; the server puts the new cases on the Case load being loaded or the trailer being unloaded, beside Cases Out or Cases In (`functions/src/casecounter.js`). The plain-words version is in [docs/plant-production/How-The-Case-Counter-Connects.md](../../docs/plant-production/How-The-Case-Counter-Connects.md).
