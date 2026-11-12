/**
 * The flight log on disk: an append-only JSON-lines file (one flight per line),
 * so saving never rewrites old history. Only the newest entries are kept in
 * memory. When the save data would exceed its size budget, the oldest lines are
 * trimmed off the front of the file.
 */
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, appendFileSync, fstatSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { SimLogEntry } from '../../../shared/sim';

/** Newest entries kept in memory (the sidebar shows the latest 300). */
const RECENT = 20_000;
/** After trimming, the log is brought down to this fraction of its budget (so trims are rare). */
const TRIM_TO = 0.9;

export class FlightLogFile {
  /** Newest entries, oldest first. */
  recent: SimLogEntry[] = [];
  total = 0;
  bytes = 0;
  private pending: SimLogEntry[] = [];
  private trimming = false;

  constructor(
    private readonly file: string,
    /** Bytes the log may use (the overall limit minus the main save file). */
    private readonly budget: () => number,
  ) {
    this.load();
  }

  private load() {
    if (!existsSync(this.file)) return;
    const fd = openSync(this.file, 'r');
    try {
      const size = fstatSync(fd).size;
      this.bytes = size;
      // Count entries (one per line) without loading the whole file.
      const chunk = Buffer.alloc(4 * 1024 * 1024);
      let pos = 0;
      let lines = 0;
      while (pos < size) {
        const n = readSync(fd, chunk, 0, chunk.length, pos);
        for (let i = 0; i < n; i++) if (chunk[i] === 10) lines++;
        pos += n;
      }
      this.total = lines;
      // Read just the tail for the in-memory recent entries.
      const tailBytes = Math.min(size, RECENT * 900);
      const tail = Buffer.alloc(tailBytes);
      readSync(fd, tail, 0, tailBytes, size - tailBytes);
      const rows = tail.toString('utf8').split('\n');
      if (tailBytes < size) rows.shift(); // partial first line
      for (const row of rows.slice(-RECENT - 1)) {
        if (!row.trim()) continue;
        try {
          this.recent.push(JSON.parse(row) as SimLogEntry);
        } catch {
          /* skip a damaged line */
        }
      }
      this.recent = this.recent.slice(-RECENT);
    } finally {
      closeSync(fd);
    }
  }

  add(entry: SimLogEntry) {
    this.recent.push(entry);
    if (this.recent.length > RECENT * 1.1) this.recent.splice(0, this.recent.length - RECENT);
    this.pending.push(entry);
    this.total++;
  }

  sortRecent() {
    this.recent.sort((a, b) => a.at - b.at);
  }

  private takePending(): string {
    const lines = this.pending.sort((a, b) => a.at - b.at).map((e) => JSON.stringify(e)).join('\n');
    this.pending = [];
    return lines ? `${lines}\n` : '';
  }

  /** Appends new entries to disk and trims the oldest if over budget. */
  async flush() {
    const text = this.takePending();
    if (text) {
      mkdirSync(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, text);
      this.bytes += Buffer.byteLength(text);
    }
    if (this.bytes > this.budget()) await this.trim();
  }

  flushSync() {
    const text = this.takePending();
    if (!text) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    appendFileSync(this.file, text);
    this.bytes += Buffer.byteLength(text);
  }

  /** Drops the oldest lines so the file fits back within ~90% of its budget. */
  private async trim() {
    if (this.trimming) return;
    this.trimming = true;
    try {
      const size = statSync(this.file).size;
      const target = Math.max(0, Math.floor(this.budget() * TRIM_TO));
      const cutAtLeast = size - target;
      if (cutAtLeast <= 0) return;
      // Find the first line boundary after `cutAtLeast` bytes, counting removed lines.
      const fd = openSync(this.file, 'r');
      const chunk = Buffer.alloc(4 * 1024 * 1024);
      let pos = 0;
      let removed = 0;
      let cut = -1;
      try {
        while (pos < size && cut < 0) {
          const n = readSync(fd, chunk, 0, chunk.length, pos);
          for (let i = 0; i < n; i++) {
            if (chunk[i] !== 10) continue;
            removed++;
            if (pos + i + 1 >= cutAtLeast) {
              cut = pos + i + 1;
              break;
            }
          }
          pos += n;
        }
      } finally {
        closeSync(fd);
      }
      if (cut < 0) cut = size;
      const tmp = `${this.file}.tmp`;
      await pipeline(createReadStream(this.file, { start: cut }), createWriteStream(tmp));
      renameSync(tmp, this.file);
      this.bytes = statSync(this.file).size;
      this.total = Math.max(0, this.total - removed);
      console.log(`[sim] flight log over its size limit: removed the ${removed.toLocaleString()} oldest entries`);
    } catch (err) {
      console.warn(`[sim] trimming the flight log failed: ${String(err)}`);
    } finally {
      this.trimming = false;
    }
  }
}
