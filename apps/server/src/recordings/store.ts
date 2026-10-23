import fs from "node:fs";
import path from "node:path";

/**
 * Recordings are copied off the voice platform onto our private disk and only ever served through
 * the authenticated dashboard API. File names are our call ids, never caller details.
 */
export class RecordingStore {
  constructor(
    private readonly dir: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  async download(url: string, callId: number): Promise<string | null> {
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return null;
      const ext = url.split("?")[0].endsWith(".wav") ? "wav" : "mp3";
      const file = `call-${callId}.${ext}`;
      fs.writeFileSync(path.join(this.dir, file), Buffer.from(await res.arrayBuffer()));
      return file;
    } catch (e) {
      console.error("recording download failed", (e as Error).message);
      return null;
    }
  }

  /** Absolute path for a stored file, refusing anything that escapes the directory. */
  resolve(file: string): string | null {
    const full = path.resolve(this.dir, file);
    if (!full.startsWith(path.resolve(this.dir) + path.sep) || !fs.existsSync(full)) return null;
    return full;
  }
}
