/**
 * Standalone API server — handy for poking at the simulator without the desktop app:
 *   npm run server   →   curl "localhost:8787/api/sim/status"
 * The desktop app (electron/main.ts) starts this same server in-process.
 */
import 'dotenv/config';
import { startServer } from './app';

await startServer({ port: Number(process.env.PORT ?? 8787), strictPort: true });
