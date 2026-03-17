/* ─────────────────────────────────────────
   BEANTIME — POUROVER TIMER
   app.js
───────────────────────────────────────── */

'use strict';

/* ─── CONSTANTS ─── */

const STORAGE_KEYS = {
  RECIPES: 'pourover_recipes',
  HISTORY: 'pourover_history',
  BEANS:   'pourover_beans',
};

const DEFAULT_RECIPES = [
  {
    id: 'kasuya-46',
    name: 'Tetsu Kasuya 4:6',
    description: 'The classic 4:6 method — 40% water for flavor, 60% for strength',
    ratio: 15,
    builtin: true,
    steps: [
      { name: 'Bloom',       pct: 0.133, pourSeconds: 15, waitSeconds: 30 },
      { name: 'Second pour', pct: 0.133, pourSeconds: 15, waitSeconds: 30 },
      { name: 'Third pour',  pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Fourth pour', pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Final pour',  pct: 0.2,   pourSeconds: 20, waitSeconds: 40 },
    ],
  },
  {
    id: 'kasuya-sweet',
    name: '4:6 Sweet Profile',
    description: 'Adjusted 4:6 for sweeter extraction — first pour heavier',
    ratio: 15,
    builtin: true,
    steps: [
      { name: 'Bloom',       pct: 0.2,   pourSeconds: 15, waitSeconds: 35 },
      { name: 'Second pour', pct: 0.067, pourSeconds: 15, waitSeconds: 30 },
      { name: 'Third pour',  pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Fourth pour', pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Final pour',  pct: 0.2,   pourSeconds: 20, waitSeconds: 40 },
    ],
  },
  {
    id: '3-pour',
    name: '3-Pour Simple',
    description: 'A simpler approach — bloom, two pours, great for beginners',
    ratio: 15,
    builtin: true,
    steps: [
      { name: 'Bloom',      pct: 0.133, pourSeconds: 15, waitSeconds: 40 },
      { name: 'Main pour',  pct: 0.4,   pourSeconds: 30, waitSeconds: 45 },
      { name: 'Final pour', pct: 0.4,   pourSeconds: 30, waitSeconds: 60 },
    ],
  },
];

const VIEWS = ['brew', 'recipes', 'history'];

/* ─── STATE ─── */

const state = {
  recipes: [],
  currentRecipe: null,
  coffeeGrams: 20,
  waterGrams: 300,
  computedSteps: [],
  currentStep: 0,
  phase: 'idle',        // 'idle' | 'pour' | 'wait'
  timerInterval: null,
  phaseElapsed: 0,
  paused: false,
  sessionTags: [],
  editingRecipeId: null,
};

/* ─── STORAGE HELPERS ─── */

function loadRecipes() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECIPES) || '[]');
  return [...DEFAULT_RECIPES, ...saved];
}

function saveCustomRecipes(recipes) {
  const custom = recipes.filter((r) => !r.builtin);
  localStorage.setItem(STORAGE_KEYS.RECIPES, JSON.stringify(custom));
}

function loadHistory() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
}

function loadBeans() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.BEANS) || '[]');
}

function saveBeans(beans) {
  localStorage.setItem(STORAGE_KEYS.BEANS, JSON.stringify(beans));
}

function saveNewBean(name) {
  if (!name) return;
  const beans = loadBeans();
  if (!beans.includes(name)) {
    beans.push(name);
    saveBeans(beans);
  }
}

function renderBeansList() {
  const beans = loadBeans();
  el('beans-datalist').innerHTML = beans
    .map((b) => `<option value="${b}">`)
    .join('');
}

/* ─── DOM HELPERS ─── */

function el(id) {
  return document.getElementById(id);
}

function showToast(msg) {
  const toast = el('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ─── NAVIGATION ─── */

function switchView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  el('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-btn')[VIEWS.indexOf(view)].classList.add('active');

  if (view === 'recipes') renderRecipesView();
  if (view === 'history') renderHistory();
}

/* ─── RECIPE SELECT ─── */

function renderRecipeSelect() {
  const select = el('recipe-select');
  select.innerHTML = state.recipes
    .map((r) => `<option value="${r.id}">${r.name}</option>`)
    .join('');

  if (state.currentRecipe) {
    select.value = state.currentRecipe.id;
  }
}

function onRecipeChange() {
  const id = el('recipe-select').value;
  state.currentRecipe = state.recipes.find((r) => r.id === id) || state.recipes[0];

  state.coffeeGrams = parseFloat(el('coffee-grams').value) || 20;
  state.waterGrams = Math.round(state.coffeeGrams * state.currentRecipe.ratio);

  el('water-grams').value = state.waterGrams;
  computeSteps();
}

function updateWater() {
  state.coffeeGrams = parseFloat(el('coffee-grams').value) || 20;
  state.waterGrams = Math.round(state.coffeeGrams * state.currentRecipe.ratio);
  el('water-grams').value = state.waterGrams;
  computeSteps();
}

function onWaterChange() {
  state.waterGrams = parseInt(el('water-grams').value) || 300;
  computeSteps();
}

/* ─── STEP COMPUTATION ─── */

function computeSteps() {
  const total = state.waterGrams;
  const { steps } = state.currentRecipe;

  let computed = steps.map((s, i) => ({
    name: s.name,
    grams: Math.round(total * s.pct),
    pourSeconds: s.pourSeconds,
    waitSeconds: s.waitSeconds,
    idx: i,
  }));

  // Absorb any rounding difference into the last step
  const sum = computed.reduce((acc, s) => acc + s.grams, 0);
  const diff = total - sum;
  if (diff !== 0) computed[computed.length - 1].grams += diff;

  // Add cumulative (scale) target to each step
  let running = 0;
  computed = computed.map((s) => {
    running += s.grams;
    return { ...s, cumulativeGrams: running };
  });

  state.computedSteps = computed;
  renderRatioInfo();
  renderPreviewSteps();
}

/* ─── BREW SETUP RENDERING ─── */

function renderRatioInfo() {
  const ratio = (state.waterGrams / state.coffeeGrams).toFixed(1);
  const n = state.computedSteps.length;
  el('ratio-display').textContent =
    `Ratio 1:${ratio} — ${n} pour${n !== 1 ? 's' : ''} — ${state.waterGrams}g total`;
}

function renderPreviewSteps() {
  el('preview-steps').innerHTML = state.computedSteps
    .map(
      (s, i) => `
      <div class="step-row">
        <div class="step-row-num">${i + 1}</div>
        <div class="step-row-name">${s.name}</div>
        <div class="step-row-grams">+${s.grams}g → <strong>${s.cumulativeGrams}g</strong></div>
        <div class="step-row-time">${s.pourSeconds}s pour / ${s.waitSeconds}s wait</div>
      </div>`
    )
    .join('');
}

/* ─── BREW SESSION ─── */

function startBrew() {
  if (!state.computedSteps.length) return;

  state.currentStep = 0;
  state.phase = 'pour';
  state.phaseElapsed = 0;
  state.paused = false;

  // Clear previous session notes
  el('session-notes').value = '';

  el('setup-panel').style.display = 'none';
  el('active-timer').style.display = 'block';
  el('timer-done').style.display = 'none';

  buildStepsTrack();
  renderActiveStepsList();
  updateTimerDisplay();
  startPhaseTimer();
  requestWakeLock();
}

function buildStepsTrack() {
  el('steps-track').innerHTML = state.computedSteps
    .map((_, i) => `<div class="step-pip" id="pip-${i}"></div>`)
    .join('');
}

function updatePips() {
  state.computedSteps.forEach((_, i) => {
    const pip = el('pip-' + i);
    if (!pip) return;
    pip.className =
      'step-pip' +
      (i < state.currentStep ? ' done' : i === state.currentStep ? ' active' : '');
  });
}

function renderActiveStepsList() {
  el('active-steps-list').innerHTML = state.computedSteps
    .map((s, i) => {
      const isDone = i < state.currentStep;
      const isActive = i === state.currentStep;
      const cls = isDone ? 'step-done' : isActive ? 'step-active' : '';
      const icon = isDone
        ? '<div class="checkmark"></div>'
        : `<div class="step-row-num">${i + 1}</div>`;

      return `
        <div class="step-row ${cls}" id="steprow-${i}">
          ${icon}
          <div class="step-row-name">${s.name}</div>
          <div class="step-row-grams">${s.cumulativeGrams}g</div>
          <div class="step-row-time">${s.pourSeconds}s / ${s.waitSeconds}s</div>
        </div>`;
    })
    .join('');
}

function updateTimerDisplay() {
  const step = state.computedSteps[state.currentStep];
  const total = state.computedSteps.length;
  const isPour = state.phase === 'pour';
  const phaseDur = isPour ? step.pourSeconds : step.waitSeconds;
  const remaining = Math.max(0, phaseDur - state.phaseElapsed);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  el('step-label').textContent = `Step ${state.currentStep + 1} of ${total}`;
  el('step-name').textContent = step.name;
  el('pour-amount').innerHTML = `${step.cumulativeGrams} <span>g</span>`;
  el('pour-this-step').textContent = `+${step.grams}g this pour`;
  el('timer-clock').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  el('timer-status').textContent = isPour ? 'pouring' : 'waiting / draw-down';

  const display = el('timer-display');
  const progress = Math.min(1, state.phaseElapsed / phaseDur);

  if (isPour) {
    display.classList.add('pouring');
    display.style.setProperty('--progress', progress);
  } else {
    display.classList.remove('pouring');
    display.style.setProperty('--progress', 0);
  }

  el('next-btn').textContent =
    state.currentStep === total - 1 && state.phase === 'wait'
      ? 'Finish brew'
      : 'Next step →';
}

/* ─── TIMER LOGIC ─── */

function startPhaseTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.paused) return;

    state.phaseElapsed++;
    updateTimerDisplay();

    const step = state.computedSteps[state.currentStep];
    const phaseDur = state.phase === 'pour' ? step.pourSeconds : step.waitSeconds;

    if (state.phaseElapsed >= phaseDur) {
      autoAdvance();
    }
  }, 1000);
}

function autoAdvance() {
  if (state.phase === 'pour') {
    state.phase = 'wait';
    state.phaseElapsed = 0;
    updateTimerDisplay();
  } else if (state.currentStep < state.computedSteps.length - 1) {
    state.currentStep++;
    state.phase = 'pour';
    state.phaseElapsed = 0;
    renderActiveStepsList();
    updatePips();
    updateTimerDisplay();
  } else {
    finishBrew();
  }
}

function nextStep() {
  const isLastStep = state.currentStep === state.computedSteps.length - 1;

  if (isLastStep && state.phase === 'wait') {
    finishBrew();
    return;
  }

  if (state.phase === 'pour') {
    state.phase = 'wait';
    state.phaseElapsed = 0;
  } else {
    state.currentStep++;
    state.phase = 'pour';
    state.phaseElapsed = 0;
    renderActiveStepsList();
    updatePips();
  }

  updateTimerDisplay();
}

function prevStep() {
  if (state.phase === 'wait') {
    state.phase = 'pour';
    state.phaseElapsed = 0;
  } else if (state.currentStep > 0) {
    state.currentStep--;
    state.phase = 'wait';
    state.phaseElapsed = 0;
    renderActiveStepsList();
    updatePips();
  }
  updateTimerDisplay();
}

function togglePause() {
  state.paused = !state.paused;
  el('pause-btn').textContent = state.paused ? 'Resume' : 'Pause';
}

function stopBrew() {
  if (!confirm('Stop brewing and return to setup?')) return;
  resetBrew();
}

function resetBrew() {
  clearInterval(state.timerInterval);
  state.phase = 'idle';
  state.paused = false;

  el('bean-input').value = '';
  el('session-notes').value = '';
  el('setup-panel').style.display = 'block';
  el('active-timer').style.display = 'none';
  el('timer-done').style.display = 'none';
  el('timer-display').classList.remove('pouring');

  releaseWakeLock();
}

function finishBrew() {
  clearInterval(state.timerInterval);
  el('active-timer').style.display = 'none';
  el('timer-done').style.display = 'block';
  el('done-summary').textContent =
    `${state.currentRecipe.name} — ${state.waterGrams}g water, ${state.coffeeGrams}g coffee`;
  releaseWakeLock();
}

function saveSession() {
  const bean = el('bean-input').value.trim();
  const notes = el('session-notes').value.trim();

  // Persist new beans to the saved list for future autocomplete
  saveNewBean(bean);
  renderBeansList();

  const history = loadHistory();
  history.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    recipeName: state.currentRecipe.name,
    recipeId: state.currentRecipe.id,
    coffeeGrams: state.coffeeGrams,
    waterGrams: state.waterGrams,
    bean,
    notes,
  });
  saveHistory(history);
  showToast('Session saved!');
  resetBrew();
}

/* ─── TAG INPUT ─── */

function handleTagInput(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    const val = el('tag-input').value.trim().replace(/,/g, '');
    if (val) addTag(val);
    el('tag-input').value = '';
  } else if (event.key === 'Backspace' && !el('tag-input').value && state.sessionTags.length) {
    removeTag(state.sessionTags.length - 1);
  }
}

function addTag(val) {
  if (state.sessionTags.includes(val)) return;
  state.sessionTags.push(val);

  const tagEl = document.createElement('div');
  tagEl.className = 'tag';
  tagEl.dataset.val = val;
  tagEl.innerHTML = `${val} <span class="tag-remove" data-tag="${val}">×</span>`;

  el('tag-wrap').insertBefore(tagEl, el('tag-input'));
}

function removeTagByVal(val) {
  state.sessionTags = state.sessionTags.filter((t) => t !== val);
  document.querySelector(`.tag[data-val="${val}"]`)?.remove();
}

function removeTag(idx) {
  removeTagByVal(state.sessionTags[idx]);
}

/* ─── RECIPES VIEW ─── */

function renderRecipesView() {
  el('recipes-list').innerHTML = state.recipes
    .map((r) => {
      const stepsHtml = r.steps
        .map((s) => `<div class="step-chip">${Math.round(s.pct * 100)}% · ${s.pourSeconds}s</div>`)
        .join('');
      const badgeCls = r.builtin ? 'badge-builtin' : 'badge-custom';
      const badgeTxt = r.builtin ? 'Built-in' : 'Custom';
      const deleteBtn = r.builtin
        ? ''
        : `<button class="btn btn-danger btn-sm" data-action="delete-recipe" data-id="${r.id}">Delete</button>`;

      return `
        <div class="recipe-card" data-action="use-recipe" data-id="${r.id}">
          <div class="recipe-card-header">
            <div class="recipe-card-name">${r.name}</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="recipe-badge ${badgeCls}">${badgeTxt}</span>
              ${deleteBtn}
            </div>
          </div>
          <div class="recipe-card-meta">${r.description || ''} · 1:${r.ratio} ratio · ${r.steps.length} pours</div>
          <div class="recipe-steps-preview">${stepsHtml}</div>
        </div>`;
    })
    .join('');
}

function useRecipe(id) {
  el('recipe-select').value = id;
  state.currentRecipe = state.recipes.find((r) => r.id === id);
  switchView('brew');
  onRecipeChange();
}

function showRecipeEditor(id) {
  state.editingRecipeId = id || null;
  const editor = el('recipe-editor');
  editor.style.display = 'block';
  editor.scrollIntoView({ behavior: 'smooth' });

  if (id) {
    const r = state.recipes.find((x) => x.id === id);
    el('editor-title').textContent = 'Edit recipe';
    el('r-name').value = r.name;
    el('r-ratio').value = r.ratio;
    el('r-desc').value = r.description || '';
    renderEditorSteps(r.steps);
  } else {
    el('editor-title').textContent = 'New recipe';
    el('r-name').value = '';
    el('r-ratio').value = 15;
    el('r-desc').value = '';
    renderEditorSteps([
      { name: 'Bloom',      pct: 0.133, pourSeconds: 15, waitSeconds: 45 },
      { name: 'Pour 2',     pct: 0.133, pourSeconds: 15, waitSeconds: 35 },
      { name: 'Pour 3',     pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Pour 4',     pct: 0.2,   pourSeconds: 20, waitSeconds: 35 },
      { name: 'Final pour', pct: 0.267, pourSeconds: 20, waitSeconds: 40 },
    ]);
  }
}

function renderEditorSteps(steps) {
  el('pour-steps-editor').innerHTML = steps.map(editorStepRow).join('');
}

function editorStepRow(s, i) {
  return `
    <div class="pour-step-row" id="erow-${i}">
      <div class="col-name form-group" style="margin:0">
        <label>Step name</label>
        <input type="text" value="${s.name}" placeholder="Pour ${i + 1}" data-action="validate-editor">
      </div>
      <div class="form-group" style="margin:0">
        <label>% of water</label>
        <input type="number" value="${Math.round(s.pct * 1000) / 10}" min="1" max="100" step="0.5" data-action="validate-editor">
      </div>
      <div class="form-group" style="margin:0">
        <label>Pour (sec)</label>
        <input type="number" value="${s.pourSeconds}" min="5" max="120" step="1">
      </div>
      <div class="form-group" style="margin:0">
        <label>Wait (sec)</label>
        <input type="number" value="${s.waitSeconds}" min="10" max="120" step="1">
      </div>
      <button class="remove-step" data-action="remove-step" data-idx="${i}" title="Remove step">×</button>
    </div>`;
}

function addEditorStep() {
  const rows = document.querySelectorAll('#pour-steps-editor .pour-step-row');
  const i = rows.length;
  const div = document.createElement('div');
  div.innerHTML = editorStepRow({ name: `Pour ${i + 1}`, pct: 0.1, pourSeconds: 20, waitSeconds: 35 }, i);
  el('pour-steps-editor').appendChild(div.firstElementChild);
  validateEditor();
}

function removeEditorStep(i) {
  el('erow-' + i)?.remove();
  renumberEditorRows();
  validateEditor();
}

function renumberEditorRows() {
  document.querySelectorAll('#pour-steps-editor .pour-step-row').forEach((row, i) => {
    row.id = 'erow-' + i;
    const removeBtn = row.querySelector('[data-action="remove-step"]');
    if (removeBtn) removeBtn.dataset.idx = i;
  });
}

function validateEditor() {
  const rows = document.querySelectorAll('#pour-steps-editor .pour-step-row');
  let total = 0;
  rows.forEach((row) => {
    const inputs = row.querySelectorAll('input');
    total += parseFloat(inputs[1]?.value || 0);
  });

  const warn = el('steps-warning');
  if (Math.abs(total - 100) > 0.5) {
    warn.style.display = 'block';
    warn.textContent = `Pour percentages sum to ${total.toFixed(1)}% — they should total 100%. Difference: ${(total - 100).toFixed(1)}%`;
  } else {
    warn.style.display = 'none';
  }
}

function cancelEditor() {
  el('recipe-editor').style.display = 'none';
  state.editingRecipeId = null;
}

function saveRecipe() {
  const name = el('r-name').value.trim();
  if (!name) { showToast('Please add a recipe name'); return; }

  const ratio = parseFloat(el('r-ratio').value) || 15;
  const desc = el('r-desc').value.trim();
  const rows = document.querySelectorAll('#pour-steps-editor .pour-step-row');
  const steps = [];

  rows.forEach((row) => {
    const inputs = row.querySelectorAll('input');
    steps.push({
      name: inputs[0].value || 'Pour',
      pct: parseFloat(inputs[1].value) / 100,
      pourSeconds: parseInt(inputs[2].value) || 20,
      waitSeconds: parseInt(inputs[3].value) || 35,
    });
  });

  if (!steps.length) { showToast('Add at least one step'); return; }

  const id = state.editingRecipeId || ('custom-' + Date.now());
  const recipe = { id, name, description: desc, ratio, builtin: false, steps };

  state.recipes = state.recipes.filter((r) => r.id !== id);
  state.recipes.push(recipe);
  saveCustomRecipes(state.recipes);

  renderRecipeSelect();
  renderRecipesView();
  cancelEditor();
  showToast('Recipe saved!');
}

function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  state.recipes = state.recipes.filter((r) => r.id !== id);
  saveCustomRecipes(state.recipes);
  renderRecipeSelect();
  renderRecipesView();
  showToast('Recipe deleted');
}

/* ─── HISTORY VIEW ─── */

function renderHistory() {
  const history = loadHistory();
  const clearBtn = el('clear-history-btn');

  if (!history.length) {
    el('history-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">☕</div>
        <p>No brews logged yet.<br>Save a session after brewing to see it here.</p>
      </div>`;
    clearBtn.style.display = 'none';
    return;
  }

  clearBtn.style.display = '';
  el('history-list').innerHTML = history
    .map((h) => {
      const date = new Date(h.date);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const beanHtml = h.bean ? `<div class="history-bean">🫘 ${h.bean}</div>` : '';
      const notesHtml = h.notes ? `<div class="history-notes">${h.notes}</div>` : '';

      return `
        <div class="history-item">
          <div class="history-header">
            <div class="history-recipe-name">${h.recipeName}</div>
            <div class="history-date">${dateStr} · ${timeStr}</div>
          </div>
          <div class="history-meta">${h.coffeeGrams}g coffee · ${h.waterGrams}g water</div>
          ${beanHtml}
          ${notesHtml}
        </div>`;
    })
    .join('');
}

function deleteHistoryEntry(id) {
  const numericId = parseInt(id);
  const wrap = el('hsw-' + numericId);
  if (wrap) {
    wrap.style.transition = 'opacity 0.2s, max-height 0.3s 0.15s';
    wrap.style.opacity = '0';
    wrap.style.maxHeight = '0';
    wrap.style.overflow = 'hidden';
    setTimeout(() => {
      const history = loadHistory().filter((h) => h.id !== numericId);
      saveHistory(history);
      renderHistory();
      showToast('Entry deleted');
    }, 350);
  }
}

function attachSwipeListeners() {
  const SWIPE_THRESHOLD = 60;
  const REVEAL_WIDTH = 80;

  document.querySelectorAll('.history-swipe-wrap').forEach((wrap) => {
    const card = wrap.querySelector('.history-item');
    let startX = 0;
    let currentX = 0;
    let revealed = false;

    function snapTo(x, animate = true) {
      card.style.transition = animate ? 'transform 0.2s ease' : 'none';
      card.style.transform = `translateX(${x}px)`;
      revealed = x < 0;
    }

    card.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentX = revealed ? -REVEAL_WIDTH : 0;
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX + currentX;
      const clamped = Math.min(0, Math.max(-REVEAL_WIDTH, dx));
      card.style.transform = `translateX(${clamped}px)`;
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX + currentX;
      if (dx < -SWIPE_THRESHOLD) {
        snapTo(-REVEAL_WIDTH);
      } else {
        snapTo(0);
      }
    });
  });

  document.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.history-swipe-wrap')) {
      document.querySelectorAll('.history-item').forEach((card) => {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform = 'translateX(0)';
      });
    }
  }, { passive: true });
}

function clearHistory() {
  if (!confirm('Clear all brew history?')) return;
  saveHistory([]);
  renderHistory();
  showToast('History cleared');
}

/* ─── WAKE LOCK ─── */

let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    // Wake Lock not supported or permission denied — fail silently
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

/* ─── PWA MANIFEST ─── */

function injectManifest() {
  const manifest = {
    name: 'Beantime — Pourover Timer',
    short_name: 'Beantime',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F0E8',
    theme_color: '#A0522D',
    icons: [
      {
        src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">☕</text></svg>',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
    ],
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
}

/* ─── EVENT DELEGATION ─── */
// Instead of inline onclick handlers on every element, we attach a single
// listener to the document and route clicks by data-action attributes.

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  const target = e.target.closest('[data-action]');
  const id = target.dataset.id;

  switch (action) {
    case 'switch-view':   switchView(target.dataset.view); break;
    case 'use-recipe':    useRecipe(id); break;
    case 'delete-recipe': e.stopPropagation(); deleteRecipe(id); break;
    case 'remove-step':   removeEditorStep(parseInt(target.dataset.idx)); break;
    case 'validate-editor': validateEditor(); break;
    case 'start-brew':    startBrew(); break;
    case 'next-step':     nextStep(); break;
    case 'prev-step':     prevStep(); break;
    case 'toggle-pause':  togglePause(); break;
    case 'reset-brew':    resetBrew(); break;
    case 'stop-brew':     stopBrew(); break;
    case 'save-session':  saveSession(); break;
    case 'show-editor':   showRecipeEditor(); break;
    case 'cancel-editor': cancelEditor(); break;
    case 'save-recipe':   saveRecipe(); break;
    case 'add-step':      addEditorStep(); break;
    case 'delete-history': e.stopPropagation(); deleteHistoryEntry(id); break;
    case 'clear-history': clearHistory(); break;
    case 'focus-tags':    el('tag-input').focus(); break;
    case 'brew-again':    resetBrew(); break;
  }
});

document.addEventListener('input', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'validate-editor') validateEditor();
  if (action === 'update-water') updateWater();
  if (action === 'water-change') onWaterChange();
  if (action === 'recipe-change') onRecipeChange();
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'tag-input') handleTagInput(e);
});

/* ─── INIT ─── */

function init() {
  state.recipes = loadRecipes();
  renderRecipeSelect();
  onRecipeChange();
  renderRecipesView();
  renderHistory();
  renderBeansList();
  injectManifest();
}

init();
