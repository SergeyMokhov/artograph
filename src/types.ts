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
}

export interface KeystoneState {
  /** Tilt angles in degrees, applied about the stage center. */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** Perspective (camera) distance in px. */
  persp: number;
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
