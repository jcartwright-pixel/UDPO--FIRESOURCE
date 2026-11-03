# United Dairy Hub

How to change this help: each part starts with `## Name`, then `id:` and `screens:` lines; numbered steps, `### Buttons`, `> ` for a tip and `!> ` for a "Do not" line. Plain words, made-up names only.

## Home
id: home
screens: index.html

The **United Dairy Hub** is the one place to sign in and open every United Dairy app. Sign in with the same United Dairy Google account as Operations. You see a tile for each app you are allowed to use.

1. Press `Sign in with Google` and pick your United Dairy account.
2. Press an app's card. It opens in a new tab, so the hub stays open for the next one.
3. To get the hub as its own app on your computer, press `Install the app` in Chrome or Edge.

### The apps
- **Plant & Distribution** (the Operations app): dispatch, the plant floor, fleet, schedules and plant reports.
- **Customers & Routes** (the Customer List): every customer, delivery route and day, the route book and truck load maps.
- **Fuel Tracking** (the Fuel app): monthly fuel use, fuel prices, tank deliveries and trip fuel.
- **Employees & Compliance** (UDMS): employee records, driver qualification, accidents, workers' comp and hiring.

### Which cards you see
- **Plant & Distribution** and **Customers & Routes**: everyone who is active on the Users list.
- **Fuel Tracking** and **Employees & Compliance**: administrators. Employees & Compliance keeps its own access list too, so it checks again when it opens.

> Administrators also see **Administration** on Home: **People & Access** is where people are added and changed, **Roles & Rights** is what each role may do, and **Links & Codes** has every link and code for managers, stations and drivers' phones.

!> Do not share the hub's link with anyone outside United Dairy: only United Dairy Google accounts can sign in.

## People & Access
id: people
screens: people.html

**People & Access** is the one list of who can sign in to the United Dairy apps: their role, their plants, and which apps they can open. It is the same Users list as **People & Roles** in Plant & Distribution, saved the same way, so a change here is a change in every app. Administrators only.

1. Find a person with **Find** (part of a name or email), **Role**, or **Enabled / Disabled**.
2. **Which apps each person opens:** every line has a tick box for each app (Plant & Distribution, Customers & Routes, Fuel Tracking, Employees & Compliance), ticked for what they can open now. Tick or untick one and it saves at once; a green line says what changed.
3. Press a person's name to open their details on the right.
4. Change their **Role**, their **Plants** (tick **All plants**, or each plant), or turn their account **Enabled** or **Disabled**. **Apps they can open** has the same tick boxes, saved with `Save`.
5. Under **What they see in Plant & Distribution**, pick the **Plant**, then tick a whole area or press `Show screens` and tick single screens. **Start from a job** ticks the screens that job usually needs; change them after. Nothing ticked yet means they see every screen their role allows.
6. Pick their **Home screen**: the page they land on when they open Plant & Distribution.
7. To change one right for this person only, open **Single rights** and pick `Allow` or `Deny` (or `Use role`). The last column shows what they will get.
8. Press `Save`.
9. To add someone, press `+ Add Person`, type their name and United Dairy email, pick a role and plants, then press `Add Person`. Open them again to pick their screens and Home screen.

### Buttons
- `+ Add Person`: a new person on the Users list.
- `Show screens` / `Hide screens`: the single screens of one area.
- `Save`: saves the person for every app.
- `Cancel`: closes the person without saving.

> Everything People & Roles in Plant & Distribution does is here, saved to the same place, so either page shows the same answer.

> Until an app is ticked or unticked for someone, they get the standard apps: everyone Enabled gets Plant & Distribution and Customers & Routes; Administrators also get Fuel Tracking and Employees & Compliance.

> Plant & Distribution is always ticked for everyone Enabled. To keep someone off part of it, untick screens under **What they see in Plant & Distribution**. Employees & Compliance still checks its own list too, so its tick only shows or hides the card on their Home.

!> You cannot untick your own apps. Ask another administrator.

!> Do not disable someone to hide a screen from them. Untick the screen instead.

!> Do not disable someone to take away one app. Change their role instead; Disabled shuts them out of every app.

!> The primary administrator always stays an Enabled Administrator; the hub will not let that change.

## Roles & Rights
id: roles
screens: roles.html

**Roles & Rights** says what each role (Manager, Supervisor, Dispatcher, Driver and the rest) may do in Plant & Distribution. Each column is a role and each line is one thing a person may do. It is the same list as **Role Templates** in Plant & Distribution, saved to the same place. Administrators only.

1. Find the line you want, by its group (Dispatch, Drivers, Plant Operations...) or with **Find a right**.
2. Tick the box under a role to let that role do it, or untick it to take it away. It saves at once, and a green line says what changed.
3. The change reaches everyone with that role the next time they open a screen. The number under each role says how many Enabled people have it.
4. To add a role, press `+ Add Role`, type its name, pick a role to copy the ticks from (or **Nothing ticked**), then press `Add Role`. Give it to people in **People & Access**.

### Buttons
- `+ Add Role`: a new role. `Cancel` closes it without adding.
- `Use standard`: puts a role back to the rights it came with. It shows only on a role that has been changed.

> To change one person without changing their whole role, open them in **People & Access** and use **Single rights** there.

> **Administrator** is locked with everything ticked: an Administrator can always do everything.

!> Do not untick a right from a role to stop one person. Use **Single rights** on that person instead; a role change reaches everyone with that role.

!> Do not make a new role for one person. Give them the closest role and change their single rights.

## Links & Codes
id: links
screens: links.html

**Links & Codes** has every link and code people use to reach Plant & Distribution: the managers' links, the Plant Managers App, the Sales App, the plant, garage, maintenance and Driver Room tablets, and the drivers' phone code. It is the same list as **Links & Codes** in Plant & Distribution's Administration, saved to the same place, so every code already given out keeps working. Administrators only.

1. Pick a part on the left: **Manager links**, **Plant Managers App**, **Sales App**, **Plant Stations**, **Garage & Maintenance** or **Driver Room & phones**.
2. Pick the **Plant** at the top when there is more than one. The links and codes shown are that plant's.
3. To send someone a link, press `Copy Link`, or `Print QR` to print a page with its QR code. `Open` opens it in a new tab.
4. To give a station or tablet a code, press `Make a code` on its line. To change a code, press `New code`, then press it again: the tablets on the old code ask for the new one.
5. To add a station, type its name under the list, pick its type, and press `+ Add`. To take one away, press `Remove`, then press it again.
6. **Manager links** has each plant's **Manager release code**: a manager types it on a tablet's Release corner to move the tablet to another station.
7. **Driver Room & phones** has the drivers' phone code: `Make a code`, `New code`, `Turn Off` (press twice) and `Turn On`.
8. **Plant Stations** has the Plant Station with no United Dairy account: `Turn On`, or `Turn Off` (press twice) to shut every no-account tablet out at once.

### Buttons
- `Copy Link` / `Print QR` / `Open`: send, print or open a link.
- `Make a code` / `New code`: a code for a station, tablet, the drivers' phones or a plant's release code. `New code` needs a second press.
- `Copy Code`: copies the code shown.
- `+ Add` / `Remove`: a station or tablet. `Remove` needs a second press.
- `Turn On` / `Turn Off`: the drivers' phone link, or the Plant Station with no United Dairy account. `Turn Off` needs a second press.

> Blue means the person signs in with their United Dairy account. Orange means anyone with the code can open it, so keep those codes to the people who need them.

> On the practice copy a red line says so: its links and codes are for testing only.

!> Do not press `New code` to check a code. Every tablet or phone on the old code stops until someone types the new one.

!> Do not send codes in a group text or email. Read them out or hand them over in person.

## Help
id: help
screens: help.html

This guide. The `? Help` button on every screen opens its own part.
