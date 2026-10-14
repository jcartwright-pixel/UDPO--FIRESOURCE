# How the Blow Mold's own controller connects to our app

Joe, 10/14/2026: read the Blow Mold straight from its own controller (the PLC in the machine's cabinet), not through RedZone. Record the three things he named: the **jug count**, the **speed** and the **temperature**.

## Read-only, always

The app only **asks** the controller for three numbers. The program on the line PC is built from the controller's *read* requests only. It has no way to send a write, so it cannot change a setting, start or stop the machine, or move anything. A unit test checks the bytes it sends.

## The path of one reading

1. **The controller.** The machine already keeps a running jug count, its speed and a temperature in its controller's memory, each one at a tag name or register number.
2. **The line PC.** A small computer on the plant network runs `bridge.cjs --controller`. Every 5 seconds it reads the three numbers and sends them to our app with the line's key.
3. **The server.** It counts the jugs made since the last reading on the shift. If the machine's counter goes down, the counter was reset, and the new number is all new jugs. It keeps the speed and temperature, marks them high or low against the range on Line Targets, and logs one reading a minute for the hour by hour.
4. **The screens.**
   - The Blow Mold tablet shows **From the machine** with the jug count, speed and temperature. A reading outside its range flashes red: TOO HOT, TOO COLD, TOO FAST or TOO SLOW.
   - Production Lines shows the readings on the card, and the line's shift view shows the shift's low and high and the minutes outside the range.
   - The hour by hour shows the average speed and temperature for each hour.
   - No jugs for 3 minutes means the line stopped. The operator still taps why.

## What we need from the machine (the nameplate photo)

On **Line Targets**, pick BLOW MOLD and set **Counted by** to **Machine controller (read-only)**. Then fill in:

| Box | Where it comes from |
|---|---|
| Brand | The nameplate on the controller in the cabinet. Allen-Bradley ControlLogix or CompactLogix, Allen-Bradley Micro800, Siemens S7, or Modbus TCP (many other brands speak it). |
| IP address | The controller's network address. Maintenance or the machine supplier knows it, and it is often on the HMI's network screen. |
| Where each reading is | The tag name (Allen-Bradley, like `Jug_Count`), the register number (Modbus, like `40001`) or the address (Siemens, like `DB10.DBD4`). The machine supplier or the person who programs the PLC can tell us. |
| Divide by | Use it when the controller sends 4312 for 431.2°F. Then type 10. |
| Low and high | The range the production manager wants for speed and temperature. |

Each reading has a **Test read** button. It asks the line PC to read that number now, and shows what came back, or why it couldn't read it.

A Siemens S7-1200 or S7-1500 also needs **PUT/GET** allowed, and **optimized access** turned off on the data block that holds the numbers. The supplier sets that. It does not change how the machine runs.

## Start the line PC

1. On Line Targets, press **Make Line Key** in the Machine controller box, and copy the key. It is shown only once.
2. On the line PC (Node 18 or newer, nothing else to install), run the line shown under the key:

```
node bridge.cjs --address <address> --device ut_prod_blow_mold --key <key> --controller
```

The line PC needs to reach the controller on the plant network and the internet. It takes the brand, IP address and tags from Line Targets, so a change there needs no change on the PC.
