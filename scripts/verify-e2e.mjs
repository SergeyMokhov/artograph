import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = '/tmp/artograph-verify';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const step = (ok, what, observed) => {
  results.push({ ok, what, observed });
  console.log(`${ok ? 'OK ' : 'FAIL'} | ${what} | ${observed}`);
};

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox',
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

// ---- 1. Picker appears, create a project --------------------------------
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.waitForSelector('#picker');
const pickerShown = await page.$eval('#picker', (el) => getComputedStyle(el).display !== 'none');
await shot('01-picker');
step(pickerShown, 'open app', `picker visible=${pickerShown}`);

// ---- Demo project: exists, Reset instead of Delete, SVG renders, resets ----
const demoName = 'Demo — calibration target';
const demoButtons = await page.$$eval(
  '#project-list li',
  (lis, dn) => {
    const li = lis.find((l) => l.querySelector('.name')?.textContent === dn);
    return li ? [...li.querySelectorAll('button')].map((b) => b.title) : null;
  },
  demoName,
);
step(
  demoButtons !== null && demoButtons.some((t) => t.includes('Reset')) && !demoButtons.includes('Delete'),
  'demo project exists with Reset (no Delete)',
  `demo row buttons: ${demoButtons ? demoButtons.join(' | ') : 'project missing'}`,
);

const clickDemo = () =>
  page.$$eval('#project-list .name', (els, dn) => els.find((e) => e.textContent === dn).click(), demoName);
await clickDemo();
await page.waitForSelector('body.editing');
await page.waitForFunction(() => document.querySelector('.layer img')?.naturalWidth > 0);
const pristineLeft = await page.$eval('.layer', (el) => el.style.left);
await shot('00-demo-calibration');

// Drag the calibration layer away, then Reset from the picker
const dr = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await page.mouse.move(dr.x + dr.width / 2, dr.y + dr.height / 2);
await page.mouse.down();
await page.mouse.move(dr.x + dr.width / 2 + 130, dr.y + dr.height / 2 + 60, { steps: 6 });
await page.mouse.up();
const movedLeft = await page.$eval('.layer', (el) => el.style.left);
await page.click('#btn-projects');
await page.waitForSelector('#project-list .name');
page.once('dialog', (d) => d.accept());
await page.$$eval(
  '#project-list li',
  (lis, dn) => {
    const li = lis.find((l) => l.querySelector('.name')?.textContent === dn);
    [...li.querySelectorAll('button')].find((b) => b.title.includes('Reset')).click();
  },
  demoName,
);
await sleep(500);
await clickDemo();
await page.waitForSelector('body.editing');
await page.waitForFunction(() => document.querySelector('.layer img')?.naturalWidth > 0);
const resetLeft = await page.$eval('.layer', (el) => el.style.left);
step(
  movedLeft !== pristineLeft && resetLeft === pristineLeft,
  'demo reset restores pristine state',
  `pristine=${pristineLeft} moved=${movedLeft} after-reset=${resetLeft}`,
);
await page.click('#btn-projects');
await page.waitForSelector('#project-list .name');

page.once('dialog', (d) => d.accept('Mural test'));
await page.click('#btn-new');
await page.waitForSelector('body.editing');
const projName = await page.$eval('#project-name', (el) => el.textContent);
step(projName === 'Mural test', 'create project via prompt', `toolbar shows "${projName}"`);

// ---- 2. Add an image, drag it, wheel-scale it ----------------------------
const dataURL = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(200, 150, 100, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(180, 40, 40, 220);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('REF', 20, 50);
  return c.toDataURL('image/png');
});
fs.writeFileSync(`${OUT}/test-image.png`, Buffer.from(dataURL.split(',')[1], 'base64'));

let uploadedVia = 'uploadFile';
try {
  const input = await page.$('#file-input');
  await input.uploadFile(`${OUT}/test-image.png`);
} catch (e) {
  uploadedVia = `in-page DataTransfer (uploadFile failed: ${e.message})`;
  await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, dataURL);
}
await page.waitForFunction(() => {
  const img = document.querySelector('.layer img');
  return img && img.naturalWidth > 0;
});
await sleep(200);
const rect0 = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await shot('02-image-added');
step(rect0.width > 50, `add image (${uploadedVia})`, `layer on stage at (${rect0.x | 0},${rect0.y | 0}) ${rect0.width | 0}x${rect0.height | 0}`);

// Drag the layer by (+200, +120)
const c0 = { x: rect0.x + rect0.width / 2, y: rect0.y + rect0.height / 2 };
await page.mouse.move(c0.x, c0.y);
await page.mouse.down();
await page.mouse.move(c0.x + 200, c0.y + 120, { steps: 12 });
await page.mouse.up();
const rect1 = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
const dx = rect1.x - rect0.x;
const dy = rect1.y - rect0.y;
step(Math.abs(dx - 200) < 3 && Math.abs(dy - 120) < 3, 'drag layer', `moved by (${dx.toFixed(1)},${dy.toFixed(1)}), expected (200,120)`);

// Wheel-scale around the cursor
const getScale = () =>
  page.$eval('.layer', (el) => parseFloat(/scale\(([\d.]+)\)/.exec(el.style.transform)[1]));
const s0 = await getScale();
await page.mouse.move(rect1.x + rect1.width / 2, rect1.y + rect1.height / 2);
let wheelVia = 'mouse.wheel';
try {
  await page.mouse.wheel({ deltaY: -400 });
} catch (e) {
  wheelVia = `synthetic WheelEvent (mouse.wheel failed: ${e.message})`;
  await page.evaluate((p) => {
    window.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -400, clientX: p.x, clientY: p.y, cancelable: true }),
    );
  }, { x: rect1.x + rect1.width / 2, y: rect1.y + rect1.height / 2 });
}
await sleep(100);
const s1 = await getScale();
step(s1 > s0, `wheel zoom (${wheelVia})`, `scale ${s0} -> ${s1}`);
await shot('03-dragged-scaled');

// ---- 3. Tilt: sliders and corner drags warp the stage --------------------
await page.click('#btn-tilt');
await page.waitForSelector('#keystone-panel:not([hidden])');
const cornerCount = await page.$$eval('#corners .corner', (els) => els.length);
step(cornerCount === 4, 'open tilt panel', `${cornerCount} corner handles shown`);

const stageTransform = () => page.$eval('#stage', (el) => el.style.transform);
const t0 = await stageTransform();

// All four corner pins must start fully inside the viewport
const vw = 1280;
const vh = 800;
const pinRects = await page.$$eval('#corners .corner', (els) => els.map((el) => el.getBoundingClientRect().toJSON()));
const allVisible = pinRects.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.width <= vw && p.y + p.height <= vh);
step(allVisible, 'corner pins start fully visible', pinRects.map((p) => `(${p.x | 0},${p.y | 0})`).join(' '));

// Corner drag (delta-based): pull the top-left pin inward, layer must follow
const cRect = pinRects[0];
const pin0 = { x: cRect.x + cRect.width / 2, y: cRect.y + cRect.height / 2 };
const layerBefore = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await page.mouse.move(pin0.x, pin0.y);
await page.mouse.down();
await page.mouse.move(pin0.x + 120, pin0.y + 80, { steps: 8 });
await page.mouse.up();
await sleep(100);
const t2 = await stageTransform();
const layerAfter = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
const cornerAfter = await page.$eval('#corners .corner', (el) => el.getBoundingClientRect().toJSON());
// True corner was at (0,0); after a (120,80) pointer delta it sits at (120,80),
// which is inside the clamp margin, so the handle should be centered there.
const cAfter = { x: cornerAfter.x + cornerAfter.width / 2, y: cornerAfter.y + cornerAfter.height / 2 };
const cornerMoved = Math.abs(cAfter.x - 120) < 4 && Math.abs(cAfter.y - 80) < 4;
const layerMoved = layerBefore.x !== layerAfter.x || layerBefore.width !== layerAfter.width;
step(t2 !== t0 && cornerMoved && layerMoved, 'corner-pin drag', `pin center at (${cAfter.x.toFixed(1)},${cAfter.y.toFixed(1)}), expected (120,80); layer rect ${layerBefore.x | 0},${layerBefore.y | 0},${layerBefore.width | 0} -> ${layerAfter.x | 0},${layerAfter.y | 0},${layerAfter.width | 0}`);
await shot('05-corner-pin');

// Slider: focus the Y-tilt range and press arrow keys (native range behavior)
await page.focus('#ks-rotY');
for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowUp');
await sleep(100);
const t1 = await stageTransform();
const rotY = await page.$eval('#ks-rotY', (el) => el.value);
step(t1 !== t2 && t1.startsWith('matrix3d'), 'tilt slider (rotY via arrow keys)', `rotY=${rotY}, stage transform now ${t1.slice(0, 40)}...`);
await shot('04-tilt-slider');

// ---- 4. Freeze + reload restores exact state ------------------------------
const snapshot = () =>
  page.evaluate(() => ({
    stage: document.getElementById('stage').style.transform,
    sliders: ['ks-rotX', 'ks-rotY', 'ks-rotZ', 'ks-persp'].map((id) => document.getElementById(id).value),
    layers: [...document.querySelectorAll('.layer')].map((el) => ({
      left: el.style.left,
      top: el.style.top,
      transform: el.style.transform,
      opacity: el.style.opacity,
      z: el.style.zIndex,
    })),
  }));
// Lock: freeze the layer in place, try to drag it, then unfreeze.
// Click the layer first: focus is still on the tilt slider, and shortcuts
// are (correctly) ignored while an input is focused.
const preLockRect = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await page.mouse.click(preLockRect.x + preLockRect.width / 2, preLockRect.y + preLockRect.height / 2);
await page.keyboard.press('l');
await sleep(100);
const lockedRect = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await page.mouse.move(lockedRect.x + lockedRect.width / 2, lockedRect.y + lockedRect.height / 2);
await page.mouse.down();
await page.mouse.move(lockedRect.x + lockedRect.width / 2 + 150, lockedRect.y + lockedRect.height / 2 + 80, { steps: 8 });
await page.mouse.up();
const afterDragRect = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
const stayedPut = lockedRect.x === afterDragRect.x && lockedRect.y === afterDragRect.y;
const lockIcon = await page.$eval('#btn-lock', (el) => el.textContent);
step(stayedPut && lockIcon === '🔒', 'freeze image in place (L) blocks dragging', `drag attempt moved it ${afterDragRect.x - lockedRect.x},${afterDragRect.y - lockedRect.y}px; lock button shows ${lockIcon}`);
await page.keyboard.press('l'); // unfreeze for the rest of the run
await sleep(100);

const before = await snapshot();

await page.click('#btn-save');
await page.waitForFunction(() => document.getElementById('btn-save').textContent === 'Saved ✓');
step(true, 'save', 'button flashed "Saved ✓"');

await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('#project-list .name');
const listed = await page.$eval('#project-list .name', (el) => el.textContent);
step(listed === 'Mural test', 'reload -> picker lists project', `first entry "${listed}"`);

await page.click('#project-list .name');
await page.waitForSelector('body.editing');
await page.waitForFunction(() => {
  const img = document.querySelector('.layer img');
  return img && img.naturalWidth > 0;
});
await page.click('#btn-tilt'); // reopen panel so slider values are comparable
await sleep(200);
const after = await snapshot();
const same = JSON.stringify(before) === JSON.stringify(after);
step(same, 'reopen restores exact state', same ? 'stage transform, slider values, and all layer styles identical' : `MISMATCH\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`);
await shot('06-restored');

// ---- Canvas aspect: content keeps proportions when pinned to a 3:4 canvas --
await page.click('#ks-reset');
await sleep(100);
await page.evaluate(() => {
  for (const [id, v] of [['ks-canvasW', '3'], ['ks-canvasH', '4']]) {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input'));
  }
});
await sleep(100);
// 3:4 in a 1280x800 viewport -> source frame 600x800 centered: x 340..940
const restPins = await page.$$eval('#corners .corner', (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
const pinsInset = Math.abs(restPins[0].x - 340) < 3 && Math.abs(restPins[1].x - 940) < 3;
step(pinsInset, 'canvas 3:4 insets pins to a portrait frame', restPins.map((p) => `(${p.x | 0},${p.y | 0})`).join(' '));

// Drag all 4 pins onto a 3:4 "canvas" quad (450x600 centered). True corners
// rest at (340,0)(940,0)(940,800)(340,800); drags are delta-based.
const targetTrue = [[415, 100], [865, 100], [865, 700], [415, 700]];
const trueRest = [[340, 0], [940, 0], [940, 800], [340, 800]];
for (let i = 0; i < 4; i++) {
  const pin = await page.$$eval(
    '#corners .corner',
    (els, j) => {
      const r = els[j].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    i,
  );
  await page.mouse.move(pin.x, pin.y);
  await page.mouse.down();
  await page.mouse.move(pin.x + targetTrue[i][0] - trueRest[i][0], pin.y + targetTrue[i][1] - trueRest[i][1], { steps: 5 });
  await page.mouse.up();
  await sleep(50);
}
const aspectRect = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
const ratio = aspectRect.width / aspectRect.height;
step(
  Math.abs(ratio - 4 / 3) < 0.02,
  'content keeps its proportions on a 3:4 canvas',
  `4:3 image renders ${aspectRect.width.toFixed(1)}x${aspectRect.height.toFixed(1)}, ratio ${ratio.toFixed(3)} (expect 1.333; pre-fix would be ~0.62)`,
);
await shot('06b-aspect-canvas');

// ---- "From pins": infer the canvas ratio from the pinned quad --------------
await page.click('#ks-reset');
await sleep(100);
// With no canvas set, true corners rest at the screen corners. Pin the same
// 3:4 quad (450x600 centered) by delta-dragging each (clamped) pin.
const screenRest = [[0, 0], [1280, 0], [1280, 800], [0, 800]];
for (let i = 0; i < 4; i++) {
  const pin = await page.$$eval(
    '#corners .corner',
    (els, j) => {
      const r = els[j].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    i,
  );
  await page.mouse.move(pin.x, pin.y);
  await page.mouse.down();
  await page.mouse.move(pin.x + targetTrue[i][0] - screenRest[i][0], pin.y + targetTrue[i][1] - screenRest[i][1], { steps: 5 });
  await page.mouse.up();
  await sleep(50);
}
const distortedRatio = await page.$eval('.layer', (el) => {
  const r = el.getBoundingClientRect();
  return r.width / r.height;
});
const pinsBefore = await page.$$eval('#corners .corner', (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
await page.click('#ks-from-pins');
await sleep(150);
const inferred = await page.evaluate(() => [
  document.getElementById('ks-canvasW').value,
  document.getElementById('ks-canvasH').value,
]);
const pinsAfter = await page.$$eval('#corners .corner', (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
const quadHeld = pinsBefore.every((p, i) => Math.abs(p.x - pinsAfter[i].x) < 2 && Math.abs(p.y - pinsAfter[i].y) < 2);
const fixedRatio = await page.$eval('.layer', (el) => {
  const r = el.getBoundingClientRect();
  return r.width / r.height;
});
step(
  inferred[0] === '3' && inferred[1] === '4' && quadHeld && Math.abs(fixedRatio - 4 / 3) < 0.02,
  'From pins infers canvas ratio without moving the quad',
  `inferred ${inferred[0]}x${inferred[1]}; quad held=${quadHeld}; content ratio ${distortedRatio.toFixed(3)} -> ${fixedRatio.toFixed(3)} (expect 1.333)`,
);

// Typing a different ratio with pinned corners must also hold the quad.
// 1:1 source on a 450x600 quad renders the 4:3 image at ratio (4/3)*(600/450*3/4)=1.0
await page.evaluate(() => {
  for (const [id, v] of [['ks-canvasW', '1'], ['ks-canvasH', '1']]) {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input'));
  }
});
await sleep(150);
const pinsTyped = await page.$$eval('#corners .corner', (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
const quadHeldTyped = pinsAfter.every((p, i) => Math.abs(p.x - pinsTyped[i].x) < 2 && Math.abs(p.y - pinsTyped[i].y) < 2);
const typedRatio = await page.$eval('.layer', (el) => {
  const r = el.getBoundingClientRect();
  return r.width / r.height;
});
step(
  quadHeldTyped && Math.abs(typedRatio - 1.0) < 0.02,
  'typing a canvas ratio keeps the pinned quad in place',
  `quad held=${quadHeldTyped}; content ratio ${typedRatio.toFixed(3)} (expect 1.000 for 1:1 source on this quad)`,
);
await page.click('#ks-reset');
await page.click('#btn-tilt');

// ---- Probes ---------------------------------------------------------------
// Probe: Delete with nothing selected, Escape spam — no crash
await page.keyboard.press('Escape');
await page.keyboard.press('Delete');
await page.keyboard.press('Escape');
const alive1 = await page.evaluate(() => document.querySelectorAll('.layer').length);
step(alive1 === 1, 'PROBE delete with nothing selected', `layer count still ${alive1}, no error`);

// Probe: New project with cancelled prompt does nothing
await page.click('#btn-projects');
await page.waitForSelector('#picker');
page.once('dialog', (d) => d.dismiss());
await page.click('#btn-new');
await sleep(300);
const stillPicker = await page.evaluate(() => !document.body.classList.contains('editing'));
step(stillPicker, 'PROBE cancel new-project prompt', `stayed on picker=${stillPicker}`);

// Probe: wheel-zoom clamp — zoom hard in one direction, layer must not invert/vanish
await page.click('#project-list .name');
await page.waitForSelector('body.editing');
await page.waitForFunction(() => document.querySelector('.layer img')?.naturalWidth > 0);
const lr = await page.$eval('.layer', (el) => el.getBoundingClientRect().toJSON());
await page.mouse.move(lr.x + lr.width / 2, lr.y + lr.height / 2);
for (let i = 0; i < 40; i++) {
  try { await page.mouse.wheel({ deltaY: 800 }); } catch { break; }
}
await sleep(100);
const sMin = await getScale();
step(sMin >= 0.02, 'PROBE extreme wheel zoom-out clamps', `scale clamped at ${sMin}`);

// Probe: duplicate then delete project from picker (confirm dialog)
await page.click('#btn-projects');
await page.waitForSelector('#project-list .name');
await page.$$eval('#project-list li button', (btns) => btns.find((b) => b.title === 'Duplicate').click());
await sleep(300);
const namesAfterDup = await page.$$eval('#project-list .name', (els) => els.map((e) => e.textContent));
page.once('dialog', (d) => d.accept());
await page.$$eval('#project-list li button', (btns) => btns.filter((b) => b.title === 'Delete')[0].click());
await sleep(300);
const namesAfterDel = await page.$$eval('#project-list .name', (els) => els.map((e) => e.textContent));
step(
  namesAfterDup.includes('Mural test copy') && namesAfterDel.length === namesAfterDup.length - 1,
  'PROBE duplicate + delete project',
  `after dup: [${namesAfterDup}]; after del: [${namesAfterDel}]`,
);
await shot('07-picker-final');

await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} steps passed`);
process.exit(fails > 0 ? 1 : 0);
