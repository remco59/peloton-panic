// Commentary playback on the TV: queues lines, fetches voice audio from /api/tts
// (edge-tts on the server), and falls back to browser speech or silent captions.

import type { Line } from '../../shared/commentary';
import type { CommentatorId } from '../../shared/content';

export interface Caption {
  speaker: CommentatorId;
  text: string;
}

interface Item {
  line: Line;
  blob: Promise<Blob | null>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const readingTime = (text: string) => 900 + text.length * 55;

export class Broadcaster {
  unlocked = false;
  private queue: Item[] = [];
  private running = false;
  private current: HTMLAudioElement | null = null;

  constructor(
    private onCaption: (c: Caption | null) => void,
    private onUnlocked: () => void,
  ) {}

  /** Browsers only allow audio after a gesture; call this from a click or keypress. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      const a = new Audio(
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
      );
      await a.play();
      this.unlocked = true;
      this.onUnlocked();
    } catch {
      // still locked; the caller can ask again on the next gesture
    }
  }

  enqueue(lines: Line[]): void {
    for (const line of lines) {
      this.queue.push({ line, blob: this.fetchBlob(line) });
    }
    // Stay close to the action: never fall more than a few lines behind.
    while (this.queue.length > 5) this.queue.shift();
    void this.run();
  }

  clear(): void {
    this.queue = [];
    this.current?.pause();
    this.onCaption(null);
  }

  private async fetchBlob(line: Line): Promise<Blob | null> {
    try {
      const url = `/api/tts?v=${line.speaker}&t=${encodeURIComponent(line.text)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.onCaption({ speaker: item.line.speaker, text: item.line.text });
        await this.speak(item);
        await sleep(350);
      }
      await sleep(2200);
      if (this.queue.length === 0) this.onCaption(null);
    } finally {
      this.running = false;
    }
  }

  private async speak(item: Item): Promise<void> {
    if (!this.unlocked) return sleep(readingTime(item.line.text));
    const blob = await item.blob;
    if (blob) {
      const url = URL.createObjectURL(blob);
      try {
        const audio = new Audio(url);
        this.current = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('audio error'));
          audio.play().catch(reject);
        });
        return;
      } catch {
        // fall through to browser speech
      } finally {
        URL.revokeObjectURL(url);
        this.current = null;
      }
    }
    return this.browserSpeech(item.line);
  }

  private browserSpeech(line: Line): Promise<void> {
    const synth = window.speechSynthesis;
    if (!synth) return sleep(readingTime(line.text));
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = 'en-GB';
      u.rate = 1.05;
      u.pitch = line.speaker === 'marieke' ? 1.15 : 0.9;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
      // Never get stuck if the engine stays silent.
      setTimeout(resolve, readingTime(line.text) + 4000);
    });
  }
}
