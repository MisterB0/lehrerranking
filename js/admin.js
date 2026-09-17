import {
  db, auth, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, Timestamp, onSnapshot, query, orderBy,
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from './firebase-init.js';

const el = (id) => document.getElementById(id);

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- auth ----------

el('btn-login').addEventListener('click', doLogin);
el('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  el('login-error').textContent = '';
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  if (!email || !password) {
    el('login-error').textContent = 'Bitte E-Mail und Passwort eingeben.';
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    el('login-error').textContent = 'Anmeldung fehlgeschlagen. Zugangsdaten pruefen.';
  }
}

el('btn-logout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    el('login-shell').style.display = 'none';
    el('admin-shell').style.display = 'block';
    initAdmin();
  } else {
    el('login-shell').style.display = 'block';
    el('admin-shell').style.display = 'none';
  }
});

// ---------- tabs ----------

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    el('panel-' + tab.dataset.panel).classList.add('active');
  });
});

// ---------- init (only once, after login) ----------

let initialized = false;
function initAdmin() {
  if (initialized) return;
  initialized = true;
  loadSettings();
  watchTeachers();
  watchQuestions();
  watchOverview();
}

// ---------- overview / log ----------

function watchOverview() {
  onSnapshot(collection(db, 'votes'), (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    el('ov-total').textContent = docs.length;

    const sorted = docs.slice().sort((a, b) => {
      const at = a.updatedAt ? a.updatedAt.toMillis() : 0;
      const bt = b.updatedAt ? b.updatedAt.toMillis() : 0;
      return bt - at;
    }).slice(0, 50);

    const log = el('ov-log');
    log.innerHTML = '';
    if (sorted.length === 0) {
      log.innerHTML = '<p class="loading-note">Noch keine Stimmen eingegangen.</p>';
      return;
    }
    sorted.forEach(v => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const when = v.updatedAt
        ? v.updatedAt.toDate().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'unbekannt';
      row.innerHTML = `<span>Stimme gespeichert</span><span class="log-time">${when}</span>`;
      log.appendChild(row);
    });
  });
}

// ---------- settings ----------

async function loadSettings() {
  const snap = await getDoc(doc(db, 'config', 'settings'));
  if (snap.exists()) {
    const data = snap.data();
    el('set-title').value = data.title || '';
    el('set-text').value = data.introText || '';
    if (data.publishAt) {
      const d = data.publishAt.toDate();
      el('set-publish').value = toLocalInputValue(d);
    }
  }
}

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

el('btn-save-settings').addEventListener('click', async () => {
  const btn = el('btn-save-settings');
  btn.disabled = true;
  try {
    const payload = {
      title: el('set-title').value.trim(),
      introText: el('set-text').value,
    };
    const publishVal = el('set-publish').value;
    if (publishVal) {
      payload.publishAt = Timestamp.fromDate(new Date(publishVal));
    }
    await setDoc(doc(db, 'config', 'settings'), payload, { merge: true });
    toast('Einstellungen gespeichert.');
  } catch (err) {
    console.error(err);
    toast('Speichern fehlgeschlagen.');
  } finally {
    btn.disabled = false;
  }
});

// ---------- teachers ----------

let teachersCache = [];

function watchTeachers() {
  const q = query(collection(db, 'teachers'), orderBy('order', 'asc'));
  onSnapshot(q, (snap) => {
    teachersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTeacherList();
  });
}

function renderTeacherList() {
  const list = el('teacher-list');
  list.innerHTML = '';
  if (teachersCache.length === 0) {
    list.innerHTML = '<p class="loading-note">Noch keine Lehrkraefte eingetragen.</p>';
    return;
  }
  teachersCache.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="grow">
        <span class="primary" data-role="name">${escapeHtml(t.name)}</span>
        <span class="secondary" data-role="subject">${escapeHtml(t.subject || '')}</span>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="up" title="Nach oben" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="icon-btn" data-action="down" title="Nach unten" ${i === teachersCache.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="icon-btn" data-action="edit" title="Bearbeiten">&#9998;</button>
        <button class="icon-btn" data-action="delete" title="Loeschen">&times;</button>
      </div>`;

    row.querySelector('[data-action="edit"]').addEventListener('click', () => startEditTeacher(row, t));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTeacher(t));
    row.querySelector('[data-action="up"]').addEventListener('click', () => moveItem(teachersCache, i, -1, 'teachers'));
    row.querySelector('[data-action="down"]').addEventListener('click', () => moveItem(teachersCache, i, 1, 'teachers'));

    list.appendChild(row);
  });
}

function startEditTeacher(row, t) {
  const grow = row.querySelector('.grow');
  grow.innerHTML = `
    <input type="text" class="edit-name" value="${escapeHtml(t.name)}" style="width:100%;margin-bottom:6px;padding:0.4em;background:var(--bg-elevated-2);border:1px solid var(--line);border-radius:var(--radius);color:var(--text)">
    <input type="text" class="edit-subject" value="${escapeHtml(t.subject || '')}" placeholder="Fach" style="width:100%;padding:0.4em;background:var(--bg-elevated-2);border:1px solid var(--line);border-radius:var(--radius);color:var(--text)">`;
  const actions = row.querySelector('.actions');
  actions.innerHTML = `<button class="icon-btn" data-action="save">&check;</button><button class="icon-btn" data-action="cancel">&times;</button>`;
  actions.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const name = row.querySelector('.edit-name').value.trim();
    const subject = row.querySelector('.edit-subject').value.trim();
    if (!name) { toast('Name darf nicht leer sein.'); return; }
    await updateDoc(doc(db, 'teachers', t.id), { name, subject });
    toast('Gespeichert.');
  });
  actions.querySelector('[data-action="cancel"]').addEventListener('click', renderTeacherList);
}

async function deleteTeacher(t) {
  if (!confirm(`"${t.name}" wirklich loeschen?`)) return;
  await deleteDoc(doc(db, 'teachers', t.id));
  toast('Lehrkraft geloescht.');
}

el('btn-add-teacher').addEventListener('click', async () => {
  const name = el('new-teacher-name').value.trim();
  const subject = el('new-teacher-subject').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.'); return; }
  const order = teachersCache.length ? Math.max(...teachersCache.map(t => t.order || 0)) + 1 : 0;
  await addDoc(collection(db, 'teachers'), { name, subject, order });
  el('new-teacher-name').value = '';
  el('new-teacher-subject').value = '';
  toast('Lehrkraft hinzugefuegt.');
});

// ---------- questions ----------

let questionsCache = [];

function watchQuestions() {
  const q = query(collection(db, 'questions'), orderBy('order', 'asc'));
  onSnapshot(q, (snap) => {
    questionsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderQuestionList();
  });
}

function renderQuestionList() {
  const list = el('question-list');
  list.innerHTML = '';
  if (questionsCache.length === 0) {
    list.innerHTML = '<p class="loading-note">Noch keine Fragen eingetragen.</p>';
    return;
  }
  questionsCache.forEach((qu, i) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="grow">
        <span class="primary" data-role="text">${escapeHtml(qu.text)}</span>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="up" title="Nach oben" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="icon-btn" data-action="down" title="Nach unten" ${i === questionsCache.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="icon-btn" data-action="edit" title="Bearbeiten">&#9998;</button>
        <button class="icon-btn" data-action="delete" title="Loeschen">&times;</button>
      </div>`;

    row.querySelector('[data-action="edit"]').addEventListener('click', () => startEditQuestion(row, qu));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteQuestion(qu));
    row.querySelector('[data-action="up"]').addEventListener('click', () => moveItem(questionsCache, i, -1, 'questions'));
    row.querySelector('[data-action="down"]').addEventListener('click', () => moveItem(questionsCache, i, 1, 'questions'));

    list.appendChild(row);
  });
}

function startEditQuestion(row, qu) {
  const grow = row.querySelector('.grow');
  grow.innerHTML = `<input type="text" class="edit-text" value="${escapeHtml(qu.text)}" style="width:100%;padding:0.4em;background:var(--bg-elevated-2);border:1px solid var(--line);border-radius:var(--radius);color:var(--text)">`;
  const actions = row.querySelector('.actions');
  actions.innerHTML = `<button class="icon-btn" data-action="save">&check;</button><button class="icon-btn" data-action="cancel">&times;</button>`;
  actions.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const text = row.querySelector('.edit-text').value.trim();
    if (!text) { toast('Frage darf nicht leer sein.'); return; }
    await updateDoc(doc(db, 'questions', qu.id), { text });
    toast('Gespeichert.');
  });
  actions.querySelector('[data-action="cancel"]').addEventListener('click', renderQuestionList);
}

async function deleteQuestion(qu) {
  if (!confirm('Diese Frage wirklich loeschen?')) return;
  await deleteDoc(doc(db, 'questions', qu.id));
  toast('Frage geloescht.');
}

el('btn-add-question').addEventListener('click', async () => {
  const text = el('new-question-text').value.trim();
  if (!text) { toast('Bitte eine Frage eingeben.'); return; }
  const order = questionsCache.length ? Math.max(...questionsCache.map(q => q.order || 0)) + 1 : 0;
  await addDoc(collection(db, 'questions'), { text, order });
  el('new-question-text').value = '';
  toast('Frage hinzugefuegt.');
});

// ---------- shared reorder helper ----------

async function moveItem(list, index, direction, collectionName) {
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= list.length) return;
  const a = list[index];
  const b = list[swapIndex];
  const orderA = a.order || 0;
  const orderB = b.order || 0;
  await Promise.all([
    updateDoc(doc(db, collectionName, a.id), { order: orderB }),
    updateDoc(doc(db, collectionName, b.id), { order: orderA })
  ]);
}
