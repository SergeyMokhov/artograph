import { describe, expect, it } from 'vitest';
import { adjugate, applyToPoint, homography, toMatrix3d } from './homography';
import type { Pt } from './types';

const square: [Pt, Pt, Pt, Pt] = [
  { x: 0, y: 0 },
  { x: 1920, y: 0 },
  { x: 1920, y: 1080 },
  { x: 0, y: 1080 },
];

const quad: [Pt, Pt, Pt, Pt] = [
  { x: 120, y: 80 },
  { x: 1700, y: 30 },
  { x: 1850, y: 1000 },
  { x: 40, y: 900 },
];

const samples: Pt[] = [
  { x: 0, y: 0 },
  { x: 960, y: 540 },
  { x: 1920, y: 1080 },
  { x: 333.5, y: 777.25 },
];

function expectClose(a: Pt, b: Pt) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe('homography', () => {
  it('is the identity when src and dst coincide', () => {
    const h = homography(square, square);
    for (const p of samples) expectClose(applyToPoint(h, p), p);
  });

  it('maps each src corner exactly onto its dst corner', () => {
    const h = homography(square, quad);
    for (let i = 0; i < 4; i++) expectClose(applyToPoint(h, square[i]), quad[i]);
  });

  it('round-trips through the adjugate inverse', () => {
    const h = homography(square, quad);
    const inv = adjugate(h);
    for (const p of samples) expectClose(applyToPoint(inv, applyToPoint(h, p)), p);
  });

  it('preserves straight lines (midpoint of a warped edge lies on the warped segment)', () => {
    const h = homography(square, quad);
    // Points collinear in src stay collinear in dst under a projective map.
    const a = applyToPoint(h, { x: 0, y: 0 });
    const b = applyToPoint(h, { x: 1920, y: 0 });
    const m = applyToPoint(h, { x: 700, y: 0 });
    const cross = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x);
    expect(cross).toBeCloseTo(0, 4);
  });

  it('serializes the identity to an identity matrix3d', () => {
    const h = homography(square, square);
    const nums = toMatrix3d(h)
      .slice('matrix3d('.length, -1)
      .split(',')
      .map(Number);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    nums.forEach((v, i) => expect(v).toBeCloseTo(identity[i], 6));
  });
});
