/**
 * Loads `<project>/.env` before any server module reads process.env.
 * Imported first by main.ts (ES module imports evaluate in order).
 */
import { app } from 'electron';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(app.getAppPath(), '.env'), quiet: true });

// Simulation state (flights + flight log) lives in FlightX's app-data folder:
// ~/Library/Application Support/FlightX/simulation.json
process.env.FLIGHTX_DATA_DIR ??= app.getPath('userData');
