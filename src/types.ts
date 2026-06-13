export interface Pt {
  x: number;
  y: number;
}

export interface Layer {
  id: string;
  /** Content hash key into the image blob store. */
  imageId: string;
  /** Center position in untransformed stage coordinates (px). */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  z: number;
  /** 0..1 */
  opacity: number;
  /** Frozen in place: geometry (move/scale/rotate) and deletion are blocked. */
  locked: boolean;
  /** Render with colors inverted (negative) — useful for tracing. */
  invert: boolean;
  /**
   * Replace the image with detected edges (object outline + colour
   * boundaries) drawn as bright lines — high-visibility tracing in daylight.
   * Absent/`on: false` means show the original image.
   */
  outline?: OutlineOpts;
}

export interface OutlineOpts {
  on: boolean;
  /** Edge sensitivity, 0..1 relative to the image's strongest edge (lower = more lines). */
  threshold: number;
  /** Line thickness as a dilation radius in source pixels (0 = thinnest). */
  thickness: number;
  /** Line colour as a `#rrggbb` hex string. */
  color: string;
}

/** Outline settings applied when the effect is first switched on. */
export function defaultOutline(): OutlineOpts {
  return { on: true, threshold: 0.18, thickness: 1, color: '#ff00ff' };
}

export interface KeystoneState {
  /** Tilt angles in degrees, applied about the stage center. */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** Perspective (camera) distance in px. */
  persp: number;
  /**
   * Physical canvas size in any unit (only the ratio matters). When set, the
   * homography's source is a centered rect of this aspect instead of the full
   * viewport, so content keeps its proportions when pinned onto the canvas.
   */
  canvasW?: number;
  canvasH?: number;
  /**
   * Per-corner nudge added after the rotation projection, as a fraction of
   * stage width/height so it survives window-size changes. Order: TL TR BR BL.
   */
  offsets: [Pt, Pt, Pt, Pt];
}

export interface ProjectDoc {
  id: string;
  name: string;
  savedAt: number;
  keystone: KeystoneState;
  layers: Layer[];
  /** Set on the built-in demo project; bumping it refreshes the demo. */
  demoVersion?: number;
}

export function defaultKeystone(): KeystoneState {
  return {
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    persp: 1500,
    offsets: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  };
}

export function newProject(name: string): ProjectDoc {
  return {
    id: crypto.randomUUID(),
    name,
    savedAt: Date.now(),
    keystone: defaultKeystone(),
    layers: [],
  };
}
