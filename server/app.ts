import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { config } from './config';
import { parseBounds } from './lib/bounds';
import { errorMessage, fetchJson } from './lib/http';
import { getSource, simSource } from './sources';
import type { FlightSource } from './sources/types';
import type { SearchResponse } from '../shared/types';

/** ICAO hex, or a non-ICAO "~xxxxxx" address (TIS-B), or a future sim id. */
const ID_PATTERN = /^~?[0-9a-z-]{4,24}$/i;

function source(req: Request, res: Response): FlightSource | null {
  const src = getSource(req.query.source);
  if (!src) res.status(400).json({ error: `Unknown source "${String(req.query.source)}"` });
  return src;
}

function flightId(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? '').toLowerCase();
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({ error: 'Invalid aircraft id' });
    return null;
  }
  return id;
}

export function createApp(staticDir: string | null) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());

  // Approximate location (city-level) from this computer's internet connection, for the
  // "flights near me" button when the system location isn't available to the app.
  let located: { at: number; value: { lat: number; lon: number; city: string | null } } | null = null;
  app.get('/api/locate', async (_req, res) => {
    if (located && Date.now() - located.at < 10 * 60_000) {
      res.json(located.value);
      return;
    }
    const providers: [string, (d: Record<string, unknown>) => { lat: number; lon: number; city: string | null }][] = [
      ['https://get.geojs.io/v1/ip/geo.json', (d) => ({ lat: Number(d.latitude), lon: Number(d.longitude), city: (d.city as string) || null })],
      ['https://ipwho.is/', (d) => ({ lat: Number(d.latitude), lon: Number(d.longitude), city: (d.city as string) || null })],
    ];
    for (const [url, parse] of providers) {
      try {
        const { data } = await fetchJson<Record<string, unknown>>(url, { timeoutMs: 6000 });
        const value = parse(data);
        if (Number.isFinite(value.lat) && Number.isFinite(value.lon)) {
          located = { at: Date.now(), value };
          res.json(value);
          return;
        }
      } catch {
        /* try the next provider */
      }
    }
    res.status(503).json({ error: 'Couldn’t determine your location.' });
  });

  app.get('/api/health', (req, res) => {
    const src = source(req, res);
    if (src) res.json(src.health());
  });

  app.get('/api/flights', async (req, res) => {
    const src = source(req, res);
    if (!src) return;
    const bounds = parseBounds(req.query.bbox);
    if (!bounds) {
      res.status(400).json({ error: 'bbox=south,west,north,east is required' });
      return;
    }
    res.set('Cache-Control', 'no-store').json(await src.list(bounds));
  });

  app.get('/api/flights/:id', async (req, res) => {
    const src = source(req, res);
    const id = src && flightId(req, res);
    if (!src || !id) return;
    res.set('Cache-Control', 'no-store').json(await src.detail(id));
  });

  app.get('/api/flights/:id/track', async (req, res) => {
    const src = source(req, res);
    const id = src && flightId(req, res);
    if (!src || !id) return;
    res.set('Cache-Control', 'no-store').json(await src.track(id));
  });

  app.get('/api/search', async (req, res) => {
    const src = source(req, res);
    if (!src) return;
    const q = String(req.query.q ?? '').slice(0, 20);
    const body: SearchResponse = { results: await src.search(q) };
    res.json(body);
  });

  // ── Simulation mode ──────────────────────────────────────────────────────
  const sim = express.Router();
  sim.use(express.json({ limit: '256kb' }));
  const fail = (res: Response, err: unknown, status = 400) => res.status(status).json({ error: errorMessage(err) });

  sim.post('/plan', (req, res) => {
    const query = String(req.body?.query ?? '').slice(0, 200);
    res.json(simSource.plan(query, Boolean(req.body?.advanced), Number(req.body?.passengers ?? 1)));
  });
  sim.post('/send', (req, res) => {
    try {
      res.json(simSource.send(String(req.body?.query ?? '').slice(0, 200)));
    } catch (err) {
      fail(res, err);
    }
  });
  sim.post('/book', (req, res) => {
    try {
      const passengers = Array.isArray(req.body?.passengers) ? req.body.passengers : [];
      res.json({ trip: simSource.book(String(req.body?.optionId ?? ''), passengers) });
    } catch (err) {
      fail(res, err);
    }
  });
  sim.post('/spawn', (req, res) => {
    try {
      res.json({ created: simSource.spawn(Number(req.body?.count ?? 1)) });
    } catch (err) {
      fail(res, err);
    }
  });
  sim.get('/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(simSource.status());
  });
  sim.post('/flights/:id/crash', (req, res) => {
    const result = simSource.crash(String(req.params.id).toLowerCase());
    if (!result) res.status(404).json({ error: 'That flight isn’t in the air.' });
    else res.json(result);
  });
  sim.get('/flights/:id/passengers', (req, res) => {
    const m = simSource.passengers(String(req.params.id).toLowerCase());
    if (!m) res.status(404).json({ error: 'That flight isn’t running any more.' });
    else res.json(m);
  });
  sim.get('/log/:id/passengers', (req, res) => {
    const m = simSource.logPassengers(String(req.params.id));
    if (!m) res.status(404).json({ error: 'Log entry not found.' });
    else res.json(m);
  });
  sim.get('/seatmap/:type', (req, res) => {
    res.json(simSource.seatMapFor(String(req.params.type).toUpperCase().slice(0, 6), req.query.charter === '1'));
  });
  sim.get('/random-person', (_req, res) => {
    res.json(simSource.randomPerson());
  });
  sim.post('/clear', (_req, res) => {
    res.json({ removed: simSource.clear() });
  });
  app.use('/api/sim', sim);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // The packaged desktop app serves the built UI from here too.
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server]', err);
    res.status(500).json({ error: errorMessage(err) });
  });

  return app;
}

export interface StartOptions {
  port: number;
  /** Built UI to serve (packaged app). Null in development, where Vite serves the UI. */
  staticDir?: string | null;
  /** Fail instead of trying the next ports when `port` is taken. */
  strictPort?: boolean;
}

/** Starts the API on 127.0.0.1 (never exposed to the network). Resolves with the port in use. */
export async function startServer({ port, staticDir = null, strictPort = false }: StartOptions): Promise<number> {
  const app = createApp(staticDir);
  const attempts = strictPort ? 1 : 10;
  for (let i = 0; i < attempts; i++) {
    const tryPort = port + i;
    try {
      const actual = await new Promise<number>((resolve, reject) => {
        const server = app.listen(tryPort, '127.0.0.1');
        server.once('listening', () => resolve((server.address() as AddressInfo).port));
        server.once('error', reject);
      });
      const os = config.opensky;
      console.log(`[server] FlightX API on http://localhost:${actual}`);
      console.log(`[server] OpenSky: ${os.authenticated ? 'authenticated' : 'anonymous (400 credits/day)'} · world snapshot every ${os.refreshSeconds}s`);
      return actual;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i === attempts - 1) throw err;
    }
  }
  throw new Error('unreachable');
}
