<!--
  OPERATIONS HELP GUIDE. Every word of the Help page and of every "? Help" button is in this one file.

  HOW TO EDIT
  - "# Something" starts a chapter (the grey headings down the left of the Help page).
  - "## Something" starts a part (one topic). Right under it, these lines say where it belongs:
      id: a-short-name            (other parts link to it with [words](#a-short-name))
      screens: daily.html         (the screen(s) whose "? Help" opens this part; add ?area=CASE etc. when one page is several screens)
  - "### Something" is a heading inside a part.
  - "- " starts a bullet, "1. " a numbered step, "> " a green tip box, "!> " a red "Do not" box.
  - **words** are bold. `Button name` shows as a button label.
  - Leave a blank line between paragraphs.

  THE RULE (CLAUDE.md at the top of the repository): any change to a screen changes its part here in the same pull request.
  functions/test/unit/help.test.js fails when a screen has no part. Plain words, no codes. Never put a real person's name,
  phone or email here; use made-up names.
-->

# Getting started

## How Operations is laid out
id: start

Operations is United Dairy's app for dispatch, the plant floor, fleet and maintenance. Every screen has the same three parts:

- **The blue bar across the top.** The United Dairy logo with the plant you are in written in yellow (Uniontown, Charleston or Martins Ferry), then `Back` and `Home`. On the right: the version, `? Help`, `Administration` (administrators only), your initials and `Sign out`.
- **The menu on the left.** It rests as a thin strip. Rest the mouse on it (or tap it on a tablet) and it opens; move away and it folds again. The button at its top keeps it open. It lists only the screens of the part of the plant you are in.
- **The screen.** Filters and the date sit on the right. Lists have headings that stay put when you scroll.

### Each plant is separate

Uniontown, Charleston and Martins Ferry each keep their own loads, drivers, trucks, settings and lists. A screen shows only the plant named in the top bar, and nothing you change there touches another plant. Only Home's **Operations Overview** shows all the plants together. You see a plant only when People & Roles gives it to you.

### Buttons you see everywhere

- `Back` goes back one step. If something is open on the screen (a window, a second tab) it closes that first.
- `Home` goes to your Home screen.
- `? Help` opens this Help on the part for the screen you are on. `Back` brings you straight back to the screen.

### Saving

Operations saves by itself the moment you change something. There is no Save button and no "saved" message, and the screen does not jump. If a save cannot go through, the box turns red and says why.

> The yellow **Test copy** badge in the top bar means you are on the practice version. Nothing you do there changes the real sheets.

!> Do not keep two people typing in the same box at once. The last change wins.

## Home
id: home
screens: index.html, company.html, group.html

The first screen after you sign in. Big cards open each part of Operations: **Plant Operations** and **Route Distribution** (each opens its own page of department cards), **Reports** and **Safety Walkthrough**. Under a card, its main screens have their own buttons and a few numbers (open truck issues, open garage work orders).

- A card marked **Under Construction** opens only for administrators while it is being built.
- **Plant Operations** has a card for each area of the plant: Plant Distribution, Plant Production, Plant Maintenance, Shipping & Receiving and **Debag / Labeling Room** (the trailers in the lot).
- Someone who sees more than one plant starts on the **Operations Overview**: one tile per plant with today's numbers and recent activity. Click a plant to open its Home.
- An administrator can give a person their own Home screen (People & Roles); they then start there, and `Home` still comes here.

## The Help guide
id: help
screens: help.html

This page. Pick a topic on the left, or type a word in **Search the help** (top right) to find every part that mentions it. The button under a part's name opens that screen.

`Back` takes you back to the screen you pressed `? Help` on.

# Route Distribution

## Route Distribution home
id: distribution
screens: distribution.html

The front page for dispatch. Each card shows today's numbers (loads, loads that still need a driver, drivers off, open truck issues) and opens its screen when you click it. Click a single number or line on a card to open that exact screen.

- The menu on the left lists every Route Distribution screen: Dispatch, Drivers, Manager Reports, Overall and Administration.
- Numbers update by themselves when anything changes. You never need to refresh.

> Start your day here. A red number is something that still needs doing.


## Daily Dispatch
id: daily
screens: daily.html

One day's loads: who drives each load, on which truck and trailer, and when it leaves. It is the same sheet as the old Daily Dispatch.

### Pick the day

- **Loadout Day** (top right) is the day the loads are loaded. Use the arrows or the list to move a day. The line above it says which day those loads deliver.
- **Week Beginning** moves a whole week.
- The day you pick stays picked on this computer until you change it.

### What to do

1. Find the load by its **Route** number.
2. Set **Runs?** to `RUNS` or `NO RUN`. A double-click on the line flips it too.
3. Pick the **Driver**. Double-click the box (or start typing) to open the list. The driver's own truck goes on with them.
4. Pick the **Truck** and **Trailer** the same way. A short number finds the unit (893 finds 223893).
5. Type the **Depart Time**, the pallet **Jack** and any **Driver Notes**.

- An orange box is still empty and needs filling.
- A red line means the load has no driver because the regular driver is off, or a truck or trailer on it is down.
- `Down Trucks / Trailers` lists every load from today on that still has a down unit, with one button to take them off.
- `Driver Call-Off` marks a driver off for the day.
- `+ Add Route / Run` adds an extra load for this day.
- `Print Dispatch Sheet` prints the day's sheet.
- `Weekly Dispatch` opens the whole live week, Sunday to Saturday, the week this screen is running. See [Weekly Dispatch](#weekly-live).
- Managers can drag a line up or down to change the load order.

### OVR

The truck and trailer lists show only units that are free. Tick **OVR** on a line to see every unit, with the reason a unit is normally left out (on another load, down, or on the road at that time).

The lists show only this plant's units, using the plant the fleet list gives each one. A few trailers the fleet list puts at another plant (533, 824, 876 and 950) are counted as Uniontown's. If a trailer you use is missing from the list, check its location on the fleet list.

> When a route's regular trailer is down, its Trailer box is left blank. Pick another trailer from the list.

> The dispatch sheet always wins on time, driver and truck. A scheduled driver is never swapped to PLANT LOAD.

!> Do not use OVR to put a down truck on a load. Fix the truck first on Truck Issues.

!> Do not change a load in the Google Sheet and here at the same time. If both change, the line goes on Sheet Conflicts.

## Weekly Dispatch Template
id: weekly
screens: weekly.html

Next week, the week you get ready and then publish to Daily Dispatch. The whole week's routes and drivers, Sunday to Saturday. It has two halves: **Route / Run Assignments** (each route with its driver for each day) and the **Driver Assignment Board** (each driver with what they do each day).

### Pick the week

Weekly Dispatch Template opens on next week, the week you are getting ready. It does not move forward with the calendar. It moves only when you change it with the arrows beside **Week starting**, or when you publish: then it opens the new next week. The week you pick stays picked on this computer.

### What to do

1. Click a driver box on a route's day. The driver list opens right there. Pick a driver and it saves.
2. On the Driver Assignment Board, click a driver's day to set their availability: Available, Backup, Day Note, Vacation, Sick, Personal, Bereavement, Unpaid or Off. Type a **Note** if needed, then `Save availability`.
3. Click a run's name for `+ Extra this week` when the same run goes out twice one day. The extra line reads THIS WEEK ONLY. Click it again for `Remove`.
4. When the week is right, press `Publish to Daily Dispatch`. Press it a second time within a few seconds to confirm.

- **NEEDS DRIVER** in red means the regular driver is off that day.
- On a day that does not run, or a **PLANT LOAD** day, the driver list has `— NEEDS DRIVER —` to put the day on with no driver yet. `— PLANT LOAD —` leaves it as the plant's load.
- Turning a day off in Route Days (the normal week) also takes it off this week and next, unless that day was changed for one week only, has a driver, or its load has started.
- **BACKUP** means the driver is a backup that day. A **Day Note** (for example "riding with...") shows in teal in place of AVAILABLE.
- A down truck or trailer still on a run says **DOWN** in red.
- `Route Run Days` opens Route Days, the normal week for every run. Its `Holiday Week` tab changes this week only.
- `Reset Week` rebuilds the whole week from Route Master and Driver Master (managers). Trucks, trailers and notes stay. Press it twice to confirm.
- `Print Weekly Dispatch` prints the Driver Assignment Board on one page.
- `Weekly Dispatch` opens the live week, the one Daily Dispatch is running now.
- Managers can grab a route's line and drag it up or down to change the order.

> A week after the Live Next week can be looked at, but not changed, until the week before it is published.

!> Do not press Reset Week to fix one driver. It rebuilds the whole week. Change the one box instead.

## Weekly Dispatch
id: weekly-live
screens: weekly.html?view=live

The live week, the one Daily Dispatch is running now, Sunday to Saturday. It looks just like the Weekly Dispatch Template, with the same two halves. Open it with the `Weekly Dispatch` button on Daily Dispatch.

It always shows the live week. After next week is published, it moves on to that week by itself. There are no arrows and no Publish here: next week is changed and published on the [Weekly Dispatch Template](#weekly).

### What to do

1. Click a driver box on a route's day. The driver list opens right there. Pick a driver and it saves.
2. The change shows on Daily Dispatch for that day straight away. There is nothing to publish.
3. On the Driver Assignment Board, click a driver's day to set their availability, the same as on the template.

- `Daily Dispatch` goes back to Daily Dispatch.
- `Weekly Dispatch Template` opens next week, the week you are getting ready.
- `Print Weekly Dispatch` prints this week's Driver Assignment Board on one page.

> To get next week ready, use the Weekly Dispatch Template, not this screen.

!> Do not change a day here and on Daily Dispatch at the same time. They are the same load, so the last change wins.

!> Do not press Publish until the week is checked. Publish moves the weeks on: Next becomes Current.

## Route Editor
id: routes
screens: routes.html

Every route and run, and how each one is set up: start time, load day, who runs it, its truck and trailer, and which screens show it. This is the app's own copy of Route Master.

### Pick what to see

The list at the top picks the view: Start Times, Mileage, Hours and Return, Load Day, Default Truck, Default Trailer, Default Pallet Jack, Daily Order, Weekly Order, Days and Visibility, Show / Hide Rules, Route Names, Route Details or Route Editor (one run). The filter on the right shows Active, All or Inactive routes, or only the routes Uniontown runs.

### What to do

- **Change a box:** click it and type. It saves when you leave the box.
- **Change many boxes at once:** click the first box, Shift+click (or drag to) the last one, type, then press Enter. Every marked box gets the same value.
- **Start times:** type a time any way (5, 530, 5:30p or 1730). The up / down clicker moves it 15 minutes a click.
- **Load Day** and **Run By** are picked from a list, never typed. Load Day reads in words (Same day, Day before...) counted back from the delivery day.
- **Departure Day:** Load Day leaves on the load date; Delivery Day leaves on the delivery date. Both leave at the Start Time.
- **Daily Order** and **Weekly Order:** grab a line and drag it up or down.
- `+ Add Route` adds a new route; `+ Add Run / Destination` adds a run under a route.
- `Edit Route` opens the full form for one run.
- `Holiday Week Editor` opens Route Week Override.
- On **Days and Visibility** (Route Days) two tabs sit at the top: `Normal Week` (this screen, every week) and `Holiday Week` (Route Week Override, one week only). Both can be changed.

> The Day box is the delivery day.

!> Do not make a route inactive to skip one week. Use Route Week Override for one week; the normal week stays as it is.

## Route Week Override
id: routeweek
screens: routeweek.html

Which days each route runs for **one week only** (a holiday week, for example). The normal week stays in Route Master.

1. Pick the week with the arrows.
2. Click a route's day to turn it on or off for this week. Each click saves at once.
3. Pick the **Holiday this week** if there is one, and type a **Reason for this week's changes**.

- `Changed Only` shows only the routes changed this week; `All Routes` shows them all.
- The `Normal Week` tab at the top goes back to Route Days, the days every week runs.
- `Reset Week to Normal` puts the week back to the normal days.

!> Do not use this screen to change a route for good. Change the route in the Route Editor instead.

# Drivers

## Driver Roster
id: drivers
screens: drivers.html

Every driver: employee ID, relief or regular, seniority, assigned truck, mobile phone, texts, vacation weeks and status. Accidents, complaints and PDAs (Progressive Discipline Actions) are entered here too and count on the Driver Scorecard.

- Use the **Status** and **Relief** filters on the right to narrow the list.
- `+ Add Driver` adds a driver. `Edit` on a line opens the driver beside the list.
- In the driver's box: change the name, hire date, seniority date, assigned truck, relief and mobile phone. A phone is written like 330-555-1234.
- `Add accident / incident`, `Add complaint` and `Add PDA` add a record to the driver. `See all` lists them.
- `Remove` (press it twice) makes the driver Inactive. The driver stays on the list.
- Under **Texts**, tick **Schedule** to text that driver their schedule when a week is posted, and **Load** to text them when the plant finishes their load, with any pickups (Administration > Texts turns each kind on or off). Untick to stop. A driver who texted back STOP is unticked and shows "Replied STOP" in red.

> The mobile phone here is the one the texts go to. If it is blank, the Driver Master phone is used.

!> Do not remove a driver who is only off for a while. Mark the time off on the Vacation Schedule.

## Driver Weekly Template
id: template
screens: template.html

Each driver's normal week, set once. It becomes the starting point of every new week on the Weekly Dispatch Template. Changes there are for that week only and do not change the template.

1. In a driver's day, pick **Available**, **Off** or **Assigned**.
2. For Assigned, pick the run. `+ Add Run` adds a second run the same day.
3. Each changed box saves on its own.

- `Copy` under a driver's name copies their whole week. `Paste` puts it on another driver; `Paste + Add` adds it to what that driver already has.

!> Do not use the template for one week's change. Change the week on the Weekly Dispatch Template.

## Vacation Schedule
id: vacations
screens: vacations.html

Drivers' time off: vacation, personal, sick, bereavement and unpaid days. At most 3 drivers can be off a day (2 in a holiday week).

- **Time Off** lists every day off. **Calendar** shows the month. **Eligibility** shows each driver's tenure and vacation weeks.
- `+ Add Vacation`: pick the driver, the first and last day, the type and the status (Approved, Pending, Denied or Cancelled). Add a note and an email to tell, then `Save Vacation`.
- On the Calendar, click a day to see who is off and to add a day off.
- `Edit` and `Remove` on a line change or take off a day off.
- `Print` prints one driver or every driver, one page each.

> An approved day off shows on Weekly Dispatch, and the driver's runs read NEEDS DRIVER.

!> Do not book a 4th driver off on a day. Check the Calendar first.

# Overall

## Driver Check-ins
id: checkins
screens: checkins.html

What each driver reported after the route: cases out, delivered, returned, refused, over and short, trailer problems and notes. Drivers check in on their phone; this screen shows every check-in for a day.

- Pick the **Delivery date** with the arrows.
- Click a line to open the check-in and type or fix it. `Save check-in` saves it; `Cancel` closes it.
- Everything the driver wrote shows in full. A line with a problem stands out.
- `New phone code` (managers) makes a new code for the drivers' phone check-in. Press it twice. The old code stops working.

!> Do not make a new phone code unless the old one got out. Every driver then needs the new one.

## Driver Station
id: driver-station
screens: driver-station.html

The Driver Room screens: the TV board and the drivers' kiosk tablet. One link; the station code decides what opens.

- **The TV board** shows today's loads (route, run, driver, trailer, cases, load status), pickups and the drivers' weekly schedule. Loads left over from yesterday that are not loaded yet stay on the board (and on View Loadout) after 6 a.m., at the top, until they are loaded or marked Ended Up Not Running. Both lists roll by themselves. The weekly schedule's words are the same size as the loads above it; a long name or route goes onto a second line, or gets a little smaller, so nothing is cut off. The local weather is in the top bar.
- **The box on the right** shows the live weather (no sound). The Driver Scorecard is off the TV for now.
- The live picture is FOX Weather's free live stream on YouTube, then AccuWeather's when it is live. FOX Weather does not let other sites show its stream at the moment, so most of the time the box shows the **live weather radar** for the Pittsburgh radar (it covers Uniontown) instead, with a fresh picture every 5 minutes. If the radar will not load either (no internet), the box shows the local weather with one line saying why. The TV tries the live videos again every 10 minutes.
- After an update to Operations the TV reloads the board by itself within a few minutes. Nobody has to press Refresh.
- **The kiosk** is where drivers check in at the plant.
- To set up a screen: open the Driver Station link, type the station code and press `OPEN THE BOARD`.
- A screen opened with a code has no Back, Home or Sign out. `Release` at the bottom (with the manager release code) is the only way out.
- `Release` goes back to the code screen, never into the app. Once a code has opened it, the TV or tablet opens only the Driver Room screens: any other screen typed in goes straight back.

> On a Raspberry Pi TV box, run the setup line once (it is in the Pi steps). After that, a power cut needs nothing: the Pi turns the TV on and opens the board by itself. To restart the board, unplug the Pi, not the TV.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not sign a TV in with your own Google account. Use the TV's code so it comes back by itself after a power cut.

- An Administrator frees a TV or tablet with `Administrator sign-in` on the code screen (their own account). It forgets the station and opens Operations.

!> Do not type a TV or Driver Room code on your own computer. It then opens only the Driver Room screens (an Administrator's account frees it).

## Sheet Conflicts
id: conflicts
screens: conflicts.html

Saves Operations did not write to the Google Sheet, because someone changed the same cell in the sheet at the same time. Each line shows when, who saved, the route, the cell, what the sheet has and what the app saved.

1. Read **Sheet has** and **App saved**.
2. Fix the right value in the app or in the sheet.
3. Tick **Checked** so the line goes off the list.

> The sheet's value was kept. Nothing is changed until you fix it.

# Dispatch Administration

## Dispatch Administration
id: dispatch-admin
screens: admin.html

Routes, runs, drivers, vacations, templates and dispatch settings in one place. Each card opens its screen. A card whose old-app name is different says which screen it opens.

## Operational Assignments
id: ops
screens: ops.html

The extra choices in the Driver list on dispatch, such as Other CVG and carriers (for example PLANT LOAD, CARRIER, OPEN).

- `+ Add Assignment` adds one. Type its name and press `Add`.
- Untick **Active** to stop it showing in the lists.
- Drag a line up or down to change the order in the lists.

## Print Layouts
id: print
screens: print.html

Pick a sheet on the left (Daily Dispatch, Weekly Dispatch and the rest), check the pages and print.

- Set **Layout** (Portrait or Landscape), **Paper** (Letter or Legal), **Margins**, **Copies** and fit (to page width or one page).
- `Save as Default` keeps the setup for that sheet, so every Print button on the screens uses it.
- `Print` prints with the setup shown. `Quick Print` prints the default at once.

## Dispatch Settings
id: settings
screens: settings.html

How dispatch is set up: the dispatch week and day, how each screen saves, where the driver and unit lists come from, and where the data comes from. This page is for reading; it explains the rules.

> The day rolls over at 6 AM. Loads before 6 AM belong to the day before.

# Fleet & Maintenance

## Fleet & Maintenance home
id: maint
screens: maint.html

Where the truck and trailer side starts. The cards show what is open: write-ups, work orders at the garage, units due for service. The **Latest write-ups** list shows the newest problems drivers reported. Click a card or a line to open its screen.

- A zero is plain grey. A number in color is something to look at.
- `Tractors & Trucks` and `Trailers` on the Home screen open the Equipment list on that kind.

## Equipment
id: equipment
screens: equipment.html

Every truck and trailer the dispatch lists offer, with its status, where it is, the route it runs by default each weekday, and why it is down.

- Use the filter on the right to show trucks, trailers or everything.
- `Down` on a unit opens the box to put it down: type the reason and press `Put down`. A down unit stays red on Daily and Weekly Dispatch until it is back.
- `Back in service` puts a down unit back.
- The fleet list is the master list and copies in every night. `Preview fleet sync` shows every change a sync would make, without changing anything. `Sync fleet list` copies it in now (managers). `Download list` saves the list.

!> Do not take a unit off a load by putting it down here. Change the load on Daily Dispatch; the down mark is only for units that cannot run.

## Equipment Issues
id: issues
screens: issues.html

Problems reported on trucks, trailers and fork trucks / pallet jacks: from a driver's check-in, the answering service email, or the garage. The menu opens it on Truck Issues, Trailer Issues or Fork Truck / Pallet Jack Issues.

### Each line

Driver, date reported, what's wrong, how many times it was reported, reviewed, emailed and the garage work order.

### What to do

1. `View` reads the whole write-up (or the original email).
2. Tick **Reviewed** once you have read it.
3. `Garage` sends it to our garage as a work order. `Lessor` emails it to the leasing company (Idealease trucks). Under **Emailed** it shows green once the email went and red while it has not.
4. `Repaired` closes it once it is fixed. `Remove` takes off a write-up that was a mistake (press it twice).

> The same problem reported 2 or 3 times shows as one line with a count. Repaired and Remove close every copy.

!> Do not mark a write-up Repaired before the unit is really fixed. It drops off the list and off the driver's next check.

# Garage

## Garage Work Orders
id: garage
screens: garage.html

Every work order at the garage: unit, problem, category, whether the unit can run, where it came from, status, the mechanics on it and when it was fixed.

- The filter buttons (with their counts) show open, in progress and finished work orders.
- Each mechanic's own clock is kept on the Garage Station; their time on each job shows here.

## Garage Station
id: garage-station
screens: garage-station.html

The garage's tablet. It opens on three big cards, **Trucks**, **Trailers** and **Fork trucks**, each with its picture and the number of open work orders. Mechanics sign in with their name and login ID for each step.

1. Tap a card to see its open work orders. `← All work orders` goes back to the cards.
2. Tap `Open` on a work order. The big yellow `← Back` goes back to the list.
3. `Start Work`: tap your name, then your login ID. The first time, sign once with your finger and tap `Keep my signature`: it is kept on file and signs every work order you complete. Your clock starts. A second mechanic taps `Start Work` with their own name to join; everyone on the job shows with their time.
4. Type (or tap `Talk` and say) what you did in **Notes / what I did today** and the parts in **Parts put on**. They go on the work order with your name when you press `Pause`, `Waiting on Parts` or `Complete`.
5. `Pause` stops your clock. The job stays open.
6. `Waiting on Parts`: name the parts you need in your own words, then `Waiting on Parts` again and your login ID. When they come in, `Parts are here` starts it again.
7. `Complete`: your name and login ID, then what you fixed, what you did and the parts put on (filled in from your notes), `Next`, then safe to drive. Your signature on file signs it.

- What comes here by itself: drivers' write-ups on our own trucks, everything written up on a trailer, fork trucks and pallet jacks, engine codes from Verizon Fleet, and a PM, reefer service or Annual Inspection that Fleet Service shows due soon or overdue.
- A leased truck's write-up comes only when the office sends it to the garage.
- Each work order says how many times the unit was written up and the day of the first one ("Written up 2 times · first 10-16-26"). A unit written up more than once shows as one line ("Also written: ..."); completing it repairs every write-up on it.
- The list: drivers' write-ups (DVIR and check-in) on top, newest first; then the office's and the garage's; services last, the most overdue first. A card shows no more than 15. Services wait their turn ("3 more services come on as these are done").
- Something new (a write-up or work order this tablet has not opened yet) flashes, and so does its card, until a mechanic opens it.
- Yard trucks (688 and 9737) say **Yard Truck**.
- A service that is due has its checklist on the work order. `Complete` stays gray until it is all filled in:
  - every line marked `OK`, `Needs work` or `N/A`;
  - the tread depth of all 8 tires (left front outer and inner, right front, right rear, left rear), in 32nds of an inch;
  - the **Hours** and, on a truck, the **Miles**. They come from the GPS when the unit has it (and show beside the unit number); otherwise type them;
  - the **Day finished** (today unless you change it);
  - and the work order scrolled all the way down.
- Tapped early, `Complete` says what is left and shows it in red. The **Needs work** lines are kept on the work order.
- Left with no taps for 20 minutes, the tablet goes back to the cards. Notes typed and boxes ticked stay on the tablet.
- With no signal the station keeps working and sends everything when the signal is back.
- A tablet opened with a station code has no Back or Home in its header. `Release` (bottom right, with the manager release code) is the only way out, and it goes back to the code screen, never into the app. An Administrator frees the tablet with `Administrator sign-in` on the code screen (their own account).

> `Talk` uses the tablet's microphone. The first time, the tablet asks to allow it: tap Allow.

> A garage mechanic's sign-in works only here; the plant's mechanics sign in on their own plant's Maintenance Station.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not sign for someone else. Each mechanic's signature is their own, and it goes on every work order they complete.

!> Do not tap `Complete` until the work is done. A work order that is waiting on something is `Pause` or `Waiting on Parts`.

!> Do not type the garage station code on your own computer. It then opens only the Garage Station.

!> Do not add the plant's mechanics on Fleet Service Setup. That list is the garage's mechanics, and they show only on the Garage Station.

!> Do not sign in as another mechanic. Each mechanic's time and notes go on their own name.

## Fleet Service
id: fleet
screens: fleet.html

Service and compliance for our own trucks and this plant's trailers: PM service, reefer hours, Annual Inspection and plates.

- **Due · Services & Annual Inspection** shows each unit with PM / Reefer, Annual Inspection and Plates side by side. Overdue and due soon stand out in color.
- **Work Orders** lists the open work orders and what the mechanics did this week.
- **History** shows the last 12 months.
- **Fleet Service Setup** sets the service rules for trucks and trailers and the garage technicians (`Add Technician`, `Set login ID`). These show only on the Garage Station; the plant's mechanics are on Maintenance Schedule Setup.
- To start a unit's dates, click its PM / Reefer or Annual Inspection on **Due**, or `Edit dates`. Type the last service date and miles, reefer hours, inspection due and plate expiry.
- A PM, reefer service or Annual Inspection that is due soon or overdue goes onto the Garage Station by itself, with its checklist. `Send to Garage` sends one sooner.
- `Print Fleet Service Report` prints the report.

> Miles marked GPS come from Verizon Connect Fleet; others come from the driver's DVIR or were typed.

# Manager Reports

## Driver Scorecard
id: scorecard
screens: scorecard.html

How each driver is doing: one grade per area and an overall score, with rewards for perfect days and points off for misses. Areas: daily check-in, cases out vs in, clean inspections, attendance, driving (Verizon GPS), fuel economy, time, truck cleanliness, accidents, complaints and PDAs.

- Pick **Month**, **Week** or **Year**, then use the arrows to move.
- Click a grade to see that driver's days in that area and why each one cost or earned points.
- `Excuse` on a miss (a hard stop for a deer, FMLA) takes its points off. `Undo excuse` puts them back.
- `Rate truck cleanliness` rates a driver's truck 1 (very dirty) to 5 (spotless), about once a month.
- **Settings** sets the points for each area, the date the scorecard counts from, and which area grades the Driver Station TV shows next to the overall score.
- **No driver dispatched** lists GPS alerts on a truck nobody was put on. Put the driver on Daily Dispatch so it counts.
- `Print` prints the board.

> Cases: 1 point off for each full 54 cases short, 1 point earned for each full 54 over. Less than 54 counts nothing.

!> Do not excuse a miss without a real reason. Excuses are kept with who made them.

## Over the Road
id: otr
screens: otr.html

The Over the Road runs report and cost per gallon, laid out like the OTR Trips workbook.

- **Today** shows today's runs. **By Date** lists each day's runs for the month. **Recap** and **Month Recap** total them (Uniontown Delivered, Transfers, Carriers). **Cost Per Gallon** compares cost to gallons sold.
- Tick **Compare to last year** to see last year's numbers.
- `Copy Daily Count` copies the day's count. `Enter Month Figures` types the month's gallons and costs.
- **OTR Routes Setup** says who takes each run (United Dairy, a carrier, or a transfer) and its round-trip miles.
- `By Date Columns` adds, renames or removes your own columns (an outside carrier, for example).
- `Print` prints the page.

## Trucks Today
id: trucks
screens: trucks.html

Where every truck is today, from Verizon Connect Fleet: driver, truck, status, where it is now, miles today, when it first moved, dispatch time, time out and alerts.

- **Today's Routes** shows the trucks on today's loads. **All Fleet Units** shows every unit in Fleet, with trailer temperatures, odometer and engine hours.
- Click a line to see everything Verizon sent today for that truck, in time order.

## GPS Setup
id: gps
screens: gps.html

The connection to Verizon Connect Fleet (administrators).

1. Type the Fleet login and `Save login`.
2. `Test connection` checks it works.
3. The steps below show what is coming in from Verizon, what the app reads and which trailers get no temperature.

- `Pull now` reads Verizon at once instead of waiting.
- `Ask Verizon` asks for every field Verizon offers, to see what is there.

!> Do not remove the login unless Verizon changed it. Trucks Today and the Scorecard stop getting GPS.

# Plant Distribution

## Plant Distribution (Manager Center)
id: manager
screens: manager.html

The plant's front page for managers. Each department has a small card: Case Loading, Tote Loading, Box Loading and Case Unloading, with how many loads are loaded, what is behind, and the Late Forecast. Below are Shift Notes, Yard Checks, the Manager Walkthrough and the Shipping schedule.

- A route tile is green when it is loaded and red when it is not. Only BEHIND has a word.
- Click a card to open its screen; click a line on a card to open that exact item.
- **Manager Walkthrough:** each stop (Yard, Coolers, Production, Pictures) is green when done, yellow when due (2 hours) and red when past due (3 hours). `Check now` does the check; `View` shows the last one.
- **Send Current Report:** see [Send Current Report](#send-report).

> Last night's left-over loads show on their own line, before today's.

## Send Current Report
id: send-report
screens: manager.html?report=1

The shift report email to the managers: every loadout's loads, shift notes, yard and cooler checks, production and pictures.

1. Read the report on screen.
2. Type a **Note at the top of the email** if you want one.
3. `Send Test to Me` sends it only to you, to check it.
4. `Send Current Report` sends it to the managers.

- `Copy` copies the report; `Print` prints it.
- Only what was checked since the last report went out is in it; the rest says "Not checked".
- The loads are the ones loaded today, by type (Case, Box, Tote, Tanker). Inside each type, each delivery day once: the loaded loads (green), then the ones not loaded yet.
- The banner at the top is red when a route is behind, yellow with "Potentially late" when no route is behind yet but the forecast says one or more loads will be late, and green only when everything is on time.
- A load says BEHIND when it is not loaded 45 minutes after it leaves. A Plant Scheduler load leaves at its pickup time on its delivery day, so a load loaded early is not behind before then.

!> Do not send the report twice for one shift. Use Send Test to Me to check it first.

## Plant Departments
id: plant
screens: plant.html

One card for each department of Plant Distribution: Case, Tote, Box and Tanker loading and unloading, Truck Washing, Product Returns and Trailer Assignments. Click a card to open it.

## Loading (Case, Tote, Box and Tanker)
id: loadout
screens: loadout.html

The day's loads for one loadout: Case Loading, Tote Loading, Box Loading or Tanker Loading (the menu opens the right one). Each line is one load: route, run, trailer, cases, start and end time, total time and its status.

### Pick the day

**Loadout day** (top right) with the arrows. `Go to today` comes back to today. The day stays picked on this computer.

### What to do

1. Press the status button on a load: `Waiting`, `Loading` or `Done`. Loading starts its clock; Done stops it.
2. Type the **Trailer** and the **Cases**. Each box saves when you leave it.
3. `Edit` on a load opens its Start Time, End Time, Temperature, Shift and Notes.
4. `Skip` moves a load down one place, past the next load still to load, when it cannot be loaded yet. It shows a SKIPPED tag until it is Done, or until it is back in its place in the sheet's order (for example when the load that went past it is skipped back down). One load can be skipped only 2 times in a row: after that `Skip` is grey and says to load it next. Once another load starts loading, it can be skipped again.
5. Drag a load that is not loaded yet up or down to change the order. A load moved out of the sheet's order gets a green MOVED tag. On a phone, hold a finger still on the load for a moment to pick it up; a swipe scrolls the list.

- `+ Add Load` adds a load nobody scheduled. Fill in the route, schedule type, load type, dates, time, trailer and cases, then `Confirm`. Nothing saves until Confirm.
- `Ended Up Not Running` (in the load's box, press twice) marks a load that never went.
- `Delete Load` (press twice) takes a Scheduler load off this screen and off the Scheduler.
- **Pickups:** `Add Pickup` adds a customer's pickup; `Pickup Complete` finishes it.
- A plant note on a load shows as a yellow line under it.
- **Trailer colour:** the trailer is **green** once it is unloaded (or has nothing to unload) and **red** while it is still waiting on the Unloading list. The Plant Station's loading cards show the same colours. A loaded load has no colour.
- With the palletizer's case counter on, a **Counted** column shows beside Cases.
- On a phone the four loadout buttons (Case, Tote, Box, Tanker) sit in two rows.

> Typing a trailer or a count never starts a load. Only the status button does.

!> Do not press Skip over and over to send a load to the bottom. Each press moves it one place, 2 at most. If it really has to wait longer, a manager can drag it.

!> Do not press Done before the trailer is really loaded. Done stops the clock and the load drops off the plant's list.

!> Do not leave a load on Loading at the end of the shift. After 12 hours it shows "forgot End?".

## Late Forecast
id: forecast
screens: forecast.html

Will the plant be late? Every case load still to load, in the order it will be loaded, with its **Est. Done** time, compared with when it leaves.

- **Loads still to load** lists each load with its route, run, cases, departure and Est. Done. A late one is red.
- **Loads due by each time** totals the loads and cases due by each hour.
- Last night's left-over loads come first, marked at the left edge.

> A time is red only when a load that leaves then will be late. Catching up later turns it back.

## Unloading (Case, Tote, Box and Tanker)
id: unloading
screens: unloading.html

Trucks back from the route: each load's trailer, the empty cases that went out and came back, RTA (returned to the plant) and whether the trailer was washed.

1. Press `Check Off` to work the list (`View Only` just looks).
2. On a load press `Start`, type the **Cases Returned** count, then `End`. Up to two trailers can be unloading at the same time.
3. Mark `RTA` for returns and `Wash` if the trailer needs washing.
4. `Edit` fixes the Cases Returned count, the Trailer Back, **Unloaded By** and Notes.
5. A trailer that is not on the list: press `+ Add a Trailer`, type the trailer, pick **Unload it** or **Wash only** (and the route if you know it), then `Add`. It goes to the top of the list.

- **The order:** the trailer being unloaded is at the top. Then every trailer you load today, in the order Case Loadout loads them, whether it is here or still on the road. Then the rest that came back and still need unloading: yesterday's and added ones, then the ones here, then the ones on the road.
- **Every trailer you load today is on the list,** also one that came back on an earlier day or was parked in the yard. It shows the load it goes on. Unload it like any other; if it is already empty, `Edit`, then `Take Off the List`.
- A trailer from yesterday that you load today sits where its load falls in the loading order, still marked red.
- **Yesterday's trailers:** a load from yesterday that nobody pressed `End` on comes over by itself, at the top, marked in red **From 10-26**, with a red line above the list. Unload it like any other.
- **Each trailer is on the list once.** If yesterday's trailer went out again today on the dispatch, or was loaded again today, it was never recorded here. Yesterday's card then leaves the list by itself and is saved as **Not recorded**, with a note saying why. Only today's card is left.
- A **Wash only** trailer has a `Wash` button and no `Start`. It is done once washed.
- An added trailer, one from yesterday that was in fact unloaded, or one of today's loadout trailers that is already empty can come off the list: `Edit`, then `Take Off the List` (only before `Start`).
- On the plant tablet the box **A trailer that is not on the list** does the same: type the trailer, then `UNLOAD IT` or `WASH ONLY`.
- **Unloaded By** is who is unloading the trailer. Pick a name from the list or type it if it is not there yet. The name shows under the trailer's status, here and on the plant tablet.
- **Two at a time:** two people can each unload a trailer at once. While two are unloading, a third `Start` says to finish one first.
- **Cases Out** comes from the loadout and **Driver Said** is what the driver typed at check-in. You don't type either one.
- **Lost** is Cases Out minus Cases Returned, in red. The box on the right adds up the day.
- On the plant tablet the open card shows Cases returned, Trailer and **Unloaded by** on one line. It is a blind count: the tablet does not show Cases Out, Driver Said or Lost, so the count is what was really on the trailer. This screen still shows them. While two are unloading, the other cards say **2 unloading now. Finish one first.** where `START UNLOADING` was.
- **Return day** (top right) with the arrows picks the day.
- On a phone or small tablet each load is a card with every box named.
- A drop-and-hook load (ticked **Drop and Hook** in the Route Editor) shows its name, like **Ferry Product 1**, **Lancaster Transfer** or **Fairmont Transfer**, where the trailer number would be, here and on the plant tablets.

> To make a load show by name, open the Route Editor and tick **Drop and Hook** on that run.

!> Do not start a trailer for someone who is not unloading it. Each person unloads one trailer at a time, and no more than two trailers at once.

!> Do not use `+ Add a Trailer` for a load that is already on the list. Find it and press `Start`.

## Truck Washing
id: washing
screens: washing.html

Trailers that need washing, and the washes done.

- Each line shows the trailer, when it was reported, the work needed, how many times it was reported and the work action.
- `Wash` on a line marks it washed. `+ Add Wash` adds a wash nobody asked for: pick the day and trailer, then `Wash`.
- A trailer added on Unloading as **Wash only** shows here too until it is washed.
- **Wash Analytics** shows open wash items, washes this week and the trailers reported most often.

## Product Returns
id: returns
screens: returns.html

Product that came back on the trucks: route, trailer, who reported it, cases, what came back and its status.

1. Press `Check Off` to work the list (`View Only` just looks).
2. Press a return (or `Details`) to read the whole write-up.
3. Mark it `RTA` once it is put away.

- `+ Add Return` adds a return nobody noted: pick the route, the product (or Other and type it) and the cases.
- **Return day** (top right) picks the day.

## Trailer Assignments
id: trailers
screens: trailers.html

Which trailer goes on which load: route, run, driver, truck, trailer and depart time. Pick the trailer from the list on each load. The lists on the right show the **Open trailers**, those **On a route** and those **Down**.

- `Refresh` reads the list again.
- Pick "Trailer not known yet" when you do not know it.

# Shipping & Receiving

## Shipping and Receiving Schedule
id: scheduler
screens: scheduler.html, scheduler.html?lane=receiving

The calendar of loads going out (**Shipping**) and coming in (**Receiving**). Switch between them with the two buttons at the top.

- Pick **Day**, **Week** or **Month**, and move with the arrows. `This month` comes back to now. **History** lists every past load, newest first.
- Each load is colored by who delivers it: Uniontown truck, Branch or Carrier. Holidays are marked.
- Click a day's `+` (or `+ Add Load`) to add a load: schedule type, load type, load date, delivery date, pickup time, trailer, PO, cases, product and notes. Press `Confirm`; nothing saves until then.
- Click a load to open it, change it, or `Delete Load` (it asks first).
- A Shipping load takes the dispatch sheet's time for its run once the Live week has it.
- **Suppliers** (Receiving) lists the suppliers. `+ New Supplier` adds one; `Add a List` pastes many at once, one per line.
- `Print Monthly` prints the month.

> A load put on here shows on the Loading screens and on Daily Dispatch on its day.

!> Do not delete a load that ran. Mark it on the Loading screen instead.

## Receiving Log
id: inventory
screens: inventory.html

Every pallet scanned in at Receiving: date, time, supplier, PO, item, lot, made and best-by dates, cases, temperature and who received it. Pallets are scanned on the Boxing station's Receiving tab.

- Pick a supplier on the right to narrow the list.
- Click a line to see its barcodes. `Remove` takes off a pallet scanned by mistake.
- `Print` prints the list.

# Debag / Labeling Room

## Plant Material Trailers
id: jug-trailers
screens: jug-trailers.html

The dry box trailers parked in the plant's lot with plant material on them (jugs, cardboard, empty crates and more): how full each one is and what is on it, so the plant knows which trailers are out there and which one to use next. Across the top: how many trailers are in the lot and how many are **Loaded**, **Half Full** and **Empty**. The list is on the left; the trailer you pick opens on the right.

1. A trailer comes into the lot: press `+ Add Trailer`. Pick it from **United Dairy trailer** (this plant's trailers on the main trailer list, dry boxes first), or type its number under **Trailer number** for any other trailer. Press `Add to the Lot`. It goes on the list as Empty.
2. Pick a trailer on the list. Press `Empty`, `Half Full` or `Loaded` for how full it is.
3. Under **What is on it**, type each item on its own line with how many pallets (for example "Gallon jugs" and 22). A new empty line appears for the next item. To take an item off, clear its line.
4. **Notes** is for anything else the plant should know.
5. When the trailer leaves the lot, press `Left the Lot`. It comes off the list.

- Every box saves when you leave it; there is no Save button.
- **History** under the trailer shows what changed, when and who changed it.
- The drop-down at the top right shows only the Loaded, Half Full or Empty trailers.
- Each plant has its own list. A trailer added by its number is kept on this list only; it is not added to the main trailer list or the sheets.

> A trailer that left the lot and comes back is added again the same way; its old history comes back with it.

!> Do not leave a trailer on the list after it has gone. Press `Left the Lot`, so the plant does not go looking for it.

# Plant Checks

## Shift Notes
id: shiftnotes
screens: shiftnotes.html

The plant's shift log: notes for the next shift, breakdowns and anything that needs following up.

1. Pick the **Type** of entry (a note, a breakdown, a handoff...).
2. Fill in the boxes: equipment or area, what broke, shift, down at and back up at, whether it can wait, next steps and notes.
3. `Send to Maintenance` sends a breakdown or request to Plant Maintenance as a work order.
4. `Start Another Entry` clears the form for the next one.

- **Current** shows what is open. **24-Hour History** shows the last 24 hours; a badge shows how many still need review.
- A note stays until someone marks it **Resolved**. A report or the clock never clears it.

!> Do not mark a breakdown Resolved until it is running again. The time it was down stops counting then.

## Yard Checks
id: yard
screens: yard.html

Loaded trailers in the yard and their temperatures, checked until they leave.

- **Active Yard Queue:** every trailer due a check. Type the **Actual Temp**, the **Set Point** and pick the **Fuel Level**. Each box saves when you leave it; the row shows a tick and the time.
- A trailer whose GPS temperature is in range (30 to 42°F) is not due. It stays on the list in green.
- `Left Yard` (or `Confirm Left`) when the trailer leaves.
- **All Trailers in Yard** lists every loaded trailer until it leaves, by when it leaves (look only).
- **24-Hour History** shows the checks of the last 24 hours.

> A GPS temperature stuck at 32° is marked; check that trailer by hand.

!> Do not type a temperature you did not read. A real check is what keeps the load safe.

## Quality Checks
id: quality
screens: quality.html

Each production line's status and its quality checks.

1. Pick the line, then the **Product being run** (blank to start, so nothing passes without a real check). A wrong pick can be undone for 4 seconds with `Undo`.
2. Type the readings: annealer temperature and speed, cycle time, jug or package weights, remaining output and notes.
3. `Run Complete` when the run ends; `Start Next Run` starts the next one.

- **Current** shows the lines now; **24-Hour History** the last day; **RedZone Checks** shows the checks typed into RedZone (look only).
- A check clears from the form when the report is sent or 2 hours after it was entered.

## Cooler Temperature
id: temps
screens: temps.html

The cooler and freezer temperatures from the MOCREO sensors, with a manual reading when one is due.

- Each location shows the current temperature, trend, status, battery and last reading.
- An in-range sensor counts as the check. When a location is due, type the **Manual Read**; it saves when you leave the box and the location locks until the next check.
- **24-Hour History** shows the last day. `Refresh` reads the sensors again.

> A sensor that stopped reporting shows the day of its last reading, so an old reading never looks current.

## Manager Walkthrough
id: walkthrough
screens: walkthrough.html

The plant manager's phone walkthrough. The Plant Managers app opens on three choices: the Manager Walkthrough, Loading and Unloading. The walkthrough is Yard, Coolers and Production, then Pictures. Each stop is green DONE, yellow DUE (2 hours) or red PAST DUE (3 hours).

- Press a stop to open its check.
- **Pictures:** `Take Picture` opens the camera; the pictures go with the next Send Current Report.
- The Plant Managers app shows only these screens: the walkthrough (Yard, Coolers, Production), Loading and Unloading (with its Returns and Washing). There is no menu on the left, no `Home` and no `Administration`. The `Plant Managers` button at the top (and the logo) goes back to the three choices.
- Any other screen opened in the Plant Managers app goes back to its three choices. Send Report and Trailer Assignments are in the full Operations app: open it from its own link, not from the Plant Managers app.
- On a phone, swipe up to see the rest of the screen.
- For managers only.

> Opened from its normal link (not the Plant Managers app) on a computer, `Open the full Operations app` is still at the bottom.

# Reports

## Reports
id: reportcenter
screens: reportcenter.html

Every report in one place: Walkthrough, Driver, Plant and Garage reports. Click a card to open the report. The buttons on the Home screen open this page on one group.

## Plant Reports
id: reports
screens: reports.html

The plant's reports. Pick the **Report** at the top: Weekly Scorecard, Shift Comparison, Day-of-Week Trends or Loading Rundown. Then pick the **Loadout**, and the **Day**, **Week** or number of **Weeks** with the arrows.

- `Print` prints the report. `TV display` shows it full screen for a TV.

## Loading Rundown
id: rundown
screens: reports.html?view=rundown

Each loadout's day, load by load: when the first load started, each load's times, and what is still open or loading. Pick the **Loadout** and the **Day** with the arrows. `Print` prints it.

## Shift Reports
id: shiftreports
screens: shiftreports.html

Every shift report email that was sent: when, which shift, who sent it, and the email itself.

- Pick the **Shift** and the **Report Date** (or `All Dates`) on the right.
- Click a line to read the email. `Print` prints it; `Refresh` reads the list again.

## Plant Performance TV
id: plant-kiosk
screens: plant-kiosk.html

The plant's TV board for today: loads loaded, on time today, behind now, pickups open, and the next loads to load with their area, depart time, truck, trailer and status. It updates by itself.

- `TV display` fills the screen.
- A TV or kiosk opened with a station code has no Back or Home. `Release` (with the manager release code) is the only way out.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

# Safety Walkthrough

## Weekly Walk
id: safety
screens: safety.html

The weekly safety walk of the plant, the garage and the office, done on a tablet.

1. Open an area (Plant, Garage, Office) and walk one sub-area at a time, or pick `All in order`.
2. Mark each item good or not good. For a problem, say what is wrong and add up to three photos with `+ Photo`.
3. Tick **Send to Plant Maintenance as a work order** when it needs fixing.
4. Check the **Open issues from earlier walks** and write **Walk notes**.
5. `Finish Walk` when done.

- Monthly items show MONTHLY and come up once a month.
- With no signal the walk keeps working and sends everything when the signal is back.

!> Do not finish the walk with items Not checked. Walk every sub-area.

## Open Issues
id: safety-issues
screens: safety-issues.html

Every problem found on the walks: when found, area, what is wrong, who found it, how many walks it has been open, photos, and its Plant Maintenance work order.

- `Open`, `Fixed` and `All` pick what to show.
- Mark an issue Fixed once it is fixed, or reopen it. `Plant Maintenance` sends it as a work order.

## Fire Extinguishers
id: extinguishers
screens: extinguishers.html

Every fire extinguisher: tag, location, type, size, this month's check, annual service, 6-year service and hydro test. DUE, DUE SOON and PAST DUE stand out.

1. `Start Monthly Check` walks the extinguishers one by one.
2. On each one press `GOOD` or `NOT GOOD` (say what is wrong), then `Next` to the next tag.

- `+ Add Extinguisher` adds one.
- With no signal the check keeps working and sends when the signal is back.

## Fire Alarm, Fire Suppression and Escape Plan
id: safety-fire
screens: safety-fire.html

The checks for the fire alarm, the fire suppression system and the escape plan. Each item shows when it was last checked and when it is due (DUE SOON, PAST DUE). Mark each one Good or Not good, and say what is wrong.

## Past Walks
id: safety-walks
screens: safety-walks.html

Every safety walk: when, who started it, how many items were good, not good and not checked, issues reviewed, monthly items, notes and photos, and when it was finished. `Open` shows a walk's notes.

## Checklist Setup
id: safety-setup
screens: safety-setup.html

What the weekly walk looks at, and how often. Each line is one thing to look at: set **How often**, tick **On the walk**, or move it to another area with **Move to**. Areas themselves are set up on Location Areas.

# Plant Production

## Plant Production home
id: production-home
screens: production-home.html

The front page for Plant Production (being built, administrators only for now). It fits on one screen without scrolling.

- **Send Current Report** on the left: a preview of the plant report. `Edit / Add` opens it to add a note; `SEND CURRENT REPORT` emails it to the Plant Managers group.
- **Fillers**, **HTST**, **Boxing** and **Totes**: one card each, with how many lines are running, stopped and what they made. Boxing and Totes sit side by side. The Raypak counts with Boxing.
- **Production Checks** along the bottom: Quality Checks, Cooler Temperature and the line tablets, each with `Check now` and `View`.
- **Shift Notes** beside it: breakdowns still open, handoffs and carryover.

1. Click a machine card to open just those lines on Production Lines.
2. Click `Check now` on a check that is due or past due.

> Blow Mold has its own page: open it from the Production Lines menu.

!> Do not wait for a red card to clear on its own. Open it and see which line is stopped or off its speed.

## Production Lines
id: production
screens: production.html

Every production line this week: what each line made against its target, how long it was stopped and why, waste, changeovers and efficiency.

- `Last Week`, `This Week` and `Next Week` pick the week. `All Machines` shows every line; the number shows how many need attention.
- Click a line for its own page, live from the machine: running or stopped, speed, label check and sensors.
- **Biggest losses this week** shows the top reasons lines were stopped.
- `TV Display` shows the board full screen for the production TV.

> Efficiency shows for managers only, not on the tablets or the TV.

## Line Tablet
id: line
screens: line.html

The tablet at a production line. The operator signs on and keeps the line's count, product and checks. Everything fits on one screen: the line's name, its buttons across the top, the **Running / Changeover / Down** bar right under them with a clock of how long, then the cards.

1. Pick this tablet's line the first time (`Change Line` changes it later). A tablet set up with the Line Tablet link and its code types the code first, then picks its line.
2. `Change Product` picks what is running. **Running now** shows the product's **code date** in big letters. The label reader checks the jug's label; WRONG LABEL means the label is not one of this line's products.
3. Type **How many to run** of that product. **Left to run** counts down as the count goes up, and says DONE when it is all made. The amount set with `Set Next` comes along by itself when that product starts.
4. `Enter Count` types how many were made this shift so far (when the machine does not count). It saves when you press Enter.
5. Tap `DOWN` when the line stops (the bar turns red and its clock starts), then tap why in the row under it. Tap `RUNNING` when it runs again.
6. Do each check when it is due. **Quality Check** is a list: tap `OK` or `Not OK` on each line and type the temperature. Each tap saves right away; tap it again to take it back.
7. Type kick-outs and waste with `Waste / Rejects` (or `Enter Kick-outs` on the Blow Mold).
8. For a product change, tap `CHANGEOVER` on the bar: pick the product it changes to and tap `START CHANGEOVER`. The bar turns blue with its clock and the standard minutes. Tap `RUNNING` when the new product runs; the changeover's minutes are kept.
9. `CIP / Sanitation` starts and finishes a wash (Boxing has no CIP).

- The buttons across the top: `Line` (this screen), `Changeover`, `CIP / Sanitation`, `Waste / Rejects`, `Quality Check`, `Crew` and `Shift Notes`. The one open is dark blue; one that is due flashes.
- Tiles show the speed (TOO FAST, TOO SLOW, IN RANGE) and what was made. **Running now** says since when the product has run and how long the last changeover took.
- **Down this shift** adds up the minutes down and in changeover, and lists each one with its minutes, newest first; the one going on now says "now".
- **Fill weight** (the fillers, and the Raypak and bag fillers with bags), beside Up next: it counts down to the next weight and says NOW, flashing, when one is due. Weigh one filled jug, type its weight in grams in the box and press Enter. The box empties and the countdown starts again; under it is the last weight and whether it was over or under target. How often is set on Line Targets. Boxing has no fill weight check: its product was weighed before it gets there.
- On the Blow Mold, scan each resin lot; each new lot or color starts a new run.
- `Set Next` sets what runs next on this line and how many.

**A line tablet on the floor:** open the Line Tablet link (Administration, Plant Station Codes) on the tablet. Once the plant has a Line Tablet code, the tablet types it once and picks its line. After that it has no Back, Home, Sign out or `Change Line`, and it opens no other screen. To move it to another line, a manager taps `Release` in the bottom-right corner and types the manager release code; the tablet goes back to the code screen. An Administrator frees the tablet for good with `Administrator sign-in` on the code screen (their own account). A computer opening Line Tablet from the menus works as before.

> No code date on Running now? Set the product's shelf life on Line Targets.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not type a check you did not do. A recorded check cannot be changed from the tablet.
!> Do not leave How many to run blank when you know the amount. Without it there is no countdown.
!> Do not type a weight from memory or from the last jug. Weigh a jug each time the box says NOW.
!> Do not tap `DOWN` for a product change. Tap `CHANGEOVER`, so the time counts as a changeover, not as down.
!> Do not type the Line Tablet code on your own computer. It then opens only the Line Tablet.

## Line Targets
id: linetargets
screens: linetargets.html

Each line's setup: its products' speeds and targets (full speed, target %, lowest and highest speed, target per hour and per shift), how it is counted (typed, sensor, label reader or machine), its sensors and their ranges, changeover and CIP wash standards, and which fillers feed a packing line.

- `Fill Empty Speeds from RedZone` and `Refresh from RedZone` copy speeds from RedZone.
- `Start Test Feed (1 hour)` sends made-up counts to a line to test the screens; `Stop Test Feed` stops it.
- `Test read` reads a sensor once to check it.

> How a line is counted, its controller and its RedZone line are also on the line's page in [Machine Connections](#machine-connections). Both save the same way.

!> Do not leave a test feed on. Its made-up counts show on the line's numbers until it stops.

## Product Sheet
id: products
screens: products.html

Every product the plant makes, one line each: SKU, type, group, UPC, speeds, targets, shelf life, target fill, and a tick for each machine it runs on. The ticks are the product drop-down on each machine's Quality Check.

- `Add Product` adds one; `Edit` and `Remove` change or take one off.
- **Areas & Groups** sets the areas and groups products are sorted into.
- `Download Product List` saves the list; `Upload` reads a list in (check it, then `Save Upload`).

> The product name is what counts. A SKU used by two products is marked.

## Machine Setup
id: machine-setup
screens: machine-setup.html

Which products each machine runs. Pick a machine, then move products between **On** and **Not on** with `Take off` and `Add`.

## RedZone Sign-In
id: redzone
screens: redzone.html

The connection to RedZone (administrators). RedZone is read only; nothing is ever written back. Which RedZone line goes with each machine is picked in [Machine Connections](#machine-connections).

1. Type the RedZone sign-in and `Save`.
2. `Test Connection` checks it works.
3. `Show What RedZone Gives Us` lists RedZone's lines, products, runs, problem types and check sheets. `Download the List` saves it.
4. `Read RedZone into Operations` reads them in.

!> Do not remove the sign-in unless RedZone changed it. The line tablets stop getting RedZone's problem types.

# Plant Maintenance

## Maintenance Center
id: pmaint
screens: pmaint.html

The front page for Plant Maintenance (being built, administrators only for now). Four lists: **Requests** (issues that can wait), **Breakdowns Today** (recorded, not requested), **Open Work Orders** (oldest first) and **PMs Due** (overdue, then this week), plus down time today.

- `Make Work Order` turns a request or breakdown into a work order.
- `Already Fixed` closes a request that needed no work order.
- `Send to Maintenance` sends a due PM as a work order.

## Plant Equipment and Machinery
id: plant-equipment
screens: plant-equipment.html, machinery.html

Every piece of plant equipment or machinery: area, name, make and model, status, open work orders and the next PM. `+ Add Equipment` (or `+ Add Machine`) adds one. Click a line to open it.

## Plant Work Orders
id: pmworkorders
screens: pmworkorders.html

Every plant work order: machine, where it came from, the problem, whether the line is down, status, the mechanics on it and when it was fixed. The filter buttons (with their counts) show open, in progress and finished ones.

## PM Schedule
id: pmschedule
screens: pmschedule.html

The preventive maintenance for each machine: what the PM is, how often (every so many days, weeks or months), when it was last done and when it is next due.

- `+ Add PM Task`: pick the machine, how often, when it was last done, and type what the PM is. Each box saves when you leave it.
- `Send to Maintenance` sends a due PM as a work order.

## Maintenance Station
id: maint-station
screens: maint-station.html

The mechanics' tablet in the plant. The plant's own maintenance mechanics sign in and work their work orders.

1. Tap a work order.
2. Tap your name, then type your login ID.
3. Start, stop or complete your time on it.

- **Mechanics:** the line across the top lists this plant's mechanics, the people on its Maintenance Schedule. A manager adds them, and each one's login ID, on Maintenance Schedule, `Setup`, `People`. With none yet, the line says so.
- **Work Orders:** pick one to start or finish your time on it.
- `+ Report a Problem`: pick the machine, say what is wrong and whether it is down (`Yes, it's down` or `No, it runs`), then `Send`.
- `Record a Breakdown`: a breakdown fixed on the spot. Type when it went down and came back up, then `Record`.
- The station has no Back or Home. `Release` (with the manager release code) is the only way out.
- **Station code:** once the plant's Maintenance Station has a code (Administration, Garage Station Codes), the tablet types it once. After that it opens only the Maintenance Station, and `Release` goes back to the code screen, never into the app.

- An Administrator frees the tablet with `Administrator sign-in` on the code screen (their own account). It forgets the station and opens Operations.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not type the Maintenance Station code on your own computer. It then opens only the Maintenance Station (an Administrator's account frees it).

# Plant Schedule

## Schedule Board
id: crew
screens: crew.html, maint-crew.html

Who works which job each day, Sunday to Saturday, by shift: the plant crew (loadout and production) on Plant Vacations & Schedule, the mechanics on Maintenance Schedule. Above each area, a line shows the jobs still short of people.

- Click a person's day to pick another job, or Off, for that week. `Usual` puts it back to their usual job.
- A day changed for this week reads "Changed this week".
- `Print` prints the board.

## Plant Vacations
id: crew-vacations
screens: crew.html?view=vacations, maint-crew.html?view=vacations

Time off for the plant crew or the mechanics, like the driver Vacation Schedule. Add the person, the first and last day and the type, then `Save Time Off`. The limit on how many can be off counts the same area and shift.

## Plant Schedule Setup
id: crew-setup
screens: crew.html?view=setup, maint-crew.html?view=setup

The areas with their own shift times, the jobs and how many people each needs, the people (name, employee ID, phone, usual job, shift, days off) and the vacation limits. Every box saves when you leave it.

On the Maintenance Schedule, the `People` tab also has a **Station login ID** box for each mechanic. These people are the names on the plant's [Maintenance Station](#maint-station).

1. Add the mechanic on `People` (`+ Add Person`) and type their name.
2. In their **Station login ID** box, type a 5- or 6-digit number and leave the box. It saves and the box then says `Set`.
3. Tell the mechanic their number. It is never shown again; type a new one to change it.

!> Do not give two mechanics the same login ID. The app will not save it.

## Plant Shifts
id: shifts
screens: shifts.html

The plant's shifts: name, side (Distribution or Plant Production), start, end and hours. `+ Add Shift` adds one; `Remove` takes one off. `Starting Shifts` fills in the usual shifts. Each box saves when you leave it.

## Location Areas
id: location-areas
screens: location-areas.html

Each plant's areas and sub-areas (pick the plant at the top right): whether each is on, its order, and its safety items. These are the areas the safety walk and the checklists use.

# Administration

## Administration
id: administration
screens: administration.html

Everything administrators set up, grouped down the left: People & Access, Links & Codes, Email & Schedules, Dispatch, Plant Setup, Keys & Connections, Tools and Repairs. Click an item to open it on the right. Type in **Find a setting** to find any item, including the ones that moved onto Dispatch Administration.

- `Open full screen` opens the item on its own page.
- Administration is for administrators only; the button in the top bar shows only to them.

!> Do not change a setting you are not sure about. Most changes reach every screen at once.

## People & Roles
id: admin-people
screens: administration.html?item=people

Everyone who can sign in. Add a person, then set their role, whether their account is active, which plants they see (All plants or each plant), the screens they may open, their Home screen, and each right (use the role's, allow or deny).

- Each change saves at once and nothing on the page moves.
- A person with no screens ticked sees every screen, as before.

!> Do not set someone Inactive to hide a screen from them. Untick the screen instead.

## Role Templates
id: admin-roles
screens: administration.html?item=role-templates

Pick a role and tick the rights it gets. Everyone with that role gets them. The Administrator role is protected and has every right.

## Access & QR Codes
id: admin-access
screens: administration.html?item=access-codes

A phone link and QR code for each employee. `Generate` makes one; `Regenerate` (press twice) makes a new one and stops the old one working.

## Links & Codes
id: admin-links
screens: administration.html?item=app-links, administration.html?item=station-codes, administration.html?item=garage-codes, administration.html?item=driver-codes, administration.html?item=manager-app-codes

Every link and code people use to reach the app:

- **Manager Links:** the full app, the phone link, the Plant Managers App and personal phone links (copy, print a QR, `Launch`), and each plant's manager release code to move a tablet or leave a kiosk.
- **Plant Station Codes:** the one Plant Station link, then each station's code (typed on the tablet to open that station). `+ Add Station`, `New code`, `Remove`. Under them, the **Line Tablet** link and the **Line Tablets** code.
- **Garage Station Codes:** the Garage Station and Maintenance Station links, each garage station's code, and the **Maintenance Station** code.
- A tablet or TV opened with its code opens only its own screen. `Release` (manager release code) takes it back to its code screen, never into the app.
- An Administrator is never locked. On any code screen, `Administrator sign-in` with an Administrator's own account frees that tablet or TV for good: it forgets its station and opens Operations.
- **Driver Station Codes:** the Driver Station link for the TV and the Driver Room tablet, each station's code, and the drivers' phone link with its Route Distribution code.
- **Plant Managers App:** the link for managers' phones and tablets, and each plant's Plant Managers code.

!> Do not make a new code while a station is in use. The tablet or TV must type the new code.

## Email settings
id: admin-email
screens: administration.html?item=repair-email, administration.html?item=email-senders, administration.html?item=report-recipients, administration.html?item=sent-log, administration.html?item=checkin-email

Where email goes and who it comes from:

- **Repair Email:** where repair email goes (Idealease, Penske, owned units), on or off, how often for each lessor, the digest hour, and `Send now`.
- **Email Senders:** email comes from the person who presses Send, and each plant's own address for automatic email.
- **Manager Report Recipients:** who gets the plant report at each plant. Remove is pressed twice.
- **Sent Email Log:** every email the app sent, newest first.
- **Driver Check-In Email:** the mailbox check for driver check-in email: on or off, sender, recipient, subject, and `Check now`. Pick the plant with `Location`; each plant keeps its own mailbox settings and its own check-ins.

## Refresh Rates
id: admin-refresh
screens: administration.html?item=refresh-rates

How often each background job runs (reading the sheets, GPS, sensors, email). Each one saves when it is picked. `Archive now` puts completed work away.

## Go-Live Switches
id: admin-switch
screens: administration.html?item=switch

Which screens are switched on, and the emergency stop.

- **Pause writing to the sheets** holds every save: screens keep saving, the saves wait, and **Resume** writes them to the sheets in order.
- One button turns on everything that is ready.

> Use Pause if something is writing wrong values to the sheets. Nothing is lost while paused.

## Machine Connections
id: machine-connections
screens: administration.html?item=machine-connections, linetargets.html?hookups=1, mocreo.html?part=thermometers

Everything hooked up to a machine, in one place: pick the plant, then the machine, then fill in that machine's details. Each plant has its own machines; nothing is shared between plants.

1. Press the plant at the top (`Uniontown`, `Charleston` or `Martins Ferry`). You only see the plants you work at.
2. Pick the machine on the left. The machines are grouped by area: Fillers, HTST, Boxing & Totes, Blow Mold, Shipping & Returns (the Palletizer and Case Returns counter boxes) and Coolers & Freezers (the thermometers). `Find a machine` narrows the list.
3. Fill in the machine on the right. Each box saves as you leave it.
   - **A production line:** `Counted by` (typed on the tablet, a sensor, a label reader or the machine controller), then the controller's brand, network address and where each reading is, with `Test read`, and its **RedZone line**.
   - **Palletizer or Case Returns:** the counter box's brand, network address, port and where the case total is, `Test read`, and `Make Counter Key` for the plant PC.
   - **Thermometers:** each MOCREO sensor's location, low and high limits, and on or off.

Each machine in the list says how it is doing:

- **Working** (green): it is hooked up and sending.
- **No answer** (red): it is set up but nothing has come in for 10 minutes. It stays red until it sends again.
- **Typed on tablet** (blue): the operator types the counts on the line tablet.
- **Not set up** (grey): nothing is hooked up yet.

> A line's products, speeds and targets stay on Line Targets. The MOCREO key is in MOCREO Key and the RedZone sign-in is in RedZone Sign-In.

!> Do not type a network address you are not sure of, and never one of RedZone's own boxes. Operations only reads a machine; it never changes anything on it or in RedZone.

## Case Counters
id: admin-counters
screens: administration.html?item=case-counters

The Palletizer and Case Returns counter boxes: brand, network address and where the case total is. `Test read` reads it once. Read only: nothing is changed on the counter box.

> These are machines in [Machine Connections](#machine-connections) now, under Shipping & Returns. `Find a setting` still finds Case Counters.

## Tools
id: admin-tools
screens: administration.html?item=window-test, administration.html?item=preflight, administration.html?item=update-live, administration.html?item=refresh-home, administration.html?item=plant-fresh, administration.html?item=date-inventory, administration.html?item=date-convert, administration.html?item=repair-items

- **Window Test Center:** opens every screen at each window size to check nothing is cut off.
- **Run Runtime Pre-Flight:** checks every sheet, column and setting the app needs and lists anything missing.
- **Update Live Sheets:** rebuilds the Current and Next weeks from Route Master and the drivers' standard runs, and adds missing runs (press twice).
- **Refresh Home Summary Now:** rebuilds the all-plants overview numbers right away.
- **Start Plant Fresh From Today:** starts the plant screens over from today's loads; older loads stop showing as left over.
- **Date Inventory** and **Date Column Dry Run / Convert:** practice copy only; they check and fix date columns in the sheets.
- **Remaining Repair Items:** the list of repairs still to do.

!> Do not press Update Live Sheets or Start Plant Fresh in the middle of a shift. They change what every screen shows.

## MOCREO Key
id: mocreo
screens: mocreo.html, administration.html?item=mocreo

The MOCREO temperature sensors' key. The thermometers themselves are in [Machine Connections](#machine-connections), under Coolers & Freezers.

1. Paste the MOCREO key once (it is never shown again). `Replace Key` changes it.
2. `Test Connection` checks it works.
3. In Machine Connections, **Thermometers**: each location has its sensor, low and high limits, and on or off. `Add Thermometer` adds one.
4. `Match to MOCREO Names` pairs your location names with the sensor names on the MOCREO website. Check the pairs, then `Save Matches`.

> A sensor already on another cooler says which, so one sensor is not picked twice.

## Menu Setup
id: menu-setup
screens: menu-setup.html, administration.html?item=menu-setup

Each plant's left menu in its own order. Move a section up or down, or to another side (Plant Distribution, Plant Production, Plant Vacations & Schedule, Plant Maintenance). `Start Over From the Standard Menu` puts it back.

## Upload Center
id: uploads
screens: uploads.html, administration.html?item=upload-center

Brings a new plant's data (routes, drivers, the plant, people and email) in from one Excel workbook. A save fills that plant's own screens (its Route Editor, Driver Roster, days off, lines, machines and the rest). Nothing shows on another plant's screens.

1. Pick the plant.
2. `Download Workbook` and have each person fill in their own tabs.
3. `Upload Workbook`.
4. Check every row: new, changed or a problem. `Download Problem List` saves the problems.
5. `Save` once it is right.

> You can fill a few tabs now and the rest later. A tab left empty keeps what was saved before. Uploading the same workbook again changes nothing, and a row you take out of a tab comes off that plant's screen.

> People in the workbook are added to People & Roles for that plant. Someone already there keeps their role and just gains the plant.

> Station codes and the Driver Check-In Email switch are not in the workbook. Make the codes on Station Codes and turn the check-in on in Driver Check-In Email.

!> Do not save with problems on the list. Fix the workbook and upload it again.

## Texts
id: schedule-texts
screens: texts.html, administration.html?item=schedule-texts

Texts to drivers from the company's Twilio number. Each kind of text has its own part and its own On / Off: **Schedule texts** (when a new week is posted) and **Load done texts** (when the plant finishes a driver's load, with any open pickups). Who gets each kind is ticked on the **Driver Roster**, under Texts; this screen only lists them.

1. Type the Twilio texting account and `Save account` (it is never shown again).
2. Try it: type your own phone in `Send a test text to` and press `Send test text`. Only that phone gets it, even with everything off.
3. Pick the drivers: tick **Schedule** and **Load** on the Driver Roster, or press `Ask drivers to sign up` (press it twice) to text every driver with a mobile phone who is not ticked yet. A **YES** reply ticks both; **STOP** unticks both.
4. Press `Turn On` in each part you want. **Who gets them** lists the ticked drivers.
5. **Texts and replies** shows each text and reply with its status.

> A load done text goes once per load, only for loads finished after you turned it on and ticked the driver.

!> Do not change the reply setting on the number in Twilio. The other United Dairy app uses it; YES and STOP replies are picked up here by themselves.

## Phone Screens
id: phone-screens
screens: phone-screens.html

The phone links are now in Administration > Links & Codes. This page points there.

## Being built
id: soon
screens: soon.html

A screen that is still being built opens this page, with a button to the screen to use meanwhile. Nothing here opens the old app.

# Phones and Stations

## Driver phone: Check-In, DVIR, schedule and loadout
id: route
screens: route.html, driver-room.html

What drivers use on their phone (and on the Driver Room tablet). The first time, the driver types the **Route Distribution code**, then their employee number or name.

- **Check-In** (after the route): truck, trailer and pallet jack, cases delivered and returned, over or short, refused or returned product, truck, trailer and pallet jack problems, whether the trailer needs cleaning, and notes. Then `Check In`.
- **DVIR** (truck inspection): pick Pre-trip or Post-trip. Every item starts as no defect; tick only what is wrong and write it up. The odometer starts at the truck's GPS reading. `+ Add trailer inspection` for a second trailer. Sign, then `Submit` (or `Review inspection` first).
- **My Schedule** shows the driver's routes for the week, Sunday to Saturday.
- **View Loadout** shows the route list and each load's status, updating by itself.
- With no signal, check-ins and DVIRs wait on the phone and go when the signal is back.

On the Driver Room tablet, 5 minutes with no taps signs the driver out and shows the rolling View Loadout. `Release` at the very bottom (manager release code) is the only way out, and it goes back to the code screen, never into the app. The tablet opens no other screen.

> The Driver Room tablet (not a driver's own phone) keeps its screen on by itself. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not check in for another driver. Pick `Not you?` and let them sign in.

## Plant Station tablet
id: plant-station
screens: plant-station.html

The plant floor tablets. Each one is opened once with its **Station code** (`OPEN STATION`) and then shows only that station's work: Case, Tote, Box and Tanker loading and unloading, Truck Washing, Product Returns or Yard Services (Assign Trailer and Check Temperatures).

- The station's screens work the same as the office screens of the same name. See [Loading](#loadout) and [Unloading](#unloading).
- `SKIP` on a load moves it down one place. One load can be skipped only 2 times in a row; then `SKIP` is grey and tapping it says to load it next.
- A station has no Home, Sign out or menu. Nothing on it opens any other screen of the app, and an address typed into the tablet comes straight back to the station.

### Case Unloading tablet

The Case Unloading tablet does two jobs. It opens on a choice of two big buttons:

1. Press `Case Unloading` for unloading, trailer washing and product returns, or `Trailer Assignments` for the trailer on each route.
2. Do the work.
3. Press `‹ Back` at the top to come back to the choice and pick the other one.

### Release and the code screen

1. A manager presses `Release` in the bottom-right corner.
2. The manager types the **Manager release code** and presses `RELEASE THIS STATION`.
3. The tablet goes back to the screen where a **Station code** is typed. That is all it can do until a station code is typed again.

> A tablet signed in with its station code alone (no United Dairy account) goes back to its station code box after Release.

### Administrator sign-in (taking a tablet off for good)

An Administrator is never locked to a station. A computer or tablet signed in with an Administrator's own account is never held on the station: a station screen shows an `Operations` button in the bottom-left corner that goes back to the app, and every other screen opens. A computer that was locked before frees itself as soon as an Administrator signs in on it.

1. On a locked tablet, a manager presses `Release` and types the manager release code. The code screen opens.
2. Press `Administrator sign-in` under the code box.
3. Sign in with your own United Dairy account. If you are an Administrator, the tablet forgets its station and opens Operations.

> Anyone who is not an Administrator is signed straight back out, and the tablet stays where it was.

> The screen stays on by itself while this screen is open. If it still goes dark, see [Keeping a tablet screen on](#screen-on).

!> Do not release a station to use the tablet for something else in the middle of a shift.

!> Do not type a station code on your own computer or phone to try it: that device then opens only the Plant Station. If you did, sign in with your Administrator account (or use `Administrator sign-in` on the code screen) to free it.

## Keeping a tablet screen on
id: screen-on

The station tablets, the line tablets, the Driver Room tablet and the TVs keep their screen on by themselves while their screen is open. Nothing needs pressing. If a tablet's screen still goes dark, the tablet's own settings are turning it off. Check these on the tablet, one at a time:

1. Plug the tablet in. A tablet left on its battery saves power by turning the screen off.
2. Open the tablet's **Settings**, then **Battery** (on some tablets **Battery and device care**). Turn **Power saving** off.
3. In **Settings**, open **Display**, then **Screen timeout**, and pick the longest time.
4. In **Settings**, open **Apps**, then **Chrome** (or the browser the station runs in), then **Battery**, and pick **Unrestricted**.
5. Open the station again and tap the screen once.

> The Garage tablet is set up by IT. If its screen still goes dark, ask IT to let the screen stay on in the tablet's lock-down setup and to turn power saving off.

!> Do not leave the station on a tablet that is not plugged in for a whole shift. It keeps the screen on, which uses up the battery.
