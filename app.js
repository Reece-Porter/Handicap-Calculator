// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'golfHandicapData';

// Seed course names/towns only - no rating or slope, since those must come
// from the user rather than a guessed or scraped source.
const DEFAULT_COURSES = [
  { id: 'seed-0', name: 'Cochrane Castle', town: 'Johnstone', par: 70, rating: 69.6, slope: 126 },
];

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { manualHandicap: null, rounds: [], courses: DEFAULT_COURSES };
  try {
    const parsed = JSON.parse(raw);
    return {
      manualHandicap: typeof parsed.manualHandicap === 'number' ? parsed.manualHandicap : null,
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
      courses: Array.isArray(parsed.courses) ? parsed.courses : DEFAULT_COURSES,
    };
  } catch {
    return { manualHandicap: null, rounds: [], courses: DEFAULT_COURSES };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let state = loadData();

// ---------------------------------------------------------------------------
// WHS-style handicap math
// ---------------------------------------------------------------------------

// Number of score differentials to use, and adjustment, by how many scores
// are available (World Handicap System table for 3-20 scores).
const HANDICAP_TABLE = [
  { count: 3, use: 1, adj: -2.0 },
  { count: 4, use: 1, adj: -1.0 },
  { count: 5, use: 1, adj: 0.0 },
  { count: 6, use: 2, adj: -1.0 },
  { count: 7, use: 2, adj: -0.5 },
  { count: 8, use: 2, adj: 0.0 },
  { count: 9, use: 3, adj: -0.5 },
  { count: 10, use: 3, adj: 0.0 },
  { count: 11, use: 3, adj: 0.0 },
  { count: 12, use: 4, adj: -0.3 },
  { count: 13, use: 4, adj: -0.2 },
  { count: 14, use: 4, adj: -0.1 },
  { count: 15, use: 5, adj: 0.0 },
  { count: 16, use: 5, adj: 0.0 },
  { count: 17, use: 6, adj: -0.1 },
  { count: 18, use: 6, adj: 0.0 },
  { count: 19, use: 7, adj: 0.0 },
  { count: 20, use: 8, adj: 0.0 },
];

function getTableEntry(n) {
  if (n < 3) return null;
  if (n >= 20) return HANDICAP_TABLE[HANDICAP_TABLE.length - 1];
  return HANDICAP_TABLE.find((e) => e.count === n);
}

function computeDifferential(score, rating, slope) {
  return (113 / slope) * (score - rating);
}

function truncate1(x) {
  // WHS truncates (does not round) to one decimal place.
  return Math.trunc(x * 10) / 10;
}

// rounds: [{date, differential}, ...]. Returns { index, used, total } or null
// if fewer than 3 rounds are available.
function computeHandicapDetails(rounds) {
  const sorted = [...rounds].sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent20 = sorted.slice(0, 20);
  const n = recent20.length;
  const entry = getTableEntry(n);
  if (!entry) return null;

  const withOriginalIndex = recent20.map((r) => r.differential);
  const lowestSorted = [...withOriginalIndex].sort((a, b) => a - b).slice(0, entry.use);
  const avg = lowestSorted.reduce((s, d) => s + d, 0) / lowestSorted.length;
  const index = truncate1(avg * 0.96 + entry.adj);

  return { index, used: entry.use, total: n, adjustment: entry.adj, countedDifferentials: lowestSorted };
}

function currentHandicapIndex() {
  const details = computeHandicapDetails(state.rounds);
  if (details) return { value: details.index, source: 'calculated', details };
  if (state.manualHandicap !== null) return { value: state.manualHandicap, source: 'manual', details: null };
  return { value: null, source: 'none', details: null };
}

// ---------------------------------------------------------------------------
// Predictor
// ---------------------------------------------------------------------------

function indexAfterHypotheticalRound(score, rating, slope) {
  const diff = truncate1(computeDifferential(score, rating, slope));
  const rounds = [...state.rounds, { date: new Date().toISOString(), differential: diff }];
  const details = computeHandicapDetails(rounds);
  return { diff, details };
}

// Finds the highest (worst) integer score that still brings the handicap
// index to at or below targetIndex, given a hypothetical round played on
// rating/slope - i.e. "shoot this score or better". Handicap index only gets
// worse (higher) as score increases, so the set of qualifying scores is a
// contiguous range starting at the lowest possible score; binary search for
// its upper edge.
function findRequiredScore(targetIndex, rating, slope) {
  let lo = Math.max(Math.round(rating - 25), 18);
  let hi = Math.round(rating + 60);

  const detailsAt = (s) => indexAfterHypotheticalRound(s, rating, slope).details;

  const bestPossible = detailsAt(lo);
  if (!bestPossible) return { possible: false, reason: 'not-enough-rounds' };
  if (bestPossible.index > targetIndex) return { possible: false, reason: 'unreachable', bestPossible };

  if (detailsAt(hi).index <= targetIndex) {
    return { possible: true, score: hi, details: detailsAt(hi), alreadyAssured: true };
  }

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const d = detailsAt(mid);
    if (d && d.index <= targetIndex) lo = mid;
    else hi = mid - 1;
  }
  return { possible: true, score: lo, details: detailsAt(lo) };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtIndex(v) {
  if (v === null || v === undefined) return '--';
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function renderHome() {
  const { value, source, details } = currentHandicapIndex();
  document.getElementById('currentHandicapDisplay').textContent = value === null ? '--' : fmtIndex(value);

  const note = document.getElementById('handicapSourceNote');
  if (source === 'calculated') note.textContent = `Based on ${details.total} round${details.total === 1 ? '' : 's'}`;
  else if (source === 'manual') note.textContent = 'Manually set (add rounds to calculate)';
  else note.textContent = 'Add 3+ rounds or set a manual handicap';

  document.getElementById('statRoundsCount').textContent = state.rounds.length;
  document.getElementById('statBestDiff').textContent = state.rounds.length
    ? Math.min(...state.rounds.map((r) => r.differential)).toFixed(1)
    : '--';
  document.getElementById('statUsedCount').textContent = details ? `${details.used} of ${details.total}` : '--';

  const breakdownCard = document.getElementById('calcBreakdownCard');
  if (details) {
    breakdownCard.hidden = false;
    document.getElementById('calcBreakdownText').textContent =
      `Your lowest ${details.used} differential${details.used === 1 ? '' : 's'} out of your ` +
      `${details.total} most recent rounds (${details.countedDifferentials.map((d) => d.toFixed(1)).join(', ')}) ` +
      `were averaged, multiplied by 0.96, and adjusted by ${details.adjustment.toFixed(1)}.`;
  } else {
    breakdownCard.hidden = true;
  }

  renderSparkline();
}

function renderSparkline() {
  const svg = document.getElementById('trendSparkline');
  const hint = document.getElementById('trendHint');
  const sorted = [...state.rounds].sort((a, b) => new Date(a.date) - new Date(b.date));

  const points = [];
  for (let i = 0; i < sorted.length; i++) {
    const upTo = sorted.slice(0, i + 1);
    const details = computeHandicapDetails(upTo);
    if (details) points.push(details.index);
  }

  if (points.length < 2) {
    svg.innerHTML = '';
    hint.hidden = false;
    return;
  }
  hint.hidden = true;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 300, h = 100, pad = 8;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });

  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const lastPoint = coords[coords.length - 1];

  svg.innerHTML = `
    <path d="${path}" fill="none" stroke="#2e8b57" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="3.5" fill="#2e8b57"/>
  `;
}

function renderHistory() {
  const tbody = document.getElementById('historyBody');
  const table = document.getElementById('historyTable');
  const empty = document.getElementById('historyEmpty');

  if (!state.rounds.length) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }
  table.hidden = false;
  empty.hidden = true;

  const details = computeHandicapDetails(state.rounds);
  const countedSet = new Set();
  if (details) {
    // Mark which specific rounds (by id) contributed to the counted differentials.
    const sorted = [...state.rounds].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
    const usedDiffs = [...details.countedDifferentials];
    for (const r of sorted) {
      const idx = usedDiffs.indexOf(r.differential);
      if (idx !== -1) {
        countedSet.add(r.id);
        usedDiffs.splice(idx, 1);
      }
    }
  }

  const sortedForDisplay = [...state.rounds].sort((a, b) => new Date(b.date) - new Date(a.date));

  tbody.innerHTML = sortedForDisplay.map((r) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.course ? escapeHtml(r.course) : '-'}</td>
      <td>${r.score}</td>
      <td>${r.rating.toFixed(1)}</td>
      <td>${r.slope}</td>
      <td>${r.differential.toFixed(1)}</td>
      <td>${countedSet.has(r.id) ? '<span class="used-badge">Used</span>' : ''}</td>
      <td><button class="delete-btn" data-id="${r.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.rounds = state.rounds.filter((r) => r.id !== btn.dataset.id);
      saveData(state);
      renderAll();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderSettings() {
  document.getElementById('manualHandicap').value = state.manualHandicap ?? '';
}

function renderAll() {
  renderHome();
  renderHistory();
  renderSettings();
  renderNearbyCourses();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Add round form
// ---------------------------------------------------------------------------

const addForm = document.getElementById('addRoundForm');
const roundDateInput = document.getElementById('roundDate');
roundDateInput.value = new Date().toISOString().slice(0, 10);

function updateLiveDifferential() {
  const rating = parseFloat(document.getElementById('roundRating').value);
  const slope = parseFloat(document.getElementById('roundSlope').value);
  const score = parseFloat(document.getElementById('roundScore').value);
  const el = document.getElementById('liveDifferential');
  if (isNaN(rating) || isNaN(slope) || isNaN(score) || slope <= 0) {
    el.textContent = '';
    return;
  }
  const diff = computeDifferential(score, rating, slope);
  el.textContent = `Score differential: ${truncate1(diff).toFixed(1)}`;
}

['roundRating', 'roundSlope', 'roundScore'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateLiveDifferential);
});

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const rating = parseFloat(document.getElementById('roundRating').value);
  const slope = parseFloat(document.getElementById('roundSlope').value);
  const score = parseFloat(document.getElementById('roundScore').value);
  const date = roundDateInput.value;
  const course = document.getElementById('roundCourse').value.trim();

  const differential = truncate1(computeDifferential(score, rating, slope));

  state.rounds.push({
    id: crypto.randomUUID(),
    date,
    course,
    rating,
    slope,
    score,
    differential,
  });
  saveData(state);
  addForm.reset();
  roundDateInput.value = new Date().toISOString().slice(0, 10);
  document.getElementById('liveDifferential').textContent = '';
  renderAll();
  document.querySelector('.tab-btn[data-tab="home"]').click();
});

// ---------------------------------------------------------------------------
// Predictor forms
// ---------------------------------------------------------------------------

document.getElementById('simulateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const rating = parseFloat(document.getElementById('simRating').value);
  const slope = parseFloat(document.getElementById('simSlope').value);
  const score = parseFloat(document.getElementById('simScore').value);

  const { diff, details } = indexAfterHypotheticalRound(score, rating, slope);
  const box = document.getElementById('simResult');
  box.hidden = false;

  if (!details) {
    box.innerHTML = `<p>Score differential would be <strong>${diff.toFixed(1)}</strong>, but you need at least 3 rounds logged (including this one) before a handicap index can be calculated.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="result-headline">${fmtIndex(details.index)}</div>
    <p class="hint">New handicap index if you shot ${score} on this course (differential ${diff.toFixed(1)}), based on your ${details.total} most recent rounds.</p>
  `;
});

document.getElementById('targetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const target = parseFloat(document.getElementById('targetHandicap').value);
  const rating = parseFloat(document.getElementById('targetRating').value);
  const slope = parseFloat(document.getElementById('targetSlope').value);

  const result = findRequiredScore(target, rating, slope);
  const box = document.getElementById('targetResult');
  box.hidden = false;

  if (!result.possible && result.reason === 'not-enough-rounds') {
    box.innerHTML = `<p>You need at least 2 rounds already logged so that, with this hypothetical round, a handicap index can be calculated.</p>`;
    return;
  }
  if (!result.possible && result.reason === 'unreachable') {
    box.innerHTML = `<p>Even an excellent score on this course won't reach ${fmtIndex(target)} in a single round — the best achievable index from one more round here is ${fmtIndex(result.bestPossible.index)}. It will take several strong rounds to lower your index that far.</p>`;
    return;
  }
  if (result.alreadyAssured) {
    box.innerHTML = `<p>Your handicap index is already assured to stay at or below ${fmtIndex(target)} after this round, regardless of your score here.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="result-headline">${result.score}</div>
    <p class="hint">Shoot ${result.score} (or better) on this course to bring your handicap index to ${fmtIndex(result.details.index)} or lower.</p>
  `;
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

document.getElementById('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = parseFloat(document.getElementById('manualHandicap').value);
  state.manualHandicap = isNaN(val) ? null : val;
  saveData(state);
  renderAll();
});

document.getElementById('clearManualBtn').addEventListener('click', () => {
  state.manualHandicap = null;
  saveData(state);
  renderAll();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `golf-handicap-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = {
        manualHandicap: typeof parsed.manualHandicap === 'number' ? parsed.manualHandicap : null,
        rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
        courses: Array.isArray(parsed.courses) ? parsed.courses : DEFAULT_COURSES,
      };
      saveData(state);
      renderAll();
      alert('Data imported successfully.');
    } catch {
      alert('Could not read that file. Make sure it is a valid export from this app.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('This will permanently delete all rounds, your manual handicap, and your saved courses from this device. Continue?')) return;
  state = { manualHandicap: null, rounds: [], courses: DEFAULT_COURSES };
  saveData(state);
  renderAll();
});

// ---------------------------------------------------------------------------
// Glossary popups
// ---------------------------------------------------------------------------

const GLOSSARY = {
  courseRating: {
    title: 'Course Rating',
    body: 'The score a scratch golfer (0 handicap) would be expected to shoot on this course, from a given set of tees. Usually a number between about 67 and 77. You’ll find it on the scorecard or the tee marker board.',
  },
  slopeRating: {
    title: 'Slope Rating',
    body: 'A number from 55 to 155 (113 counts as "standard" difficulty) showing how much harder the course plays for a bogey golfer than for a scratch golfer, relative to the Course Rating. The higher the slope, the tougher the course is for higher-handicap players specifically. It’s printed on the scorecard next to the Course Rating.',
  },
  handicapIndex: {
    title: 'Handicap Index',
    body: 'A number representing your demonstrated playing ability, worked out from your best recent score differentials. Lower is better — a 0 handicap is a scratch golfer, and very strong players can even have a negative ("plus") handicap.',
  },
  scoreDifferential: {
    title: 'Score Differential',
    body: 'A single round’s score adjusted for how hard the course was, so rounds on different courses can be compared fairly. Calculated as (113 ÷ Slope Rating) × (Score − Course Rating). Your Handicap Index is the average of your best few differentials.',
  },
  grossScore: {
    title: 'Gross Score',
    body: 'The total number of strokes you took over the round — just your raw scorecard total, with no handicap adjustment applied.',
  },
};

const glossaryModal = document.getElementById('glossaryModal');

function openGlossary(term) {
  const entry = GLOSSARY[term];
  if (!entry) return;
  document.getElementById('modalTitle').textContent = entry.title;
  document.getElementById('modalBody').textContent = entry.body;
  glossaryModal.hidden = false;
}

function closeGlossary() {
  glossaryModal.hidden = true;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.info-btn');
  if (!btn) return;
  e.preventDefault();
  openGlossary(btn.dataset.term);
});

document.getElementById('modalCloseBtn').addEventListener('click', closeGlossary);
glossaryModal.addEventListener('click', (e) => {
  if (e.target === glossaryModal) closeGlossary();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !glossaryModal.hidden) closeGlossary();
});

// ---------------------------------------------------------------------------
// My Courses (user-entered course ratings)
// ---------------------------------------------------------------------------

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function findCourse(id) {
  return state.courses.find((c) => c.id === id);
}

function renderNearbyCourses() {
  const tbody = document.getElementById('nearbyCoursesBody');
  tbody.innerHTML = state.courses.map((c) => `
    <tr data-id="${c.id}">
      <td><input type="text" class="course-cell" data-field="name" value="${escapeAttr(c.name || '')}" placeholder="Course name"></td>
      <td><input type="text" class="course-cell" data-field="town" value="${escapeAttr(c.town || '')}" placeholder="Town"></td>
      <td><input type="number" step="1" class="course-cell course-cell-num" data-field="par" value="${c.par ?? ''}" placeholder="—"></td>
      <td><input type="number" step="0.1" class="course-cell course-cell-num" data-field="rating" value="${c.rating ?? ''}" placeholder="—"></td>
      <td><input type="number" step="1" class="course-cell course-cell-num" data-field="slope" value="${c.slope ?? ''}" placeholder="—"></td>
      <td class="course-actions">
        <button type="button" class="use-course-btn" ${c.rating && c.slope ? '' : 'disabled'}>Use</button>
        <button type="button" class="delete-course-btn" aria-label="Remove course">✕</button>
      </td>
    </tr>
  `).join('');
  populateCourseSelect();
}

const COURSE_SELECT_IDS = ['courseSelect', 'simCourseSelect', 'targetCourseSelect'];

function populateCourseSelect() {
  const usable = state.courses.filter((c) => c.rating && c.slope);
  const optionsHtml = '<option value="">— Select a saved course —</option>' + usable.map((c) => `
    <option value="${escapeAttr(c.id)}">${escapeHtml(c.name || 'Unnamed')}${c.town ? ' – ' + escapeHtml(c.town) : ''}</option>
  `).join('');

  COURSE_SELECT_IDS.forEach((id) => {
    const select = document.getElementById(id);
    const previousValue = select.value;
    select.innerHTML = optionsHtml;
    if (usable.some((c) => c.id === previousValue)) select.value = previousValue;
  });
}

function applyCourseToForm(course) {
  document.getElementById('roundCourse').value = course.name;
  document.getElementById('roundRating').value = course.rating;
  document.getElementById('roundSlope').value = course.slope;
  updateLiveDifferential();
}

document.getElementById('courseSelect').addEventListener('change', (e) => {
  const course = findCourse(e.target.value);
  if (!course) return;
  applyCourseToForm(course);
});

document.getElementById('simCourseSelect').addEventListener('change', (e) => {
  const course = findCourse(e.target.value);
  if (!course) return;
  document.getElementById('simRating').value = course.rating;
  document.getElementById('simSlope').value = course.slope;
});

document.getElementById('targetCourseSelect').addEventListener('change', (e) => {
  const course = findCourse(e.target.value);
  if (!course) return;
  document.getElementById('targetRating').value = course.rating;
  document.getElementById('targetSlope').value = course.slope;
});

document.getElementById('nearbyCoursesBody').addEventListener('input', (e) => {
  const cell = e.target.closest('.course-cell');
  if (!cell) return;
  const row = e.target.closest('tr');
  const course = findCourse(row.dataset.id);
  if (!course) return;
  const field = cell.dataset.field;
  if (field === 'par' || field === 'rating' || field === 'slope') {
    course[field] = cell.value === '' ? null : parseFloat(cell.value);
  } else {
    course[field] = cell.value;
  }
  saveData(state);
  row.querySelector('.use-course-btn').disabled = !(course.rating && course.slope);
  populateCourseSelect();
});

document.getElementById('nearbyCoursesBody').addEventListener('click', (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const course = findCourse(row.dataset.id);
  if (!course) return;

  if (e.target.closest('.use-course-btn')) {
    applyCourseToForm(course);
    document.getElementById('roundScore').focus();
  }

  if (e.target.closest('.delete-course-btn')) {
    state.courses = state.courses.filter((c) => c.id !== course.id);
    saveData(state);
    renderNearbyCourses();
  }
});

document.getElementById('addCourseRowBtn').addEventListener('click', () => {
  const id = `custom-${Date.now()}`;
  state.courses.push({ id, name: '', town: '', par: null, rating: null, slope: null });
  saveData(state);
  renderNearbyCourses();
  document.querySelector(`tr[data-id="${id}"] input[data-field="name"]`).focus();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderAll();
