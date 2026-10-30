import type { PartyHistory } from './domain';

/** The roster usually arrives at once; a short wait still saves a request when it does not. */
const SETTLE_MS = 2000;
const RETRY_MS = 60_000;

/**
 * Asks the statistics service for the parties of a match roster: once per roster, after
 * it has settled, again a minute after an error. An answer for a match that is no longer
 * on screen is dropped; switching matches publishes null first, so old marks disappear.
 */
export class PartyLoader {
  private match = '';
  private pending = '';
  private loaded = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private load: (ids: string[]) => Promise<PartyHistory | null>,
    private publish: (matchId: string, history: PartyHistory | null) => void,
  ) {}

  request(matchId: string, ids: string[]) {
    if (matchId !== this.match) {
      const previous = this.match;
      this.stop();
      this.match = matchId;
      this.pending = this.loaded = '';
      if (previous) this.publish(matchId, null);
    }
    const sorted = [...new Set(ids)].sort();
    const key = sorted.join(',');
    if (sorted.length < 2 || key === this.pending || key === this.loaded) return;
    this.schedule(key, sorted, SETTLE_MS);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(key: string, ids: string[], delay: number) {
    this.stop();
    this.pending = key;
    const match = this.match;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.load(ids).then(
        (history) => {
          if (match !== this.match || key !== this.pending) return;
          this.pending = '';
          this.loaded = key;
          this.publish(match, history);
        },
        () => {
          if (match === this.match && key === this.pending) this.schedule(key, ids, RETRY_MS);
        },
      );
    }, delay);
  }
}
