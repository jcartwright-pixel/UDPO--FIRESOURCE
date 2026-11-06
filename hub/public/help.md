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
- **Route & Trip Costs** (the Route Estimator): the round-trip cost of a delivery or plant transfer, with PC Miler truck miles and tolls.
- **Route Cost Analysis**: each month's delivery cost by route and stop: cost per case, per stop and per day on the road.

### Which cards you see
- **Plant & Distribution** and **Customers & Routes**: everyone who is active on the Users list.
- **Fuel Tracking**, **Employees & Compliance**, **Route & Trip Costs** and **Route Cost Analysis**: administrators. Employees & Compliance keeps its own access list too, so it checks again when it opens.

> Administrators also see **Administration** on Home: **People & Access** is where people are added and changed, **Roles & Rights** is what each role may do, **Links & Codes** has every link and code for managers, stations and drivers' phones, **Email & Texts** is who gets each email and text, **Plant Setup** opens each plant's set-up screens, and **Keys & Connections** holds the sign-ins for Verizon Connect, RedZone, MOCREO, Twilio and PC Miler, and **Accounting Numbers** reads the monthly accounting package for Over the Road and cost analysis.

!> Do not share the hub's link with anyone outside United Dairy: only United Dairy Google accounts can sign in.

## People & Access
id: people
screens: people.html

**People & Access** is the one place for who can sign in to the United Dairy apps and what they can see and do in each: their role, their plants, which apps they can open, their screens and their single rights. It is the same Users list as **People & Roles** in Plant & Distribution, saved the same way, so a change here is a change in every app. Administrators only.

1. Find a person with **Find** (part of a name or email), **Role**, or **Enabled / Disabled**.
2. **Which apps each person opens:** every line has a tick box for each app (Plant & Distribution, Customers & Routes, Fuel Tracking, Employees & Compliance, Route & Trip Costs, Route Cost Analysis), ticked for what they can open now. Tick or untick one and it saves at once; a green line says what changed.
3. Press a person's name. Their page opens on the whole screen, in three columns: **Who they are** (with their apps and **What they can do in each app**), **What they see in Plant & Distribution**, and **Single rights**. `← Everyone` (or the browser's Back) returns to the list.
4. Change their **Role**, their **Plants** (tick **All plants**, or each plant), or turn their account **Enabled** or **Disabled**. **Apps they can open** has the same tick boxes, saved with `Save`.
5. Under **What they see in Plant & Distribution**, pick the **Plant**, then tick a whole area or press `Show screens` and tick single screens. **Start from a job** ticks the screens that job usually needs; change them after. Nothing ticked yet means they see every screen their role allows.
6. Pick their **Home screen**: the page they land on when they open Plant & Distribution.
7. To change one right for this person only, pick `Allow` or `Deny` (or `Use role`) under **Single rights**. The last column shows what they will get. The **Customers & Routes app** group is what they may change in Customers & Routes (edit customers and route days; import lists).
8. Press `Save`.
9. To add someone, press `+ Add Person`, type their name and United Dairy email, pick a role and plants, then press `Add Person`. Open them again to pick their screens and Home screen.

### Buttons
- `+ Add Person`: a new person on the Users list.
- `Show screens` / `Hide screens`: the single screens of one area.
- `Save`: saves the person for every app.
- `Cancel` / `← Everyone`: back to the list without saving.

> Everything People & Roles in Plant & Distribution does is here, saved to the same place, so either page shows the same answer.

> Until an app is ticked or unticked for someone, they get the standard apps: everyone Enabled gets Plant & Distribution and Customers & Routes; Administrators also get Fuel Tracking, Employees & Compliance, Route & Trip Costs and Route Cost Analysis.

> **Sales** is the role for salespeople: they see routes and customer pickups. The Sales app on their phone opens for any United Dairy account, so there is nothing to tick for it.

> Plant & Distribution is always ticked for everyone Enabled. To keep someone off part of it, untick screens under **What they see in Plant & Distribution**. Employees & Compliance still checks its own list too, so its tick only shows or hides the card on their Home.

!> You cannot untick your own apps. Ask another administrator.

!> Do not disable someone to hide a screen from them. Untick the screen instead.

!> Do not disable someone to take away one app. Change their role instead; Disabled shuts them out of every app.

!> The primary administrator always stays an Enabled Administrator; the hub will not let that change.

## Roles & Rights
id: roles
screens: roles.html

**Roles & Rights** says what each role (Manager, Supervisor, Dispatcher, Sales, Driver and the rest) may do in Plant & Distribution and Customers & Routes. Each column is a role and each line is one thing a person may do. It is the same list as **Role Templates** in Plant & Distribution, saved to the same place. Administrators only.

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

## Email & Texts
id: email
screens: email.html

**Email & Texts** is where Plant & Distribution's email and texts go and who gets them. It is the same set of settings as **Email & Texts** in Plant & Distribution's Administration, saved to the same place, so nothing has to be set up again. Administrators only.

1. Pick a part on the left: **Sending & Sent Email**, **Plant Report**, **Sales Route Email**, **Who Email Comes From**, **Repair Email**, **Driver Check-In Email** or **Texts to Drivers**.
2. For **Plant Report** and **Driver Check-In Email**, pick the **Plant** at the top. Each plant has its own.
3. Type in a box and leave it (press Tab or click somewhere else). It saves then; there is no Save button. A list saves as soon as you pick from it.
4. A green line says it saved. A red line says what was wrong, and what you typed stays in the box so you can fix it.
5. **Sending & Sent Email** has the one switch for all email. When it is Off nothing is emailed, and every try is listed as stopped. Below it is every email sent, newest first.
6. **Plant Report**: type the addresses for each group with commas between them. To add a group, type its name and addresses at the bottom and press `+ Add Group`.
7. **Sales Route Email**: who gets the 6:00 AM route email, `Turn On` / `Turn Off`, and `Send a test to me`.
8. **Who Email Comes From**: whether email someone sends comes from their own United Dairy email or the plant's, and each plant's address for automatic email.
9. **Repair Email**: the addresses for Idealease and Penske, how often each is emailed, and the once-a-day time. `Send now` sends what is waiting.
10. **Driver Check-In Email**: the mailbox the drivers' check-ins are read from. `Check now` reads it right away.
11. **Texts to Drivers**: load done texts On or Off, and the cell phone driver replies are sent on to. The week's schedule texts are still sent from **Texts** in Plant & Distribution (`Open Texts in Plant & Distribution`).

### Buttons
- `Turn On` / `Turn Off`: all email (Sending), the sales email, or load done texts. Turning Sending on or off, and turning the sales email on, need a second press.
- `Only me` / `Everyone`: who sees the forecast in the plant report email.
- `+ Add Group` / `Remove`: a plant report group. `Remove` needs a second press.
- `Send a test to me`: the sales email, to you only.
- `Send now`: repair email that is waiting.
- `Check now` / `Use the standard addresses`: the driver check-in mailbox.

> The Twilio account for texts is in **Keys & Connections**. Who gets texts is ticked on the Driver Roster in Plant & Distribution.

> On the practice copy email goes only to the person who pressed the button, and texts are never sent.

!> Do not turn Sending off to stop one email. It stops every email, including the plant report and repair email.

!> Do not type a customer's or a lessor's address into a plant report group. Those groups are for United Dairy people.

## Plant Setup
id: plant-setup
screens: plant-setup.html

**Plant Setup** opens Plant & Distribution's set-up screens for one plant: the **Upload Center**, **Plant Shifts**, **Location Areas**, **Menu Setup**, the **Plant Schedule Setup**, and Plant Maintenance's **Maintenance Schedule Setup** and **Maintenance Equipment**. The screens stay in Plant & Distribution and save there as they always have. Administrators only.

1. Pick the **Plant** at the top.
2. Press `Open for` on a screen's card. It opens in Plant & Distribution on that plant, in a new tab, so the hub stays open.
3. Make the change there. It saves the way that screen always has.
4. To set up another plant, come back to the hub, pick the other plant, and open the screen again.

### Buttons
- `Open for` (the plant's name): opens that set-up screen for the plant picked.

> A new plant (Charleston, Martins Ferry) starts in the **Upload Center**: download the workbook, fill it in, upload it, check every row, then save.

!> Do not set up one plant's screen with another plant picked. Check the plant's name on the button before you open it.

## Keys & Connections
id: keys
screens: keys.html

**Keys & Connections** holds the sign-ins the apps use to reach other companies: **Verizon Connect GPS**, **RedZone**, **MOCREO thermometers** and **Twilio texts** for Plant & Distribution, and **PC Miler (Trimble)** for Route & Trip Costs. They are the same keys as before, kept in the same place, so nothing has to be set up again. Administrators only.

1. Each card says what the sign-in is for, what is saved, and how its last test went.
2. To check one, press `Test Connection`. A green line says it works; a red line says what went wrong. For PC Miler, the test looks up the Uniontown plant and routes a truck to Martins Ferry.
3. To replace a key, open **Replace**, paste only what changes (an empty box keeps what is saved), and press `Save`. Then press `Test Connection`.
4. For Twilio, type a phone number and press `Send test text`. The practice copy never sends texts, so there it says "not sent".
5. To take a key away, press `Remove key`, then press it again. That connection stops until a key is saved again.

### Buttons
- `Test Connection`: checks the saved sign-in with that company.
- `Replace` / `Set up` and `Save`: saves a new key, user name or password.
- `Send test text`: one test text through Twilio.
- `Remove key`: takes the sign-in away (press twice).

> A saved key is never shown again, only its last few letters, so nobody can copy it from this screen.

!> Do not paste a key into a chat, an email or a text. Paste it only into this screen.

!> Do not press `Remove key` to test something. The trucks, products, thermometers, texts or PC Miler miles and tolls stop until the key is saved again.

## Accounting Numbers
id: accounting
screens: accounting.html

Where the monthly accounting package comes in (administrators). The Hub reads the zip from accounting once and keeps each month's gallons sold, delivery cost, employee cost and fuel cost. **Over the Road** in Plant & Distribution and the cost analysis app read the numbers from here, so they always match.

1. Type the **Mailbox the zip comes to** (for example pat.sample@uniteddairy.com). It saves by itself.
2. Tick **Check every morning**. Every morning at 6:00 AM the Hub looks in that mailbox for a new zip and reads it.
3. To read it now, press `CHECK EMAIL NOW`.
4. If the zip came another way, press `ADD A FILE BY HAND` and pick it.
5. Check the newest month in the table. Over the Road shows the same numbers on its Recap and Cost Per Gallon tabs.

### Buttons
- `CHECK EMAIL NOW` reads the mailbox at once (the last 45 days). A zip already read is not read again.
- `ADD A FILE BY HAND` reads a zip, or one Excel workbook, from your computer.
- **Only from** (optional): type accounting's address, so only their zips are read.

> The zip is the one accounting sends each month: P&L Expenses by Dept, Gallon Comparison and the rest. Only the month tabs (like SEPT 2026) and the Gallon Comparison are used. A month's numbers change only when a newer file has different ones.

> The first time, Google Workspace has to let the app read the mailbox (the same permission as Driver Check-In Email). If it has not, the last-checked line says so in red.

!> Do not type the numbers on Over the Road's Recap for a month that is already here. Fix the file, or add the corrected file by hand, so every app gets the same numbers.

## Help
id: help
screens: help.html

This guide. The `? Help` button on every screen opens its own part.
