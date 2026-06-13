import './style.css';
import { DEMO_ID, createDemoProject, ensureDemoProject } from './demo';
import { exportProject, importProject } from './export';
import { initInteractions } from './interactions';
import { applyKeystone, initKeystone, toggleCalibrate } from './keystone';
import { addImageFiles, deleteSelected, releaseImageURLs, renderStage, reorderSelected, selectedLayer, toggleLockSelected } from './stage';
import { app, mutate, subscribe } from './state';
import { deleteProject, listProjects, saveProject } from './store';
import { errMsg, toast } from './toast';
import { newProject, type ProjectDoc } from './types';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

// ---------------------------------------------------------------------------
// Autosave: debounced on every mutation, flushed when the tab goes hidden.

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSave(): void {
  if (!app.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushSave().catch((err: unknown) => toast(`Autosave failed: ${errMsg(err)}`, true));
  }, 800);
}

async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (app.project) await saveProject(app.project);
}

// ---------------------------------------------------------------------------
// Project picker

const pickerList = $('#project-list');

async function showPicker(): Promise<void> {
  await flushSave();
  releaseImageURLs();
  app.project = null;
  app.selectedId = null;
  document.body.classList.remove('editing', 'idle');
  toggleCalibrate(false);
  renderStage();

  await ensureDemoProject();
  const docs = await listProjects();
  pickerList.replaceChildren(
    ...docs.map((doc) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = doc.name;
      name.title = 'Open';
      name.addEventListener('click', () => openProject(doc));
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = new Date(doc.savedAt).toLocaleString();
      li.append(name, date, ...pickerActions(doc));
      return li;
    }),
  );
  if (docs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No projects yet — create one below.';
    pickerList.append(li);
  }
}

function doExport(doc: ProjectDoc): Promise<void> {
  return exportProject(doc).then(
    () => toast(`Exported "${doc.name}.artograph" — check your downloads ✓`),
    (err: unknown) => toast(`Export failed: ${errMsg(err)}`, true),
  );
}

function pickerActions(doc: ProjectDoc): HTMLElement[] {
  const make = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  return [
    make('⇩', 'Export as .artograph file', () => void doExport(doc)),
    make('✎', 'Rename', () => {
      const name = prompt('Project name', doc.name)?.trim();
      if (!name) return;
      doc.name = name;
      void saveProject(doc).then(showPicker);
    }),
    make('⧉', 'Duplicate', () => {
      const copy: ProjectDoc = structuredClone(doc);
      copy.id = crypto.randomUUID();
      copy.name = `${doc.name} copy`;
      void saveProject(copy).then(showPicker);
    }),
    doc.id === DEMO_ID
      ? make('↺', 'Reset demo project to its original state', () => {
          if (!confirm(`Reset "${doc.name}" to its original state?`)) return;
          void createDemoProject().then(() => {
            toast('Demo project reset ✓');
            return showPicker();
          });
        })
      : make('🗑', 'Delete', () => {
          if (!confirm(`Delete project "${doc.name}"? This cannot be undone.`)) return;
          void deleteProject(doc.id).then(showPicker);
        }),
  ];
}

function openProject(doc: ProjectDoc): void {
  app.project = doc;
  app.selectedId = null;
  document.body.classList.add('editing');
  mutate();
}

// ---------------------------------------------------------------------------
// Toolbar

function updateToolbar(): void {
  $('#project-name').textContent = app.project?.name ?? '';
  const sel = selectedLayer();
  $('#sel-controls').hidden = !sel;
  if (sel) {
    $<HTMLInputElement>('#sel-opacity').value = String(sel.opacity);
    const lockBtn = $<HTMLButtonElement>('#btn-lock');
    lockBtn.textContent = sel.locked ? '🔒' : '🔓';
    lockBtn.title = sel.locked ? 'Unfreeze image (L)' : 'Freeze image in place (L)';
    lockBtn.classList.toggle('active', sel.locked === true);
  }
}

function initToolbar(): void {
  const fileInput = $<HTMLInputElement>('#file-input');
  $('#btn-add').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files) void addImageFiles(fileInput.files);
    fileInput.value = '';
  });

  const saveBtn = $<HTMLButtonElement>('#btn-save');
  saveBtn.addEventListener('click', () => {
    flushSave().then(
      () => {
        toast(`"${app.project?.name ?? 'Project'}" saved ✓`);
        saveBtn.textContent = 'Saved ✓';
        setTimeout(() => {
          saveBtn.textContent = 'Save';
        }, 1200);
      },
      (err: unknown) => toast(`Save failed: ${errMsg(err)}`, true),
    );
  });

  $('#btn-tilt').addEventListener('click', () => toggleCalibrate());

  const grid = $('#grid');
  $('#btn-grid').addEventListener('click', () => {
    grid.hidden = !grid.hidden;
  });

  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  });

  $('#btn-export').addEventListener('click', () => {
    if (app.project) void doExport(app.project);
  });

  $('#btn-projects').addEventListener('click', () => void showPicker());

  $<HTMLInputElement>('#sel-opacity').addEventListener('input', (e) => {
    const sel = selectedLayer();
    if (!sel) return;
    sel.opacity = parseFloat((e.target as HTMLInputElement).value);
    mutate();
  });
  $('#btn-lock').addEventListener('click', toggleLockSelected);
  $('#btn-del').addEventListener('click', deleteSelected);
  $('#btn-front').addEventListener('click', () => reorderSelected(1));
  $('#btn-back').addEventListener('click', () => reorderSelected(-1));
}

// ---------------------------------------------------------------------------
// Picker buttons

function initPicker(): void {
  $('#btn-new').addEventListener('click', () => {
    const name = prompt('Project name', 'Untitled')?.trim();
    if (!name) return;
    const doc = newProject(name);
    void saveProject(doc).then(() => openProject(doc));
  });

  const importInput = $<HTMLInputElement>('#import-input');
  $('#btn-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    importProject(file).then(openProject, (err: unknown) => {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Projection mode: hide all chrome (and the cursor) after a few idle seconds.

function initIdleHide(): void {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (app.project) {
      idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
    }
  };
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
}

// ---------------------------------------------------------------------------

subscribe(renderStage);
subscribe(applyKeystone);
subscribe(updateToolbar);
subscribe(scheduleSave);

initKeystone();
initInteractions();
initToolbar();
initPicker();
initIdleHide();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushSave();
});

// Surface anything that would otherwise fail silently in the console.
window.addEventListener('unhandledrejection', (e) => {
  toast(`Error: ${errMsg(e.reason)}`, true);
});

void showPicker();
