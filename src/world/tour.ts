/**
 * A guided first visit: a short path through the museum, one line about
 * each stop, for someone who does not yet know what to look for. T (or
 * the tour buttons on a phone) goes to the next stop; Shift T goes back.
 * Where you are in it is remembered in the browser, so a visit can be
 * picked up where it was left. Walking off between stops is fine; the
 * next press carries on from the next stop.
 *
 * Stops name works by id; one that is not on display is skipped, so the
 * tour survives the collection changing under it.
 */
import type { Artwork } from "../data/types";

export interface Stop {
  id: string;
  /** One line, said on arrival. */
  line: string;
}

export const TOUR: Stop[] = [
  { id: "zen-21530762", line: "A hand axe from Saint-Acheul, 300,000 years old. Someone chose this shape and worked stone to it, and so did a thousand generations after." },
  { id: "wm-29686577", line: "The Lion-man, carved from mammoth ivory 40,000 years ago: a creature no one had ever seen. The oldest image of something imagined." },
  { id: "sf-e8f121d0545247318781ef3981fdfdaa", line: "A wall of Lascaux, cast from the cave. The deer's neck is one stroke, made 17,000 years ago by lamplight in the dark." },
  { id: "sf-5c56a4feeb8e4c67b5a4d903b4a96e5a", line: "Khufu's ship, buried beside the Great Pyramid 4,500 years ago: 43 metres of cedar sewn together with rope, and still whole." },
  { id: "sf-7e7febabef2045a68755cc39c8c7c91f", line: "Stonehenge. The stones were set so that at midsummer the sun comes up along their axis. Wait, and it does." },
  { id: "wm-164288965", line: "The Nebra sky disc, the oldest known picture of the heavens. Above is the sky it was made under; the Pleiades are low in the west, as they are on the disc." },
  { id: "sf-d148f771c3f44225b56cb7ce8d3c5ce6", line: "Nefertiti, carved in Thutmose's workshop at Amarna about 1345 BCE and left on a shelf when the city was abandoned. One eye was never finished." },
  { id: "sf-abf31556e54849408ced19e58f3dc8f1", line: "An Olmec colossal head: a portrait of a ruler, cut from a forty-tonne boulder and moved sixty kilometres without wheels, three thousand years ago." },
  { id: "sf-50f50abf45414ad8a658325df7a5fcb3", line: "Myron's discus thrower, about 450 BCE: the first sculpture anywhere to catch a body in the middle of a movement." },
  { id: "eq-pythagorean-theorem", line: "The Pythagorean theorem as Euclid proved it in Alexandria, around 300 BCE. Beside it, a scrap of papyrus with Euclid's own diagram, a few centuries on." },
  { id: "sf-5f35ab370082403e8c7829388f4e0c30", line: "The Pantheon, Rome, 126 CE, still the largest dome of unreinforced concrete. At noon on 21 April the sun through the oculus lands on the arch over the door." },
  { id: "wm-47597960", line: "The Tirukkural: 1,330 couplets on virtue, wealth and love, written in Tamil around 450 CE by Thiruvalluvar, on a palm leaf with the commentary that made it a classic." },
  { id: "wm-50738349", line: "The Big Temple at Thanjavur, 1010 CE: a 66 metre tower of granite on a plain with no granite in it, raised by the Chola emperor Rajaraja." },
  { id: "sf-6862a3c673d4434a8dc39ced2a5b5720", line: "Shiva as Lord of the Dance, cast in bronze by Chola craftsmen a thousand years ago. The ring of fire is the universe; the dwarf underfoot is ignorance." },
  { id: "sf-da8c663b974f4902bf79bb9595e76d5e", line: "A courtyard of the Alhambra, Granada: brick, plaster and tile, the cheapest materials, carrying the finest surfaces Islamic Spain ever made." },
  { id: "wm-50410532", line: "Leonardo's Last Supper at its real size, nearly nine metres across: the moment after 'one of you will betray me'." },
  { id: "sf-57333014332a49f4b3346bc73ef7fc16", line: "Bernini's Apollo and Daphne: the instant she turns into a laurel, bark climbing her legs, her fingers splitting into leaves. He was twenty-four." },
  { id: "wm-11812879", line: "Newton's Principia, 1687: three laws of motion and one of gravity, for everything that moves, in one book." },
  { id: "sim-fourier-series", line: "Fourier's claim of 1822: any repeating shape is a sum of pure waves. Circles riding on circles trace a square wave; every circle added sharpens the corners." },
  { id: "wm-23750619", line: "Impression, Sunrise: Le Havre at dawn, 1872. A critic used its title to mock the painters, and they kept the name." },
  { id: "si-nasm_A19610048000", line: "The 1903 Wright Flyer, the machine itself. Twelve seconds in the air at Kitty Hawk, the first powered flight with a person aboard." },
  { id: "usr-coimbatore-thayi-tevaram", line: "A Tamil hymn twelve centuries old, sung in 1910 by Coimbatore Thayi, the first Tamil singer the gramophone made famous. Come close and it plays." },
  { id: "wm-22628920", line: "Monet's water lilies, in the room he made them for. Walk to the middle and turn: the pond goes all the way round, as he asked." },
  { id: "sim-lorenz-attractor", line: "The Lorenz attractor, 1963: three equations whose solutions never repeat and never leave this shape. The red point is flying them now, and no one can say which wing it takes next." },
  { id: "wm-91010657", line: "The first step on the Moon, 21 July 1969, as six hundred million people saw it on television. It plays as you come close." },
  { id: "sim-the-moon-mapped", line: "The whole Moon, mapped; no one had seen its far side before 1959. The red dot is Tranquility Base. Above is the evening sky of 20 July 1969, the Moon a crescent in the west." },
  { id: "sim-game-of-life", line: "Conway's Game of Life, 1970: three rules on a grid, and out of them gliders, guns, and anything a computer can compute. It is running." },
  { id: "sim-mandelbrot-set", line: "The Mandelbrot set, 1980: a simple sum repeated for every point, and an edge with no end. It is computed afresh, and zooming, as you watch." },
  { id: "sf-5f7176a2ae284d6b99fc970c9d265c04", line: "Space Shuttle Discovery, 39 flights, more than any other spacecraft. Under the wing, the tiles: each fitted by hand, no two alike." },
  { id: "sf-485c51878bc7449e81379a863ec862f5", line: "The first iPhone, 2007, at its true 11 centimetres." },
];

const KEY = "20watts.tour.v1";
const SHOW_SECONDS = 14;

export class Tour {
  private readonly stops: Stop[];
  private at = -1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    visible: Artwork[],
    private readonly goTo: (id: string) => boolean,
    private readonly caption: HTMLElement | null,
  ) {
    const ids = new Set(visible.map((a) => a.id));
    this.stops = TOUR.filter((s) => ids.has(s.id));
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isInteger(saved) && saved >= -1 && saved < this.stops.length) this.at = saved;
    } catch {
      /* no storage: the tour starts at the beginning each time */
    }
  }

  /** From the beginning. */
  start() {
    this.at = -1;
    this.step(1);
  }

  /** The next stop (dir 1) or the previous (dir -1). At either end it says so and stays. */
  step(dir: 1 | -1) {
    const next = this.at + dir;
    if (next < 0 || next >= this.stops.length) {
      this.say(dir > 0 ? "That is the end of the tour. Wander." : "This is the first stop.", null);
      return;
    }
    this.at = next;
    try {
      localStorage.setItem(KEY, String(this.at));
    } catch {
      /* fine */
    }
    const stop = this.stops[this.at]!;
    this.goTo(stop.id);
    this.say(stop.line, `${this.at + 1} of ${this.stops.length}`);
  }

  private say(text: string, count: string | null) {
    if (!this.caption) return;
    this.caption.replaceChildren();
    if (count) {
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = count;
      this.caption.append(n);
    }
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = text;
    this.caption.append(line);
    if (count && this.at < this.stops.length - 1) {
      const hint = document.createElement("span");
      hint.className = "next";
      hint.textContent = "T for the next stop";
      this.caption.append(hint);
    }
    this.caption.classList.add("on");
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.caption?.classList.remove("on"), SHOW_SECONDS * 1000);
  }
}
