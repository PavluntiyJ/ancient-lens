import type { Encounter } from '../shared/encounters';

/** Two short notes: rising for a noted player, falling and lower for a "Watch out" note. */
const CHIMES: Record<Encounter, number[]> = {
  note: [659.25, 880],
  avoid: [392, 293.66],
};
const NOTE = 0.16;
const VOLUME = 0.18;

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
export function playChime(kind: Encounter) {
  try {
    const ctx = audio();
    const start = ctx.currentTime + 0.02;
    CHIMES[kind].forEach((frequency, index) => {
      const at = start + index * NOTE;
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(VOLUME, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE * 2);
      tone.connect(gain).connect(ctx.destination);
      tone.start(at);
      tone.stop(at + NOTE * 2 + 0.02);
    });
  } catch {
    /* No audio output: the note still shows in the table. */
  }
}
