import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { parseBounds } from './lib/bounds';
import { simSource } from './sources';
import type { SearchResponse } from '../shared/types';

/** Simulated aircraft ids (24-bit hex addresses). */
const ID_PATTERN = /^[0-9a-z-]{4,24}$/i;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

  app.get('/api/flights', async (req, res) => {
    const bounds = parseBounds(req.query.bbox);
    if (!bounds) {
      res.status(400).json({ error: 'bbox=south,west,north,east is required' });
      return;
    }
    res.set('Cache-Control', 'no-store').json(simSource.list(bounds));
  });

  app.get('/api/flights/:id', async (req, res) => {
    const id = flightId(req, res);
    if (!id) return;
    res.set('Cache-Control', 'no-store').json(simSource.detail(id));
  });

  app.get('/api/flights/:id/track', async (req, res) => {
    const id = flightId(req, res);
    if (!id) return;
    res.set('Cache-Control', 'no-store').json(simSource.track(id));
  });

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 20);
    const body: SearchResponse = { results: simSource.search(q) };
    res.json(body);
  });

  // ── Planning, booking and managing simulated flights ──────────────────────
  const sim = express.Router();
  sim.use(express.json({ limit: '256kb' }));
  const fail = (res: Response, err: unknown, status = 400) => res.status(status).json({ error: errorMessage(err) });

  sim.post('/plan', (req, res) => {
    const query = String(req.body?.query ?? '').slice(0, 200);
    const count = Number(req.body?.passengers);
    res.json(simSource.plan(query, Boolean(req.body?.advanced), Number.isFinite(count) && count > 0 ? count : null));
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
      res.json({ trip: simSource.book(String(req.body?.optionId ?? '')) });
    } catch (err) {
      fail(res, err);
    }
  });
  sim.post('/timer', (req, res) => {
    try {
      res.json(simSource.timer(Number(req.body?.minutes)));
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
  sim.get('/status', (req, res) => {
    const view = String(req.query.view ?? 'newest');
    const allowed = ['newest', 'booked', 'random', 'left-asc', 'left-desc'] as const;
    res.set('Cache-Control', 'no-store').json(simSource.status((allowed as readonly string[]).includes(view) ? (view as (typeof allowed)[number]) : 'newest'));
  });
  sim.get('/missed', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(simSource.missed());
  });
  sim.post('/flights/:id/nudge', (req, res) => {
    try {
      res.json(simSource.nudge(String(req.params.id).toLowerCase()));
    } catch (err) {
      fail(res, err);
    }
  });
  sim.post('/flights/:id/crash', (req, res) => {
    const result = simSource.crash(String(req.params.id).toLowerCase());
    if (!result) res.status(404).json({ error: 'That flight isn’t in the air.' });
    else res.json(result);
  });
  sim.get('/log/:id', (req, res) => {
    const details = simSource.logDetails(String(req.params.id));
    if (!details) res.status(404).json({ error: 'Log entry not found.' });
    else res.json(details);
  });
  sim.post('/clear', (_req, res) => {
    res.json({ removed: simSource.clear() });
  });
  app.use('/api/sim', sim);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Without the Vite dev server, the built UI is served from here too.
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
      console.log(`[server] FlightX simulator on http://localhost:${actual}`);
      return actual;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i === attempts - 1) throw err;
    }
  }
  throw new Error('unreachable');
}
