import type { Encounter } from '../shared/encounters';
import { encounterVolume } from './preferences';

type Chime = {
  wave: OscillatorType;
  /** Seconds to full level; short for a sharp pulse, longer for a soft note. */
  attack: number;
  /** Share of the chosen volume: a note stays in the background of the game's sound. */
  level: number;
  /** Frequency (Hz), start and length (seconds) of each note. */
  notes: [number, number, number][];
};
/**
 * A noted player: two soft rising sine notes at 30% of the chime volume, once per match look.
 */
const CHIMES: Record<Encounter, Chime> = {
  note: {
    wave: 'sine',
    attack: 0.025,
    level: 0.3,
    notes: [
      [659.25, 0, 0.7],
      [987.77, 0.2, 0.7],
    ],
  },
};
/** Peak gain at 100%; the compressor keeps overlapping notes from clipping. */
const PEAK = 0.85;

let context: AudioContext | undefined;
function audio() {
  context ??= new AudioContext();
  // WebKit may start the context suspended until the first click in the window.
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => context?.state === 'suspended' && void context.resume(), true);
}

/** Synthesised, so no sound file ships with the app. Failures are silent. */
export function playChime(kind: Encounter, volume = encounterVolume()) {
  if (volume <= 0) return;
  try {
    const ctx = audio();
    const start = ctx.currentTime + 0.02;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 8;
    limiter.connect(ctx.destination);
    const { wave, attack, level, notes } = CHIMES[kind];
    const peak = (PEAK * level * volume) / 100;
    for (const [frequency, at, length] of notes) {
      const time = start + at;
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.type = wave;
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
      tone.connect(gain).connect(limiter);
      tone.start(time);
      tone.stop(time + length + 0.02);
    }
  } catch {
    /* No audio output: the note still shows in the table. */
  }
}
