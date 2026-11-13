# FlightX

A flight simulator on a satellite map of the Earth with real day and night. Send realistic flights
anywhere (or for an exact length of time), spawn random traffic, and click any plane for its path, telemetry,
passenger counts. Everything keeps flying in real time, even while FlightX is closed.

**No API keys, no accounts, no cost.**

## Run it

1. `npm install` (first time only)
2. In VS Code, press **▶ (Run and Debug → "FlightX")** or **F5**.

FlightX opens in its own window. Close the window (or press Stop) to quit. Editing files in
`src/` updates the window instantly; edits to `server/` or `electron/` restart it.

Without VS Code: `npm run dev` does the same thing.

> Electron's installer needs Node 22+. On Node 18, if `npm install` fails while downloading
> Electron, run `npx -y node@22 node_modules/electron/install.js` — or upgrade Node
> (`nvm install 22 && nvm alias default 22`).

## The map

- Satellite imagery with the real night side of the Earth and city lights, updated every few minutes.
  Country and state borders and place names are drawn on top (no county lines).
- **Plane colours:** grey on the ground, yellow = randomly spawned, green = sent by you.
- **Click a plane** → photo of the type, airline, origin → destination with progress, takeoff and
  landing times (your time zone; hover for the airport's), passengers aboard, altitude, speeds,
  position, aircraft and registration. **Follow** keeps it centred; **Focus** hides every other
  plane and fits the whole flight on screen; **Crash this plane** does what it says.
- **Chill mode:** follow a plane and leave the mouse alone for 30 s — the UI fades away and only a
  small arrival countdown remains (a screensaver). Move the mouse to bring everything back.
- **Search** (press `/`): flight number (`UA 239`), callsign, registration or airport code.

## Making flights

- **Fly somewhere:** type a trip in the sidebar, e.g. `Iowa to Florida` (FlightX picks realistic
  airline airports, weighted by how busy they are), `Iowa City to Miami`, `Wilton Iowa to Lafayette IN`,
  `DSM to MCO`, `Portland, Maine to Tokyo` or `O'Hare to Heathrow`. Press Enter and the best-match
  itinerary departs immediately.
- **Timer flight:** type a length of time (hours and minutes, up to 72 hours)
  and FlightX sends a normal flight on a random real-world airline route that parks at its gate exactly
  that long from now. Long times connect through several flights; the shortest possible is about 12 minutes.
- **Advanced mode:** compare booking-site style options: nonstop / 1-stop / 2-stop
  routings on the real airline network and aircraft, with **Best match** and Fastest tagged.
  Normally each plane carries a realistic load for its size. Switch on **Choose passengers** to send an exact
  number (any amount, e.g. 700): the plane is filled and later departures of the same itinerary (every 45 minutes)
  carry the rest. Click **Fly this** on any option.
- **Custom planes** (Advanced mode, above the airline results), with real-world performance:
  - **Cessna 172 Skyhawk** — 140 mph, 3 passengers plus the pilot, fuel stops every ~600 mi (can't cross oceans on realistic fuel).
  - **Concorde** — 100 seats, Mach 2.04 over the ocean only (subsonic over land, like the real sonic-boom rules), fuel stops
    every ~4,000 mi. London → New York takes about 3 h 20 m.
  - **B-2 Spirit** — Mach 0.85, 2 seats (the crew), refuels from tankers in mid-air every ~6,300 mi instead of landing.
  - **Lockheed Martin X-59 QueSST** — Mach 1.42 over land (its quiet "thump"), 1 seat (the pilot), fuel stops every ~860 mi
    (NASA hasn't published its range; this is an estimate).
  - **Lockheed SR-71 Blackbird** — Mach 3.2 at 80,000 ft, 2 seats (the crew). Realistic fuel: a tanker right after takeoff
    (it took off light, like the real one), then every ~2,900 mi.
  - **Hindenburg (LZ 129)** — airship, 76 mph a few hundred feet up, 72 passengers, ~8,000 mi range (call sign DEKKAR).
  - **Walk** — 3.1 mph on foot, switching to a swimmer at 2 mph over water (the icon changes too). Never stops to rest;
    fuel doesn't apply, so its fuel switch is greyed out.

  Each plane's card has its own fuel switch: **Realistic** (stops / mid-air refuelling, the default) or **Unlimited** (nonstop);
  times update to match. The Custom planes dropdown starts closed for every search.
  Groups bigger than a plane's seats fly in several planes.
- **Spawn random flights:** any number at a time, no limit. They fly random real
  routes and connections.

## How the simulation works

- **Realistic flight profiles:** taxi, climb, cruise at the type's real speed and altitude
  (with jet-stream wind), descent, approach and taxi-in, so flight times match real schedules.
- **Runway queues:** a lone plane taxis out in a couple of minutes; busy airports queue departures
  and arrivals (holding in the descent), so congestion adds time.
- **Quick turns:** connections and fuel stops take at most 10 minutes at the gate, then the plane
  joins the taxi queue.
- **Passengers:** each flight shows how many are aboard out of its seats — a realistic load, or exactly the number
  you chose (custom planes: split across planes; a B-2 always carries its 2 crew, an X-59 its pilot).
- **Flight log:** every landed or crashed flight with its time, a Yours / Random badge and how many passengers
  it delivered. Click an entry for details.
- **Real time, even while closed:** flights are stored as timestamped plans. Close FlightX for 6 hours
  and a plane on an 8-hour flight will have 2 hours left; anything that landed meanwhile is in the log
  with its real touchdown time, and **Things you missed** summarizes it on the next launch.

## Project layout

```
.vscode/launch.json   The ▶ button config
electron/             Opens the window; runs the simulator service in-process
server/               Simulator service (Express on 127.0.0.1:8787)
  sources/sim/        Trip parsing, planner, flight profiles, runway
                      queues, passengers, persistence
    dataset/          Airports, routes, airlines (built by scripts/build-sim-data.mjs)
shared/               Types + geo maths (great circles, dead reckoning)
src/                  React UI: MapLibre map + deck.gl aircraft layers, panel, search,
                      sidebar (src/components/sim)
scripts/dev.mjs       What ▶ / `npm run dev` runs
```

`npm run server` runs only the simulator service (for curl debugging); `npm run typecheck`
type-checks everything.

## Free services and data

| What                     | Source                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| Satellite imagery        | Esri World Imagery                                                             |
| Borders & place names    | OpenFreeMap vector tiles (© OpenStreetMap contributors)                        |
| Night side & city lights | NASA GIBS VIIRS Black Marble                                                   |
| Aircraft type photos     | Wikipedia                                                                      |
| Land / sea (Concorde)    | Natural Earth 1:50m land (public domain), via `scripts/build-landmask.mjs`     |
| Walk / swim map icons    | Material Design icons (Apache License 2.0)                                     |

All are free for personal, non-commercial use (FlightX is a private app, so credits live here rather than on screen).

Sim reference data:

- **Routes, airlines, fleets, registrations:** [Virtual Radar Server standing data](https://github.com/vradarserver/standing-data)
  (public domain / CC0, community-maintained and updated daily). Cargo and business-jet operators are
  filtered out, merged airlines map to today's operator, regional partners are sold under their
  mainline brand ("UA 5123 operated by SkyWest"), and aircraft are picked from each operator's real fleet.
- **Airports, regions, countries:** [OurAirports](https://ourairports.com/data/) (public domain).
- **Airport time zones:** [OpenFlights](https://openflights.org/data) airports (ODbL).

To refresh the routes: clone `https://github.com/vradarserver/standing-data`, download OurAirports'
`airports.csv`, `regions.csv`, `countries.csv` and OpenFlights' `airports.dat` into one folder, then run
`node scripts/build-sim-data.mjs <that folder> <standing-data checkout>`.

Saving (in `~/Library/Application Support/FlightX/`):

- `simulation.json` — active flight plans and settings (about 0.5 MB per 1,000 active trips).
- `flight-log.jsonl` — every landed/crashed flight, one per line, only ever appended to.
- Both together are capped at **500 MB**; past that, the oldest log entries are deleted first
  (down to 450 MB). That's roughly 1.4 million flights of history.
- Your actions are saved within 2 seconds; landings within a minute and on quit (they can always be
  recomputed from the stored flight plans, so nothing is lost either way).
