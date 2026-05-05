/* ─── STATE ─────────────────────────────────────────────────────────────── */
const state = {
  notes: [],
  currentId: null,
  attachment: null,
  activeTag: null,
  checklist: []   // [{ id, text, done }]
};

const STORAGE_KEY = "archive_notes_v2";
const THEME_KEY   = "archive_theme";
let saveTimer     = null;

/* ─── DOM REFERENCES ─────────────────────────────────────────────────────── */
const views = {
  list:   document.getElementById('viewList'),
  editor: document.getElementById('viewEditor'),
  detail: document.getElementById('viewDetail')
};

/* ─── VIEW SWITCHING ─────────────────────────────────────────────────────── */
function switchView(viewName) {
  Object.keys(views).forEach(v => {
    views[v].style.display = 'none';
    views[v].classList.remove('view--active');
  });
  views[viewName].style.display = 'block';
  setTimeout(() => views[viewName].classList.add('view--active'), 10);
  if (viewName === 'list') renderList();
}

/* ─── ATTACHMENT ─────────────────────────────────────────────────────────── */
document.getElementById('fileInput').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast("File too large (max 5 MB)"); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    state.attachment = { name: file.name, data: ev.target.result, type: file.type };
    document.getElementById('fileStatus').innerHTML =
      `<span class="file-chip">⊙ ${file.name} <button onclick="clearAttachment()">×</button></span>`;
  };
  reader.readAsDataURL(file);
});

function clearAttachment() {
  state.attachment = null;
  document.getElementById('fileStatus').innerHTML = '';
  document.getElementById('fileInput').value = '';
}

/* ─── CHECKLIST ──────────────────────────────────────────────────────────── */
const checklistPanel   = document.getElementById('checklistPanel');
const checklistItems   = document.getElementById('checklistItems');
const checklistInput   = document.getElementById('checklistInput');
const checklistCount   = document.getElementById('checklistCount');
const checklistBar     = document.getElementById('checklistProgressBar');
const checklistClear   = document.getElementById('checklistClearDone');
let checklistVisible   = false;

document.getElementById('checklistToggleBtn').addEventListener('click', () => {
  checklistVisible = !checklistVisible;
  checklistPanel.style.display = checklistVisible ? 'block' : 'none';
  document.getElementById('checklistToggleBtn').classList.toggle('toolbar-btn--active', checklistVisible);
  if (checklistVisible) {
    renderChecklist();
    setTimeout(() => checklistInput.focus(), 80);
  }
});

document.getElementById('checklistAddBtn').addEventListener('click', addChecklistTask);
checklistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addChecklistTask(); }
});

function addChecklistTask() {
  const text = checklistInput.value.trim();
  if (!text) return;
  state.checklist.push({ id: Date.now().toString(), text, done: false });
  checklistInput.value = '';
  renderChecklist();
  checklistInput.focus();
}

function toggleChecklistTask(id) {
  const task = state.checklist.find(t => t.id === id);
  if (task) task.done = !task.done;
  renderChecklist();
}

function deleteChecklistTask(id) {
  state.checklist = state.checklist.filter(t => t.id !== id);
  renderChecklist();
}

document.getElementById('checklistClearDone').addEventListener('click', () => {
  state.checklist = state.checklist.filter(t => !t.done);
  renderChecklist();
});

function renderChecklist() {
  const total = state.checklist.length;
  const done  = state.checklist.filter(t => t.done).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  checklistCount.textContent = `${done}/${total}`;
  checklistBar.style.width   = `${pct}%`;
  checklistBar.style.background = pct === 100 && total > 0 ? '#4ade80' : 'var(--accent)';
  checklistClear.style.display = done > 0 ? 'inline-block' : 'none';

  if (!total) {
    checklistItems.innerHTML = `<li class="checklist-empty">No tasks yet — type one above and press Enter</li>`;
    return;
  }

  checklistItems.innerHTML = state.checklist.map((task, i) => `
    <li class="checklist-item ${task.done ? 'checklist-item--done' : ''}" style="animation-delay:${i*0.03}s">
      <button class="cl-check ${task.done ? 'cl-check--done' : ''}" onclick="toggleChecklistTask('${task.id}')">
        ${task.done ? '<span class="cl-tick">✓</span>' : ''}
      </button>
      <span class="cl-text">${escapeHtml(task.text)}</span>
      <button class="cl-del" onclick="deleteChecklistTask('${task.id}')" title="Remove">×</button>
    </li>
  `).join('');
}

/* Convert checklist array → text lines saved inside note content */
function checklistToText(tasks) {
  return tasks.map(t => (t.done ? '[x]' : '[ ]') + ' ' + t.text).join('\n');
}

/* Parse checklist lines out of note content */
function textToChecklist(text) {
  const lines  = (text || '').split('\n');
  const tasks  = [];
  const others = [];
  lines.forEach(line => {
    const u = line.match(/^\[ \]\s+(.*)/);
    const c = line.match(/^\[x\]\s+(.*)/i);
    if (u) tasks.push({ id: Date.now().toString() + Math.random(), text: u[1], done: false });
    else if (c) tasks.push({ id: Date.now().toString() + Math.random(), text: c[1], done: true });
    else others.push(line);
  });
  return { tasks, remaining: others.join('\n').trim() };
}

/* ─── SAVE ───────────────────────────────────────────────────────────────── */
function handleSave() {
  const title   = document.getElementById('noteTitle').value.trim();
  const rawTags = document.getElementById('noteTags').value;
  const tags    = rawTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const prose   = document.getElementById('noteContent').value.trim();

  // Merge checklist tasks into content
  const clText   = state.checklist.length ? checklistToText(state.checklist) : '';
  const content  = [clText, prose].filter(Boolean).join('\n\n');

  const now    = new Date().toISOString();
  const isEdit = !!state.currentId;

  const note = {
    id:         state.currentId || Date.now().toString(),
    title:      title || "Untitled",
    content,
    tags,
    attachment: state.attachment,
    createdAt:  isEdit ? (state.notes.find(n => n.id === state.currentId)?.createdAt || now) : now,
    updatedAt:  now
  };

  if (isEdit) {
    const idx = state.notes.findIndex(n => n.id === state.currentId);
    if (idx !== -1) state.notes[idx] = note;
  } else {
    state.notes.unshift(note);
  }

  persist();
  state.currentId = null;
  state.attachment = null;
  state.checklist = [];
  showToast(isEdit ? "Entry updated" : "Entry saved");
  switchView('list');
}

/* ─── RENDER LIST ────────────────────────────────────────────────────────── */
function getAllTags() {
  const set = new Set();
  state.notes.forEach(n => (n.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}

function renderTagFilters() {
  const tags = getAllTags();
  const container = document.getElementById('tagFilters');
  if (!tags.length) { container.innerHTML = ''; return; }
  container.innerHTML = tags.map(t =>
    `<button class="tag-pill ${state.activeTag === t ? 'tag-pill--active' : ''}" onclick="filterByTag('${t}')">${t}</button>`
  ).join('') + (state.activeTag ? `<button class="tag-pill tag-pill--clear" onclick="filterByTag(null)">× clear</button>` : '');
}

function filterByTag(tag) {
  state.activeTag = tag;
  renderList();
}

function renderList() {
  const container = document.getElementById('notesList');
  const query     = document.getElementById('searchInput').value.toLowerCase().trim();

  document.getElementById('clearSearch').style.display = query ? 'flex' : 'none';

  const filtered = state.notes.filter(n => {
    const matchSearch = !query ||
      n.title.toLowerCase().includes(query) ||
      n.content.toLowerCase().includes(query) ||
      (n.tags || []).some(t => t.includes(query));
    const matchTag = !state.activeTag || (n.tags || []).includes(state.activeTag);
    return matchSearch && matchTag;
  });

  renderTagFilters();

  const meta = document.getElementById('listMeta');
  meta.textContent = `${state.notes.length} ${state.notes.length === 1 ? 'entry' : 'entries'}${query ? ` · ${filtered.length} match` : ''}`;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${state.notes.length === 0 ? '◈' : '⌕'}</div>
        <p>${state.notes.length === 0 ? 'No entries yet.<br>Press <strong>New Entry</strong> to begin.' : 'No results found.'}</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(note => {
    const clLines = (note.content || '').split('\n').filter(l => /^\[[ x]\]/i.test(l));
    const clDone  = clLines.filter(l => /^\[x\]/i.test(l)).length;
    const clTotal = clLines.length;
    const clBadge = clTotal > 0
      ? `<span class="note-cl-badge ${clDone === clTotal ? 'note-cl-badge--done' : ''}">☑ ${clDone}/${clTotal}</span>`
      : '';

    const preview  = (note.content || '').replace(/\[[ x]\]\s*/gi, '').trim().substring(0, 90);
    const date     = formatDate(note.updatedAt);
    const tagsHtml = (note.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');
    const hasAttach = note.attachment ? '<span class="attach-badge">⊙</span>' : '';

    return `
      <div class="note-item" onclick="openDetail('${note.id}')">
        <div class="note-item__top">
          <h3 class="note-item__title">${escapeHtml(note.title)}</h3>
          <div class="note-item__meta">${clBadge}${hasAttach}<span class="note-date">${date}</span></div>
        </div>
        ${preview ? `<p class="note-item__preview">${escapeHtml(preview)}${note.content.length > 90 ? '…' : ''}</p>` : ''}
        ${tagsHtml ? `<div class="note-item__tags">${tagsHtml}</div>` : ''}
      </div>`;
  }).join('');
}

/* ─── DETAIL VIEW ────────────────────────────────────────────────────────── */
function openDetail(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  state.currentId = id;

  const contentHtml = renderContent(note.content);
  const createdStr  = note.createdAt ? `Created ${formatDate(note.createdAt)}` : '';
  const updatedStr  = note.updatedAt && note.updatedAt !== note.createdAt ? ` · Updated ${formatDate(note.updatedAt)}` : '';
  const tagsHtml    = (note.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');

  // Checklist progress for detail header
  const lines   = (note.content || '').split('\n').filter(l => /^\[[ x]\]/i.test(l));
  const clDone  = lines.filter(l => /^\[x\]/i.test(l)).length;
  const clTotal = lines.length;
  const clPct   = clTotal ? Math.round((clDone / clTotal) * 100) : 0;
  const clProgressHtml = clTotal > 0 ? `
    <div class="detail-cl-progress">
      <div class="detail-cl-bar" style="width:${clPct}%;background:${clPct===100?'#4ade80':'var(--accent)'}"></div>
      <span class="detail-cl-label">${clDone}/${clTotal} tasks done</span>
    </div>` : '';

  document.getElementById('detailContent').innerHTML = `
    <h1 class="detail-title">${escapeHtml(note.title)}</h1>
    <div class="detail-meta">
      <span>${createdStr}${updatedStr}</span>
      ${tagsHtml ? `<div class="detail-tags">${tagsHtml}</div>` : ''}
    </div>
    ${clProgressHtml}
    <div class="content-body">${contentHtml}</div>
    ${note.attachment && note.attachment.type && note.attachment.type.startsWith('image/')
      ? `<div class="detail-attachment"><img src="${note.attachment.data}" class="detail-image" alt="${escapeHtml(note.attachment.name)}" /></div>`
      : ''}
    ${note.attachment && note.attachment.type && !note.attachment.type.startsWith('image/')
      ? `<div class="file-link"><span class="attach-icon">⊙</span> ${escapeHtml(note.attachment.name)}</div>`
      : ''}
  `;

  switchView('detail');
}

function renderContent(text) {
  if (!text) return '<p class="empty-content">No content.</p>';
  return text.split('\n').map(line => {
    const u = line.match(/^\[ \]\s+(.*)/);
    const c = line.match(/^\[x\]\s+(.*)/i);
    if (u) return `<div class="checkbox-row"><label><input type="checkbox" onchange="toggleCheck(this)">${escapeHtml(u[1])}</label></div>`;
    if (c) return `<div class="checkbox-row"><label><input type="checkbox" checked onchange="toggleCheck(this)"><span class="checked-text">${escapeHtml(c[1])}</span></label></div>`;
    if (line.trim() === '') return '<div class="line-break"></div>';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

function toggleCheck(el) {
  const note = state.notes.find(n => n.id === state.currentId);
  if (!note) return;
  const rows  = document.querySelectorAll('.checkbox-row input');
  const lines = note.content.split('\n');
  let ci = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\[[ x]\]/i.test(lines[i])) {
      const label = lines[i].replace(/^\[[ x]\]\s*/i, '');
      lines[i] = (rows[ci] && rows[ci].checked ? '[x]' : '[ ]') + ' ' + label;
      ci++;
    }
  }
  note.content   = lines.join('\n');
  note.updatedAt = new Date().toISOString();
  persist();
  // Refresh progress bar in detail view
  openDetail(state.currentId);
}

/* ─── EDITOR ─────────────────────────────────────────────────────────────── */
function openEditor(id = null) {
  // Reset checklist UI
  state.checklist   = [];
  checklistVisible  = false;
  checklistPanel.style.display = 'none';
  document.getElementById('checklistToggleBtn').classList.remove('toolbar-btn--active');
  renderChecklist();

  if (id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;

    // Split checklist tasks from prose
    const { tasks, remaining } = textToChecklist(note.content);
    state.checklist = tasks;
    if (tasks.length) {
      checklistVisible = true;
      checklistPanel.style.display = 'block';
      document.getElementById('checklistToggleBtn').classList.add('toolbar-btn--active');
      renderChecklist();
    }

    document.getElementById('noteTitle').value   = note.title;
    document.getElementById('noteContent').value = remaining;
    document.getElementById('noteTags').value    = (note.tags || []).join(', ');
    state.currentId  = id;
    state.attachment = note.attachment || null;
    document.getElementById('fileStatus').innerHTML = note.attachment
      ? `<span class="file-chip">⊙ ${note.attachment.name} <button onclick="clearAttachment()">×</button></span>` : '';
  } else {
    document.getElementById('noteTitle').value   = '';
    document.getElementById('noteContent').value = '';
    document.getElementById('noteTags').value    = '';
    state.currentId  = null;
    state.attachment = null;
    document.getElementById('fileStatus').innerHTML = '';
  }
  updateCharCount();
  switchView('editor');
  setTimeout(() => document.getElementById('noteTitle').focus(), 150);
}

function updateCharCount() {
  const len = document.getElementById('noteContent').value.length;
  document.getElementById('charCount').textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
}

/* ─── DELETE ─────────────────────────────────────────────────────────────── */
document.getElementById('deleteBtn').addEventListener('click', () => {
  document.getElementById('deleteModal').style.display = 'flex';
});
document.getElementById('cancelDelete').addEventListener('click', () => {
  document.getElementById('deleteModal').style.display = 'none';
});
document.getElementById('confirmDelete').addEventListener('click', () => {
  state.notes = state.notes.filter(n => n.id !== state.currentId);
  persist();
  document.getElementById('deleteModal').style.display = 'none';
  showToast("Entry deleted");
  switchView('list');
});

/* ─── THEME ──────────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.content = theme === 'dark' ? '#0f0f0e' : '#f7f5f0';
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '◐' : '◑';
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

/* ─── UTILS ──────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff/3600)}h ago`;
  if (diff < 86400 * 2) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
}

function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ─── EVENT LISTENERS ────────────────────────────────────────────────────── */
document.getElementById('createNewBtn').addEventListener('click', () => openEditor());
document.getElementById('saveNoteBtn').addEventListener('click', handleSave);
document.getElementById('cancelEditor').addEventListener('click', () => switchView('list'));
document.getElementById('closeDetail').addEventListener('click', () => switchView('list'));
document.getElementById('editBtn').addEventListener('click', () => openEditor(state.currentId));
document.getElementById('navHome').addEventListener('click', () => switchView('list'));
document.getElementById('searchInput').addEventListener('input', renderList);
document.getElementById('clearSearch').addEventListener('click', () => {
  document.getElementById('searchInput').value = '';
  renderList();
});
document.getElementById('noteContent').addEventListener('input', updateCharCount);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && views.editor.style.display !== 'none') {
    e.preventDefault(); handleSave();
  }
  if (e.key === 'Escape' && document.getElementById('deleteModal').style.display !== 'none') {
    document.getElementById('deleteModal').style.display = 'none';
  }
});

/* ─── INIT ───────────────────────────────────────────────────────────────── */
const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
applyTheme(savedTheme);

const raw = localStorage.getItem(STORAGE_KEY);
try { state.notes = raw ? JSON.parse(raw) : []; }
catch { state.notes = []; }

switchView('list');