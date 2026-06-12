import type { Pt } from './types';

/** Row-major 3x3 matrix: [m00 m01 m02, m10 m11 m12, m20 m21 m22]. */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Adjugate (transpose of cofactors). For a projective transform this serves
 * as the inverse: it differs from the true inverse only by a scalar factor,
 * which cancels in the homogeneous divide of `applyToPoint`.
 */
export function adjugate(m: Mat3): Mat3 {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as Mat3;
}

function mulVec(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Matrix sending the projective basis (1,0,0),(0,1,0),(0,0,1),(1,1,1) to the
 * four given points — the classic building block for a 4-point homography.
 */
function basisToPoints(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Mat3 {
  const m: Mat3 = [p1.x, p2.x, p3.x, p1.y, p2.y, p3.y, 1, 1, 1];
  const v = mulVec(adjugate(m), [p4.x, p4.y, 1]);
  return mulMat(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

/** Projective transform mapping the 4 src points onto the 4 dst points. */
export function homography(src: [Pt, Pt, Pt, Pt], dst: [Pt, Pt, Pt, Pt]): Mat3 {
  const s = basisToPoints(src[0], src[1], src[2], src[3]);
  const d = basisToPoints(dst[0], dst[1], dst[2], dst[3]);
  return mulMat(d, adjugate(s));
}

export function applyToPoint(m: Mat3, p: Pt): Pt {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
}

/** CSS matrix3d() embedding the 2D projective transform (z passes through). */
export function toMatrix3d(m: Mat3): string {
  // Normalize so the homogeneous term is 1; keeps the numbers readable and
  // avoids precision loss from uniformly huge entries.
  const k = Math.abs(m[8]) > 1e-12 ? 1 / m[8] : 1;
  const n = m.map((v) => v * k) as Mat3;
  const e = (v: number) => +v.toFixed(8);
  return `matrix3d(${e(n[0])}, ${e(n[3])}, 0, ${e(n[6])}, ${e(n[1])}, ${e(n[4])}, 0, ${e(n[7])}, 0, 0, 1, 0, ${e(n[2])}, ${e(n[5])}, 0, ${e(n[8])})`;
}
