/**
 * A recording that plays from where a work stands, louder as you approach
 * and fainter as you leave, through the browser's spatial audio. The
 * element streams the served mp3, so nothing is decoded up front, and it
 * is paused again when the visitor walks away. Browsers only let audio
 * start after a gesture; the context is resumed on the first one.
 */
import { AudioListener, PositionalAudio } from "three";
import type { AudioVersion } from "../data/types";
import { assetUrl } from "./base";

let listener: AudioListener | null = null;

/** Called once from main with the listener that rides on the camera. */
export function setAudioListener(l: AudioListener) {
  listener = l;
  const resume = () => {
    if (l.context.state !== "running") void l.context.resume();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, resume, { passive: true });
}

export class Sound {
  private element: HTMLAudioElement | null = null;
  private node: PositionalAudio | null = null;
  private playing = false;

  constructor(private readonly version: AudioVersion) {}

  /** The node to add to the exhibit, at the work's centre. Null when there is nothing to play. */
  attach(): PositionalAudio | null {
    if (!listener || !this.version.encoded) return null;
    if (this.node) return this.node;
    const el = document.createElement("audio");
    el.src = assetUrl(this.version.encoded.url);
    el.loop = true;
    el.preload = "none";
    el.crossOrigin = "anonymous";
    this.element = el;
    const node = new PositionalAudio(listener);
    node.setMediaElementSource(el);
    // Full volume within a few metres, falling off by the inverse of the distance beyond.
    node.setDistanceModel("inverse");
    node.setRefDistance(3);
    node.setRolloffFactor(1.6);
    this.node = node;
    return node;
  }

  play() {
    if (this.playing || !this.element) return;
    this.playing = true;
    if (listener && listener.context.state !== "running") void listener.context.resume();
    this.element.play().catch(() => (this.playing = false));
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.element?.pause();
  }

  get isPlaying() {
    return this.playing;
  }

  dispose() {
    this.pause();
    this.node?.disconnect();
    this.node?.removeFromParent();
    if (this.element) {
      this.element.removeAttribute("src");
      this.element.load();
    }
    this.element = null;
    this.node = null;
  }
}
