'use strict';

// --- Tab switching ---

function showTab(name) {
  ['config', 'memories', 'monitor'].forEach(t => {
    document.getElementById('tab-' + t + '-content').hidden = (t !== name);
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
  });
  if (name === 'config' && !configLoaded) loadConfig();
}

// --- Config tab ---

let configLoaded = false;

function loadConfig() {
  fetch('/api/config')
    .then(r => r.text())
    .then(text => {
      document.getElementById('config-editor').value = text;
      configLoaded = true;
    })
    .catch(() => setConfigStatus('Failed to load config', true));
}

function setConfigStatus(msg, isError) {
  const el = document.getElementById('config-status');
  el.textContent = msg;
  el.className = isError ? 'status-error' : '';
  if (!isError) setTimeout(() => { el.textContent = ''; }, 3000);
}

// HTMX: intercept the POST body so we send raw textarea text
document.addEventListener('htmx:configRequest', e => {
  if (e.detail.path === '/api/config' && e.detail.verb === 'post') {
    e.detail.parameters = {};
    e.detail.headers['Content-Type'] = 'text/plain';
    e.detail.body = document.getElementById('config-editor').value;
  }
});

function onConfigSave(evt) {
  if (evt.detail.successful) {
    setConfigStatus('Saved.', false);
  } else {
    const msg = evt.detail.xhr ? evt.detail.xhr.responseText : 'Save failed';
    setConfigStatus(msg || 'Save failed', true);
  }
}

// --- Memories tab ---

function loadMemories() {
  const serverID = document.getElementById('mem-server').value.trim();
  const status = document.getElementById('mem-status');
  if (!serverID) {
    status.textContent = 'Server ID is required.';
    status.className = 'status-error';
    return;
  }
  status.textContent = '';
  status.className = '';

  const userID = document.getElementById('mem-user').value.trim();
  const q = document.getElementById('mem-query').value.trim();
  const params = new URLSearchParams({ server_id: serverID, limit: 25, offset: 0 });
  if (userID) params.set('user_id', userID);
  if (q) params.set('q', q);

  fetch('/api/memories?' + params)
    .then(r => r.json())
    .then(data => renderMemories(data, serverID))
    .catch(() => {
      status.textContent = 'Failed to load memories.';
      status.className = 'status-error';
    });
}

function renderMemories(data, serverID) {
  const status = document.getElementById('mem-status');
  const tbody = document.getElementById('mem-body');
  status.textContent = 'Total: ' + (data.total || 0);
  status.className = '';
  tbody.innerHTML = '';

  (data.memories || []).forEach(m => {
    const tr = document.createElement('tr');
    const created = m.CreatedAt ? new Date(m.CreatedAt).toLocaleString() : '';
    tr.innerHTML =
      '<td class="cell-id">' + esc(m.ID.slice(0, 8)) + '</td>' +
      '<td class="cell-content">' + esc(m.Content) + '</td>' +
      '<td class="cell-id">' + esc(m.ServerID) + '</td>' +
      '<td class="cell-id">' + esc(m.UserID || '') + '</td>' +
      '<td>' + esc(created) + '</td>' +
      '<td class="cell-actions">' +
        '<button class="btn-edit" onclick="editMemory(' + JSON.stringify(m.ID) + ',' + JSON.stringify(serverID) + ')">Edit</button>' +
        '<button class="btn-danger" onclick="deleteMemory(' + JSON.stringify(m.ID) + ',' + JSON.stringify(serverID) + ')">Delete</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function deleteMemory(id, serverID) {
  if (!confirm('Delete this memory?')) return;
  fetch('/api/memories/' + encodeURIComponent(id) + '?server_id=' + encodeURIComponent(serverID), { method: 'DELETE' })
    .then(r => { if (r.ok) loadMemories(); else r.text().then(t => alert('Delete failed: ' + t)); })
    .catch(() => alert('Delete failed.'));
}

function editMemory(id, serverID) {
  const mem = document.querySelector('#mem-body tr td.cell-content');
  // find the row for this id
  const rows = document.querySelectorAll('#mem-body tr');
  let current = '';
  rows.forEach(row => {
    if (row.querySelector('.cell-id') && row.querySelector('.cell-id').textContent === id.slice(0, 8)) {
      current = row.querySelectorAll('td')[1].textContent;
    }
  });
  const newContent = prompt('Edit memory content:', current);
  if (newContent === null) return;
  fetch('/api/memories/' + encodeURIComponent(id) + '?server_id=' + encodeURIComponent(serverID), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: newContent }),
  })
    .then(r => { if (r.ok) loadMemories(); else r.text().then(t => alert('Edit failed: ' + t)); })
    .catch(() => alert('Edit failed.'));
}

// --- Monitor tab (SSE) ---

let sseConn = null;

function connectSSE() {
  if (sseConn) sseConn.close();
  sseConn = new EventSource('/api/events');

  sseConn.addEventListener('status', e => {
    try {
      const agents = JSON.parse(e.data);
      renderAgents(agents);
    } catch (_) {}
  });

  sseConn.addEventListener('config_reloaded', () => {
    setConfigStatus('Config reloaded!', false);
    configLoaded = false; // allow re-fetch next time config tab is shown
  });

  sseConn.onerror = () => {
    // browser will auto-retry; update UI briefly
    document.getElementById('monitor-status').textContent = 'Reconnecting...';
    document.getElementById('monitor-status').className = 'status-error';
  };

  sseConn.onopen = () => {
    document.getElementById('monitor-status').textContent = 'Connected.';
    document.getElementById('monitor-status').className = '';
  };
}

function renderAgents(agents) {
  const tbody = document.getElementById('agent-body');
  const status = document.getElementById('monitor-status');
  tbody.innerHTML = '';
  if (!agents || agents.length === 0) {
    status.textContent = 'No active agents.';
    status.className = '';
    return;
  }
  status.textContent = agents.length + ' active agent(s).';
  status.className = '';
  agents.forEach(a => {
    const tr = document.createElement('tr');
    const last = a.last_active ? new Date(a.last_active).toLocaleString() : '';
    tr.innerHTML =
      '<td class="cell-id">' + esc(a.channel_id) + '</td>' +
      '<td class="cell-id">' + esc(a.server_id) + '</td>' +
      '<td>' + esc(last) + '</td>' +
      '<td>' + esc(String(a.queue_depth)) + '</td>';
    tbody.appendChild(tr);
  });
}

// --- Utility ---

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Init ---

showTab('config');
connectSSE();
