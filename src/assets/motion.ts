/**
 * A silent looping clip that stands in for a still when the visitor is
 * close. The video element is created on first use, plays muted and
 * inline (both required for autoplay, in VR included), and is paused
 * again when the visitor walks away so distant loops cost nothing.
 */
import { LinearFilter, SRGBColorSpace, VideoTexture } from "three";
import type { MotionLoop } from "../data/types";
import { assetUrl } from "./base";

export class Motion {
  private video: HTMLVideoElement | null = null;
  private texture: VideoTexture | null = null;
  private playing = false;

  constructor(private readonly loop: MotionLoop) {}

  private ensure(): VideoTexture {
    if (this.texture) return this.texture;
    const v = document.createElement("video");
    v.src = assetUrl(this.loop.url, this.loop.bytes);
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    this.video = v;
    const t = new VideoTexture(v);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    this.texture = t;
    return t;
  }

  /** Start playing; returns the texture to show. */
  play(): VideoTexture {
    const t = this.ensure();
    if (!this.playing) {
      this.playing = true;
      // Autoplay can still be refused before any user gesture; retry on the next play().
      this.video?.play().catch(() => (this.playing = false));
    }
    return t;
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.video?.pause();
  }

  get isPlaying() {
    return this.playing;
  }

  dispose() {
    this.pause();
    this.texture?.dispose();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.video = null;
    this.texture = null;
  }
}
