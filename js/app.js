import {
  db, collection, doc, getDoc, getDocs, setDoc, serverTimestamp, Timestamp, query, orderBy
} from './firebase-init.js';

const el = (id) => document.getElementById(id);
const screens = ['start', 'quiz', 'done', 'reveal', 'results'];
function showScreen(name) {
  screens.forEach(s => el('screen-' + s).classList.toggle('active', s === name));
  window.scrollTo(0, 0);
}

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- device identity ----------

const DEVICE_KEY = 'lehrerranking_device_id';
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'd-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
const deviceId = getDeviceId();

// ---------- state ----------

let config = { introText: '', publishAt: null };
let teachers = [];
let questions = [];
let answers = {};      // questionId -> teacherId
let existingVote = null;
let currentIndex = 0;
let cachedVotes = null;
let revealTimerSet = false;

// ---------- load data ----------

async function loadAll() {
  // Kerninhalte laden: Einstellungen, Lehrkraefte, Fragen. Diese muessen alle
  // erfolgreich laden, sonst kann das Quiz nicht angezeigt werden.
  const [configSnap, teacherSnap, questionSnap] = await Promise.all([
    getDoc(doc(db, 'config', 'settings')),
    getDocs(query(collection(db, 'teachers'), orderBy('order', 'asc'))),
    getDocs(query(collection(db, 'questions'), orderBy('order', 'asc')))
  ]);

  if (configSnap.exists()) {
    const data = configSnap.data();
    config.introText = data.introText || '';
    config.publishAt = data.publishAt ? data.publishAt.toDate() : null;
    config.title = data.title || 'Lehrerranking';
  }
  teachers = teacherSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  questions = questionSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Die eigene Stimme separat laden: Wenn das aus irgendeinem Grund fehlschlaegt
  // (z. B. Regeln noch nicht wie erwartet), soll das Quiz trotzdem startbar sein.
  try {
    const voteSnap = await getDoc(doc(db, 'votes', deviceId));
    existingVote = voteSnap.exists() ? voteSnap.data() : null;
  } catch (err) {
    console.warn('Eigene Stimme konnte nicht geladen werden:', err);
    existingVote = null;
  }

  if (isPublished()) {
    console.log('[Lehrerranking] Veroeffentlichungszeitpunkt erreicht, zeige Ergebnisse.', config.publishAt);
    try {
      await revealResults();
    } catch (err) {
      console.error('[Lehrerranking] Ergebnisse konnten nicht angezeigt werden:', err);
      renderStart();
      toast('Ergebnisse konnten nicht geladen werden. Siehe Konsole (F12) fuer Details.');
    }
  } else {
    console.log('[Lehrerranking] Noch nicht veroeffentlicht. Termin:', config.publishAt, 'Jetzt:', new Date());
    renderStart();
    scheduleAutoReveal();
  }
}

function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
}

function isPublished() {
  return config.publishAt && new Date() >= config.publishAt;
}

// falls die Seite genau um den Veroeffentlichungszeitpunkt herum geoeffnet ist,
// automatisch zu den Ergebnissen wechseln, ohne dass neu geladen werden muss
function scheduleAutoReveal() {
  if (revealTimerSet || !config.publishAt) return;
  const ms = config.publishAt - new Date();
  if (ms > 0 && ms < 24 * 60 * 60 * 1000) {
    revealTimerSet = true;
    setTimeout(() => {
      if (isPublished() && !el('screen-quiz').classList.contains('active')) {
        revealResults();
      }
    }, ms + 400);
  }
}

// ---------- start screen ----------

function renderStart() {
  el('start-title').textContent = config.title || 'Lehrerranking';
  el('start-text').textContent = config.introText || 'Waehle in jeder Kategorie die Lehrkraft, die am besten passt.';

  const statusLine = el('status-line');
  const parts = [];

  if (config.publishAt) {
    if (isPublished()) {
      parts.push('Die Ergebnisse sind veroeffentlicht.');
    } else {
      parts.push(`Die Ergebnisse werden am <strong>${fmtDate(config.publishAt)}</strong> veroeffentlicht.`);
    }
  }
  if (existingVote) {
    parts.push('Du hast bereits abgestimmt. Du kannst deine Antworten jederzeit aendern.');
  }
  statusLine.innerHTML = parts.join('<br>');

  el('btn-start').textContent = existingVote ? 'Antworten aendern' : 'Quiz starten';

  let resultsBtn = document.getElementById('btn-view-results');
  if (isPublished()) {
    if (!resultsBtn) {
      resultsBtn = document.createElement('button');
      resultsBtn.id = 'btn-view-results';
      resultsBtn.className = 'btn btn-quiet';
      resultsBtn.textContent = 'Ergebnisse ansehen';
      resultsBtn.addEventListener('click', () => revealResults());
      el('btn-start').insertAdjacentElement('afterend', resultsBtn);
    }
  } else if (resultsBtn) {
    resultsBtn.remove();
  }

  showScreen('start');
}

el('btn-start').addEventListener('click', () => {
  if (questions.length === 0) {
    toast('Es sind noch keine Fragen eingerichtet.');
    return;
  }
  if (teachers.length === 0) {
    toast('Es sind noch keine Lehrkraefte eingerichtet.');
    return;
  }
  answers = existingVote ? { ...existingVote.answers } : {};
  currentIndex = 0;
  showScreen('quiz');
  renderQuestion();
});

el('btn-to-start').addEventListener('click', () => renderStart());
el('btn-results-back').addEventListener('click', () => renderStart());
el('btn-edit-from-results').addEventListener('click', () => renderStart());
el('btn-edit-again').addEventListener('click', () => {
  currentIndex = 0;
  showScreen('quiz');
  renderQuestion();
});

// ---------- quiz ----------

function renderQuestion() {
  const q = questions[currentIndex];
  el('progress-label').textContent = `Frage ${currentIndex + 1} von ${questions.length}`;
  const pct = Math.round(((currentIndex) / questions.length) * 100);
  el('progress-percent').textContent = pct + '%';
  el('progress-fill').style.width = pct + '%';
  el('question-text').textContent = q.text;

  const grid = el('teacher-grid');
  grid.innerHTML = '';
  teachers.forEach(t => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'teacher-tile' + (answers[q.id] === t.id ? ' selected' : '');
    tile.innerHTML = `<span class="name">${escapeHtml(t.name)}</span>` +
      (t.subject ? `<span class="subject">${escapeHtml(t.subject)}</span>` : '');
    tile.addEventListener('click', () => {
      answers[q.id] = t.id;
      renderQuestion();
    });
    grid.appendChild(tile);
  });

  el('btn-back').style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
  el('btn-next').disabled = !answers[q.id];
  el('btn-next').textContent = currentIndex === questions.length - 1 ? 'Abschliessen' : 'Weiter';
}

el('btn-back').addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
});

el('btn-next').addEventListener('click', async () => {
  if (currentIndex < questions.length - 1) {
    currentIndex++;
    renderQuestion();
  } else {
    await submitVote();
  }
});

async function submitVote() {
  el('btn-next').disabled = true;
  el('btn-next').textContent = 'Speichern ...';
  try {
    await setDoc(doc(db, 'votes', deviceId), {
      answers,
      updatedAt: serverTimestamp()
    });
    existingVote = { answers };
    el('done-text').textContent = config.publishAt
      ? `Deine Antworten wurden gespeichert. Die Ergebnisse werden am ${fmtDate(config.publishAt)} veroeffentlicht.`
      : 'Deine Antworten wurden gespeichert.';
    showScreen('done');
  } catch (err) {
    console.error(err);
    toast('Speichern fehlgeschlagen. Bitte versuche es erneut.');
    el('btn-next').disabled = false;
    el('btn-next').textContent = 'Abschliessen';
  }
}

// ---------- reveal animation ----------

async function revealResults() {
  showScreen('reveal');
  el('reveal-num').textContent = '0';

  let votes = cachedVotes;
  if (!votes) {
    try {
      const voteSnap = await getDocs(collection(db, 'votes'));
      votes = voteSnap.docs.map(d => d.data());
      cachedVotes = votes;
    } catch (err) {
      console.error(err);
      votes = [];
    }
  }

  el('reveal-label').textContent = votes.length === 1
    ? 'Person hat abgestimmt'
    : 'Personen haben abgestimmt';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await animateCount(votes.length, reduced ? 150 : 1100);
  await wait(reduced ? 100 : 450);

  renderResults(votes);
  showScreen('results');
}

function animateCount(target, duration) {
  return new Promise(resolve => {
    if (target === 0) { el('reveal-num').textContent = '0'; resolve(); return; }
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el('reveal-num').textContent = Math.round(eased * target).toString();
      if (p < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

// ---------- results ----------

function renderResults(votes) {
  el('results-meta').textContent = `Basierend auf ${votes.length} ${votes.length === 1 ? 'Stimme' : 'Stimmen'}.`;
  el('teacher-search').value = '';
  el('teacher-detail').style.display = 'none';
  el('search-suggestions').style.display = 'none';

  const container = el('results-content');
  container.innerHTML = '';

  questions.forEach((q, qi) => {
    const counts = {};
    teachers.forEach(t => counts[t.id] = 0);
    let total = 0;
    votes.forEach(v => {
      const pick = v.answers && v.answers[q.id];
      if (pick !== undefined && counts.hasOwnProperty(pick)) {
        counts[pick]++;
        total++;
      }
    });
    const ranked = teachers
      .map(t => ({ t, n: counts[t.id] }))
      .filter(r => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);

    const details = document.createElement('details');
    details.className = 'q-accordion';
    if (qi === 0) details.open = true;

    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${escapeHtml(q.text)}</span><span class="q-count">${total} ${total === 1 ? 'Stimme' : 'Stimmen'}</span>`;
    details.appendChild(summary);

    if (ranked.length === 0) {
      const p = document.createElement('p');
      p.className = 'loading-note';
      p.style.padding = '0 1.1em 1.1em';
      p.textContent = 'Noch keine Stimmen zu dieser Frage.';
      details.appendChild(p);
    } else {
      const max = ranked[0].n;
      const chart = document.createElement('div');
      chart.className = 'chart-col';
      ranked.forEach((r, i) => {
        const bar = document.createElement('div');
        bar.className = 'col-bar' + (i === 0 ? ' winner' : '');
        const heightPct = max ? Math.max(6, (r.n / max) * 100) : 6;
        bar.innerHTML = `
          <span class="col-count">${r.n}</span>
          <span class="col-fill" style="height:${heightPct}%"></span>
          <span class="col-name">${escapeHtml(r.t.name)}</span>`;
        chart.appendChild(bar);
      });
      details.appendChild(chart);
    }
    container.appendChild(details);
  });
}

// ---------- teacher search ----------

el('teacher-search').addEventListener('input', () => {
  const val = el('teacher-search').value.trim().toLowerCase();
  const box = el('search-suggestions');
  box.innerHTML = '';
  if (!val) { box.style.display = 'none'; return; }
  const matches = teachers.filter(t => t.name.toLowerCase().includes(val)).slice(0, 6);
  if (matches.length === 0) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  matches.forEach(t => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'suggestion-item';
    item.textContent = t.name;
    item.addEventListener('click', () => selectTeacher(t));
    box.appendChild(item);
  });
});

function selectTeacher(t) {
  el('teacher-search').value = t.name;
  el('search-suggestions').style.display = 'none';

  const votes = cachedVotes || [];
  const rows = questions.map(q => {
    let n = 0;
    votes.forEach(v => {
      if (v.answers && v.answers[q.id] === t.id) n++;
    });
    return { text: q.text, n };
  }).sort((a, b) => b.n - a.n);

  const total = rows.reduce((sum, r) => sum + r.n, 0);

  const panel = el('teacher-detail');
  panel.innerHTML = `
    <div class="teacher-detail-head">
      <h3>${escapeHtml(t.name)}</h3>
      <button class="icon-btn" id="close-detail" title="Schliessen">&times;</button>
    </div>
    <div class="teacher-detail-rows">
      ${rows.map(r => `<div class="row"><span class="cat">${escapeHtml(r.text)}</span><span>${r.n}</span></div>`).join('')}
    </div>
    <div class="teacher-detail-total">Insgesamt ${total} ${total === 1 ? 'Stimme' : 'Stimmen'}</div>`;
  panel.style.display = 'block';

  panel.querySelector('#close-detail').addEventListener('click', () => {
    panel.style.display = 'none';
    el('teacher-search').value = '';
  });
}

document.addEventListener('click', (e) => {
  const box = el('search-suggestions');
  if (!box.contains(e.target) && e.target !== el('teacher-search')) {
    box.style.display = 'none';
  }
});

loadAll().catch(err => {
  console.error(err);
  el('start-text').textContent = 'Die Daten konnten nicht geladen werden. Bitte lade die Seite neu.';
});
