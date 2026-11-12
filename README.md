# FlightX

Every flight currently in the air, live on a satellite map — plus a Simulation mode where you
send your own realistic flights anywhere. Click any plane for its path, route, telemetry and photo.

**No API keys, no accounts, no cost.** The map and all flight data come from free services.

## Run it

1. `npm install` (first time only)
2. In VS Code, press **▶ (Run and Debug → "FlightX")** or **F5**.

FlightX opens in its own window. Close the window (or press Stop) to quit. Editing files in
`src/` updates the window instantly; edits to `server/` or `electron/` restart it.

Without VS Code: `npm run dev` does the same thing.

> Electron's installer needs Node 22+. On Node 18, if `npm install` fails while downloading
> Electron, run `npx -y node@22 node_modules/electron/install.js` — or upgrade Node
> (`nvm install 22 && nvm alias default 22`).

## Using it

- **Pan/zoom** the map. Planes are coloured by altitude and point along their track; between
  updates they keep moving (dead reckoning) so traffic flows smoothly.
- **Zoomed out** → world view from OpenSky (refreshes every 90 s).
  **Zoomed in** (viewport under ~250 NM) → real-time data every 8 s with registration,
  aircraft type and callsign labels.
- **Click a plane** → photo, airline, origin → destination with progress and ETA, altitude,
  vertical speed, ground speed, track, position, squawk, aircraft type, registration,
  operator. The map draws the flown path (coloured by altitude) and a dashed line to the
  destination. **Follow** keeps it centred; **Focus** hides every other plane and fits the
  whole flight on screen.
- **Search** (press `/`): callsign (`UAL1141`), registration (`N836NN`) or ICAO hex.

## Free data sources

| What                    | Source                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| Satellite imagery       | Esri World Imagery (+ Esri borders/places overlay)                     |
| Dark / light maps       | OpenFreeMap (OpenStreetMap data)                                       |
| World-wide positions    | OpenSky Network                                                        |
| Real-time local traffic | adsb.fi (1 request/s, no daily cap), adsb.lol as backup (500/day)      |
| Flown path              | OpenSky tracks + positions FlightX has seen                            |
| Route, airline, registry| adsbdb (routes are checked against the plane's position)               |
| Photos                  | Planespotters.net, airport-data.com (photographer credited)            |

All are free for personal, non-commercial use (FlightX is a private app, so credits live here rather than on screen).

FlightX is careful with these volunteer-run services: one wide request is reused while you
pan, the selected plane reuses that data, and if a service answers "slow down" (HTTP 429)
FlightX stops calling it until it says it may, showing OpenSky data meanwhile.
`FLIGHTX_DEBUG_HTTP=1 npm run dev` logs every real-time request if you want to watch.

### Optional `.env` settings

Nothing is required. A **free OpenSky account** makes the world view refresh every 30 s and
raises the daily allowance 10× (anonymous ≈ 2.5 h of world-view use per day). Create an API
client at <https://opensky-network.org/my-opensky/account> and fill in
`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` in `.env`. See `.env.example` for the rest.

## Project layout

```
.vscode/launch.json   The ▶ button config
electron/             Opens the window; runs the flight data service in-process
server/               Flight data service (Express on 127.0.0.1:8787)
  sources/types.ts    FlightSource interface — what any data source must provide
  sources/live/       OpenSky + adsb.fi/adsb.lol + adsbdb + photos, caching, rate limits
  sources/sim/        Simulator: trip parsing, planner, flight profiles, persistence
    dataset/          Airports, routes, airlines (built by scripts/build-sim-data.mjs)
shared/               Types + geo maths (great circles, dead reckoning)
src/                  React UI: MapLibre map + deck.gl aircraft layers, panel, search,
                      simulation sidebar (src/components/sim)
scripts/dev.mjs       What ▶ / `npm run dev` runs
```

`npm run server` runs only the data service (for curl debugging); `npm run typecheck`
type-checks everything.

## Simulation mode

FlightX opens in **Simulate** (switch with the tabs in the top bar). It's a separate world containing
only your simulated flights.

- **Send a flight:** type a trip in the sidebar, e.g. `Iowa to Florida` (FlightX picks realistic
  airline airports, weighted by how busy they are), `Iowa City to Miami` (nearest airline
  airports to each city), `DSM to MCO`, `Portland, Maine to Tokyo` or `O'Hare to Heathrow`.
  Press Enter and the best-match itinerary departs immediately.
- **Advanced mode:** set **Passengers flying**, then compare booking-site style options: nonstop / 1-stop / 2-stop routings on the
  real airline network, realistic connection times, aircraft, prices, with **Best match**,
  Cheapest and Fastest tagged, plus a private-charter option that makes fuel stops when the trip
  is beyond the jet's range. Click **Fly this** on any option.
- **Group size drives the aircraft:** charters pick the smallest aircraft whose cabin fits the group
  (Phenom 300 for a few people … A380 for hundreds), add fuel stops from the aircraft's range, offer a
  longer-range "fewer stops" alternative, and split huge groups across several planes. Airline options
  only appear if the group realistically fits (~30% of a flight's seats); prices are for the group.
- **Your own passengers:** on any option, **Add passengers** lets you name people (🎲 for a random one)
  and click seats to place them. Empty seats fill with random passengers (charters carry exactly your
  group size).
- **Spawn random flights:** 1 to 10,000 at a time (25,000 active max). They fly random real
  routes and connections.
- **Every plane is detailed:** airline, flight number, callsign, aircraft type, registration,
  ICAO address, squawk, altitude, speed, vertical rate, flight phase, local landing time, next
  connection, and a representative photo of the type (Wikipedia).
- **Realistic flight profiles:** taxi, climb, cruise at the type's real speed and altitude
  (with jet-stream wind), descent, approach and taxi-in, so flight times match real schedules.
- **Passengers & seat map:** each simulated flight shows how many are aboard; **Seat map** opens the
  aircraft's real cabin layout (both decks on a 747/A380). Click a seat for the passenger's name, age
  and nationality, drawn from ~30 cultural name groups that match the route.
- **Crash this plane:** two clicks, explosion included. It's logged as crashed.
- **Flight log:** every landed or crashed flight with its time, a ✈ booked / 🎲 random badge, and a
  **Passengers** button listing everyone it delivered (or who was aboard).
- **Real time, even while closed:** flights are stored as timestamped plans in
  `~/Library/Application Support/FlightX/simulation.json`. Close FlightX for 6 hours and a plane on
  an 8-hour flight will have 2 hours left; anything that landed meanwhile is in the log with its
  real touchdown time.

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

- `simulation.json` — active flight plans and settings (small; ~12 MB at the 25,000-trip maximum).
- `flight-log.jsonl` — every landed/crashed flight, one per line, only ever appended to.
- Both together are capped at **500 MB**; past that, the oldest log entries are deleted first
  (down to 450 MB). That's roughly 1.4 million flights of history.
- Your actions are saved within 2 seconds; landings within a minute and on quit (they can always be
  recomputed from the stored flight plans, so nothing is lost either way).
