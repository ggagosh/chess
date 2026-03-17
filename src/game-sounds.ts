type AudioContextConstructor = typeof AudioContext;

type Tone = {
  delayMs: number;
  durationMs: number;
  frequency: number;
  gain: number;
  type: OscillatorType;
};

export type GameSound = "capture" | "check" | "game-over" | "move" | "reset";

const SOUND_PATTERNS: Record<GameSound, readonly Tone[]> = {
  capture: [
    { delayMs: 0, durationMs: 70, frequency: 210, gain: 0.028, type: "square" },
    { delayMs: 48, durationMs: 90, frequency: 156, gain: 0.022, type: "triangle" },
  ],
  check: [
    { delayMs: 0, durationMs: 110, frequency: 392, gain: 0.02, type: "triangle" },
    { delayMs: 100, durationMs: 140, frequency: 523.25, gain: 0.024, type: "sine" },
  ],
  "game-over": [
    { delayMs: 0, durationMs: 160, frequency: 329.63, gain: 0.022, type: "triangle" },
    { delayMs: 120, durationMs: 220, frequency: 220, gain: 0.025, type: "sawtooth" },
  ],
  move: [
    { delayMs: 0, durationMs: 55, frequency: 440, gain: 0.018, type: "sine" },
    { delayMs: 44, durationMs: 70, frequency: 554.37, gain: 0.014, type: "triangle" },
  ],
  reset: [
    { delayMs: 0, durationMs: 100, frequency: 293.66, gain: 0.02, type: "triangle" },
    { delayMs: 84, durationMs: 120, frequency: 392, gain: 0.018, type: "sine" },
  ],
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const audioWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Context = window.AudioContext ?? audioWindow.webkitAudioContext;

  if (!Context) {
    return null;
  }

  audioContext ??= new Context();

  return audioContext;
}

function playTone(context: AudioContext, tone: Tone, startAt: number) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const toneStart = startAt + tone.delayMs / 1000;
  const toneEnd = toneStart + tone.durationMs / 1000;

  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, toneStart);

  gainNode.gain.setValueAtTime(0.0001, toneStart);
  gainNode.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(toneStart);
  oscillator.stop(toneEnd + 0.01);
}

export async function playGameSound(sound: GameSound, enabled: boolean) {
  if (!enabled) {
    return;
  }

  const context = getAudioContext();

  if (!context) {
    return;
  }

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch {
    return;
  }

  const pattern = SOUND_PATTERNS[sound];
  const startAt = context.currentTime + 0.01;

  for (const tone of pattern) {
    playTone(context, tone, startAt);
  }
}
