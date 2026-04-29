// Admin Dashboard Script

const DEFAULT_SERVER_URL = 'https://interactive-monitor-thing.onrender.com';
let serverUrl = getInitialServerUrl();
let rotationInterval = localStorage.getItem('rotationInterval') || 5;
let allPhotos = [];
let selectedPhotos = new Set();
let displayOrder = {}; // Maps photo ID to display order

function normalizeServerUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getInitialServerUrl() {
  return DEFAULT_SERVER_URL;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Enforce a single remote endpoint across app restarts.
  localStorage.setItem('galleryServerUrl', DEFAULT_SERVER_URL);
  localStorage.setItem('serverUrl', DEFAULT_SERVER_URL);
  serverUrl = DEFAULT_SERVER_URL;
  setupNavigation();
  setupUploadArea();
  setupSettings();
  setupCsvTab();
  loadSettingsFromServer();
  pushLocalSettingsToServer();
  pushLocalEstimateOptionsToServer();
  loadEstimateOptionsFromServer();
  setupManageGallery();
  loadPhotos();
  checkServerStatus();
  setupEventListeners();
});

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons and sections
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

      // Add active class to clicked button
      btn.classList.add('active');

      // Show corresponding section
      const sectionId = btn.getAttribute('data-section');
      const section = document.getElementById(sectionId);
      if (section) {
        section.classList.add('active');
      }
    });
  });
}

function setupUploadArea() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
  });

  document.getElementById('upload-btn').addEventListener('click', uploadFiles);
}

function handleFiles(files) {
  const fileInput = document.getElementById('file-input');
  const uploadArea = document.getElementById('upload-area');
  const summaryEl = document.getElementById('selected-files-summary');
  const listEl = document.getElementById('selected-files-list');
  const selectedFiles = Array.from(files || []);

  fileInput.files = files;

  if (selectedFiles.length === 0) {
    uploadArea.classList.remove('has-files');
    summaryEl.textContent = 'No files selected yet.';
    listEl.innerHTML = '';
    return;
  }

  uploadArea.classList.add('has-files');
  summaryEl.textContent = `${selectedFiles.length} file(s) staged and ready to upload.`;
  listEl.innerHTML = selectedFiles.map((file) => `
    <li>
      <span>${file.name}</span>
      <span class="selected-file-size">${formatFileSize(file.size)}</span>
    </li>
  `).join('');

  console.log(`${selectedFiles.length} files selected for upload`);
}

async function uploadFiles() {
  const fileInput = document.getElementById('file-input');
  const files = fileInput.files;
  const uploadArea = document.getElementById('upload-area');
  const summaryEl = document.getElementById('selected-files-summary');
  const listEl = document.getElementById('selected-files-list');

  if (files.length === 0) {
    alert('Please select files to upload');
    return;
  }

  const uploadProgress = document.getElementById('upload-progress');
  uploadProgress.innerHTML = '';

  for (let file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const progressItem = document.createElement('div');
      progressItem.className = 'progress-item';
      progressItem.innerHTML = `
        <span>${file.name}</span>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      `;
      uploadProgress.appendChild(progressItem);

      const response = await fetch(`${serverUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        progressItem.style.opacity = '0.5';
        const { photo } = await response.json();
        await savePhotoToLocalStore(file, photo);
        console.log(`uploaded: ${file.name}`);
      } else {
        progressItem.innerHTML += ' - Error';
      }
    } catch (error) {
      console.error(`Error uploading ${file.name}:`, error);
      progressItem.innerHTML += ' - Error';
    }
  }

  setTimeout(loadPhotos, 1000);

  fileInput.value = '';
  uploadArea.classList.remove('has-files');
  summaryEl.textContent = 'No files selected yet.';
  listEl.innerHTML = '';
}

async function loadPhotos() {
  try {
    const response = await fetch(`${serverUrl}/api/photos`);
    if (response.ok) {
      allPhotos = await response.json();
      localStorage.setItem('cachedPhotos', JSON.stringify(allPhotos));

      // Server is empty but local store has photos — re-upload
      if (allPhotos.length === 0 && window.localStore) {
        const localPhotos = await window.localStore.loadMetadata();
        if (localPhotos.length > 0) {
          console.log(`Server empty, re-uploading ${localPhotos.length} photos from local store...`);
          await syncLocalStoreToServer(localPhotos);
          await loadPhotos(); // reload after re-upload
          return;
        }
      }

      normalizeDisplayOrder(allPhotos);
      displayPhotos(allPhotos);
      document.getElementById('photo-count').textContent = allPhotos.length;
      selectedPhotos.clear();
      document.getElementById('select-all-checkbox').checked = false;
      updateButtonStates();
      return;
    }
  } catch (error) {
    console.error('Error loading photos:', error);
  }

  // Server unreachable — fall back to localStorage cache
  loadCachedPhotosAdmin();
}

async function savePhotoToLocalStore(file, serverPhoto) {
  if (!window.localStore) return;
  try {
    const localId = crypto.randomUUID();
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const localFilename = `${localId}${ext}`;
    const buffer = await file.arrayBuffer();
    await window.localStore.savePhoto(buffer, localFilename, {
      localId,
      localFilename,
      serverId: serverPhoto.id,
      serverFilename: serverPhoto.filename,
      name: serverPhoto.name,
      size: serverPhoto.size,
      uploadedAt: serverPhoto.uploadedAt,
      active: serverPhoto.active,
      order: serverPhoto.order,
    });
  } catch (err) {
    console.error('Failed to save photo to local store:', err);
  }
}

async function syncLocalStoreToServer(localPhotos) {
  if (!window.localStore) return;

  const sorted = [...localPhotos].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const updatedLocals = [];

  for (const local of sorted) {
    try {
      const fileData = await window.localStore.getFileData(local.localFilename);
      if (!fileData) { console.warn(`Local file missing for ${local.name}, skipping`); continue; }

      const blob = new Blob([fileData.buffer]);
      const formData = new FormData();
      formData.append('file', blob, local.name);

      const res = await fetch(`${serverUrl}/api/upload`, { method: 'POST', body: formData });
      if (!res.ok) continue;

      const { photo: serverPhoto } = await res.json();

      // Restore active state if it was false
      if (local.active === false) {
        await fetch(`${serverUrl}/api/photos/${serverPhoto.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        }).catch(() => {});
      }

      updatedLocals.push({ ...local, serverId: serverPhoto.id, serverFilename: serverPhoto.filename });
    } catch (err) {
      console.error(`Failed to re-upload ${local.name}:`, err);
    }
  }

  // Restore order on server
  if (updatedLocals.length > 1) {
    const orderArray = updatedLocals.map(p => p.serverId);
    await fetch(`${serverUrl}/api/photos/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderArray }),
    }).catch(() => {});
  }

  // Update local metadata with new server IDs
  if (updatedLocals.length > 0) {
    await window.localStore.saveMetadata(updatedLocals);
  }

  console.log(`Re-uploaded ${updatedLocals.length} / ${sorted.length} photos`);
}

async function pushLocalSettingsToServer() {
  if (!window.localStore) return;
  try {
    const settings = await window.localStore.loadSettings();
    if (!settings) return;
    await fetch(`${serverUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  } catch {
    // server offline — silently skip, will push next time
  }
}

function loadCachedPhotosAdmin() {
  const raw = localStorage.getItem('cachedPhotos');
  if (!raw) return;
  try {
    allPhotos = JSON.parse(raw);
    console.warn('Server offline — showing cached photo data. Changes cannot be saved until the server is back.');
    normalizeDisplayOrder(allPhotos);
    displayPhotos(allPhotos);
    document.getElementById('photo-count').textContent = `${allPhotos.length} (cached)`;
    selectedPhotos.clear();
    document.getElementById('select-all-checkbox').checked = false;
    updateButtonStates();
  } catch (err) {
    console.error('Error loading cached photos:', err);
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  const kb = bytes / 1024;
  if (kb < 1024) return Math.round(kb) + ' KB';
  return Math.round(kb / 1024) + ' MB';
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString();
}

function normalizeDisplayOrder(photos) {
  const byId = new Map(photos.map(photo => [photo.id, photo]));

  // Remove stale order entries for photos that were deleted.
  Object.keys(displayOrder).forEach((id) => {
    if (!byId.has(id)) {
      delete displayOrder[id];
    }
  });

  // Rebuild to contiguous values (0..n-1), preserving prior sequence when possible.
  const sorted = [...photos].sort((a, b) => {
    const orderA = displayOrder[a.id] ?? a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = displayOrder[b.id] ?? b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach((photo, index) => {
    displayOrder[photo.id] = index;
  });
}

function displayPhotos(photos) {
  const photoList = document.getElementById('photo-list');
  
  if (photos.length === 0) {
    photoList.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No photos available</td></tr>';
    return;
  }

  // Sort by display order
  const sortedPhotos = [...photos].sort((a, b) => {
    const orderA = displayOrder[a.id] ?? 999;
    const orderB = displayOrder[b.id] ?? 999;
    return orderA - orderB;
  });

  photoList.innerHTML = sortedPhotos.map((photo, index) => `
    <tr class="photo-item">
      <td><input type="checkbox" class="photo-checkbox" data-photo-id="${photo.id}"></td>
      <td><img src="${photo.url}" alt="${photo.name}" class="photo-thumbnail"></td>
      <td><span class="photo-item-name">${photo.name}</span></td>
      <td><span class="photo-item-size">${formatFileSize(photo.size)}</span></td>
      <td><span class="photo-item-date">${formatDate(photo.uploadedAt)}</span></td>
      <td><input type="checkbox" class="photo-active-toggle" data-photo-id="${photo.id}" ${photo.active !== false ? 'checked' : ''}></td>
      <td><input type="number" class="order-input" value="${displayOrder[photo.id] ?? index}" data-photo-id="${photo.id}"></td>
      <td>
        <div class="photo-actions">
          <button class="btn-move-up" onclick="movePhotoUp('${photo.id}')">↑</button>
          <button class="btn-move-down" onclick="movePhotoDown('${photo.id}')">↓</button>
          <button class="btn-delete-single" onclick="deletePhotoSingle('${photo.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Setup checkboxes and active toggles
  photos.forEach(photo => {
    setupPhotoCheckbox(photo.id);
    setupActiveToggle(photo.id);
  });
}


async function loadSettingsFromServer() {
  try {
    const response = await fetch(`${serverUrl}/api/settings`);
    if (!response.ok) return;
    const data = await response.json();
    const interval = Number(data.rotationInterval);
    if (Number.isFinite(interval) && interval >= 1) {
      rotationInterval = interval;
      localStorage.setItem('rotationInterval', String(interval));
      document.getElementById('rotation-interval').value = interval;
    }
  } catch {
    console.warn('Server offline — using cached settings.');
  }
}

async function checkServerStatus() {
  try {
    const response = await fetch(`${serverUrl}/api/health`);
    const statusEl = document.getElementById('server-status');
    if (response.ok) {
      statusEl.textContent = 'Online';
      statusEl.className = 'stat-number status-online';
    } else {
      statusEl.textContent = 'Offline';
      statusEl.className = 'stat-number status-offline';
    }
  } catch (error) {
    const statusEl = document.getElementById('server-status');
    statusEl.textContent = 'Offline';
    statusEl.className = 'stat-number status-offline';
  }
}

function setupSettings() {
  const serverUrlInput = document.getElementById('server-url');
  const rotationIntervalInput = document.getElementById('rotation-interval');
  const saveBtn = document.getElementById('save-settings-btn');

  serverUrlInput.value = DEFAULT_SERVER_URL;
  serverUrlInput.readOnly = true;
  rotationIntervalInput.value = rotationInterval;

  saveBtn.addEventListener('click', async () => {
    serverUrl = DEFAULT_SERVER_URL;
    rotationInterval = rotationIntervalInput.value;

    localStorage.setItem('galleryServerUrl', DEFAULT_SERVER_URL);
    localStorage.setItem('serverUrl', DEFAULT_SERVER_URL);
    localStorage.setItem('rotationInterval', rotationInterval);

    if (window.localStore) {
      await window.localStore.saveSettings({ rotationInterval: Number(rotationInterval) }).catch(() => {});
    }

    try {
      await fetch(`${serverUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationInterval: Number(rotationInterval) })
      });
    } catch (error) {
      console.error('Error saving shared settings:', error);
    }

    alert('Settings saved successfully!');
    checkServerStatus();
  });
}

function setupManageGallery() {
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const updateOrderBtn = document.getElementById('update-order-btn');

  selectAllCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.photo-checkbox').forEach(checkbox => {
      checkbox.checked = isChecked;
      if (isChecked) {
        selectedPhotos.add(checkbox.dataset.photoId);
      } else {
        selectedPhotos.delete(checkbox.dataset.photoId);
      }
    });
    updateButtonStates();
  });

  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.photo-checkbox').forEach(checkbox => {
      checkbox.checked = true;
      selectedPhotos.add(checkbox.dataset.photoId);
    });
    selectAllCheckbox.checked = true;
    updateButtonStates();
  });

  deleteSelectedBtn.addEventListener('click', deleteSelectedPhotos);
  updateOrderBtn.addEventListener('click', updatePhotoOrder);
}

function updateButtonStates() {
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const updateOrderBtn = document.getElementById('update-order-btn');
  const hasSelection = selectedPhotos.size > 0;
  
  deleteSelectedBtn.disabled = !hasSelection;
  updateOrderBtn.disabled = !hasSelection;
}

function setupPhotoCheckbox(photoId) {
  const checkbox = document.querySelector(`.photo-checkbox[data-photo-id="${photoId}"]`);
  if (checkbox) {
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedPhotos.add(photoId);
      } else {
        selectedPhotos.delete(photoId);
        document.getElementById('select-all-checkbox').checked = false;
      }
      updateButtonStates();
    });
  }
}

function setupActiveToggle(photoId) {
  const toggle = document.querySelector(`.photo-active-toggle[data-photo-id="${photoId}"]`);
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      const isActive = e.target.checked;
      try {
        const response = await fetch(`${serverUrl}/api/photos/${photoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: isActive })
        });
        if (response.ok) {
          console.log(`Photo ${photoId} active status updated to: ${isActive}`);
          updateLocalStoreMeta(photoId, { active: isActive });
        } else {
          alert('Failed to update photo status');
          e.target.checked = !isActive; // Revert toggle
        }
      } catch (error) {
        console.error('Error updating photo status:', error);
        alert('Error updating photo status');
        e.target.checked = !isActive; // Revert toggle
      }
    });
  }
}

async function deleteSelectedPhotos() {
  if (selectedPhotos.size === 0) return;
  if (!confirm(`Delete ${selectedPhotos.size} photo(s)? This cannot be undone.`)) return;

  for (const photoId of selectedPhotos) {
    try {
      await fetch(`${serverUrl}/api/photos/${photoId}`, { method: 'DELETE' });
      await deleteFromLocalStore(photoId);
    } catch (error) {
      console.error(`Error deleting photo ${photoId}:`, error);
    }
  }

  selectedPhotos.clear();
  loadPhotos();
}

async function deletePhotoSingle(photoId) {
  if (!confirm('Delete this photo?')) return;
  try {
    await fetch(`${serverUrl}/api/photos/${photoId}`, { method: 'DELETE' });
    await deleteFromLocalStore(photoId);
    loadPhotos();
  } catch (error) {
    console.error('Error deleting photo:', error);
  }
}

async function deleteFromLocalStore(serverId) {
  if (!window.localStore) return;
  try {
    const locals = await window.localStore.loadMetadata();
    const match = locals.find(p => p.serverId === serverId);
    if (match) await window.localStore.deletePhoto(match.localId);
  } catch (err) {
    console.error('Failed to delete from local store:', err);
  }
}

function movePhotoUp(photoId) {
  const currentOrder = displayOrder[photoId];
  const photoWithLowerOrder = allPhotos.find(p => displayOrder[p.id] === currentOrder - 1);
  if (photoWithLowerOrder) {
    [displayOrder[photoId], displayOrder[photoWithLowerOrder.id]] = 
    [displayOrder[photoWithLowerOrder.id], displayOrder[photoId]];
    displayPhotos(allPhotos);
  }
}

function movePhotoDown(photoId) {
  const currentOrder = displayOrder[photoId];
  const photoWithHigherOrder = allPhotos.find(p => displayOrder[p.id] === currentOrder + 1);
  if (photoWithHigherOrder) {
    [displayOrder[photoId], displayOrder[photoWithHigherOrder.id]] = 
    [displayOrder[photoWithHigherOrder.id], displayOrder[photoId]];
    displayPhotos(allPhotos);
  }
}

async function updatePhotoOrder() {
  const orderArray = Object.entries(displayOrder)
    .sort(([, a], [, b]) => a - b)
    .map(([id]) => id);

  try {
    await fetch(`${serverUrl}/api/photos/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderArray })
    });
    // Sync new order values to local store
    orderArray.forEach((serverId, index) => updateLocalStoreMeta(serverId, { order: index }));
    alert('Photo order updated!');
    loadPhotos();
  } catch (error) {
    console.error('Error updating photo order:', error);
    alert('Failed to update photo order');
  }
}

async function updateLocalStoreMeta(serverId, changes) {
  if (!window.localStore) return;
  try {
    const locals = await window.localStore.loadMetadata();
    const idx = locals.findIndex(p => p.serverId === serverId);
    if (idx >= 0) {
      locals[idx] = { ...locals[idx], ...changes };
      await window.localStore.saveMetadata(locals);
    }
  } catch (err) {
    console.error('Failed to update local store metadata:', err);
  }
}

function setupEventListeners() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadPhotos();
    checkServerStatus();
  });
}

// ── Estimate Options (CSV tab) ─────────────────────────────────

let estimateOptions = [];

function setupCsvTab() {
  const dropZone = document.getElementById('csv-upload-area');
  const fileInput = document.getElementById('csv-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) parseAndLoadCsv(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) parseAndLoadCsv(fileInput.files[0]);
    fileInput.value = '';
  });

  document.getElementById('add-option-btn').addEventListener('click', () => {
    estimateOptions.push({ label: '', price: 0 });
    renderOptionsTable();
  });

  document.getElementById('save-options-btn').addEventListener('click', saveEstimateOptions);
  document.getElementById('export-csv-btn').addEventListener('click', exportOptionsCsv);
}

function parseCsvLine(line) {
  const lastComma = line.lastIndexOf(',');
  if (lastComma === -1) return null;
  const label = line.slice(0, lastComma).trim().replace(/^"|"$/g, '');
  const priceStr = line.slice(lastComma + 1).replace(/[^0-9.]/g, '');
  const price = parseFloat(priceStr);
  if (!label || isNaN(price)) return null;
  return { label, price };
}

function parseAndLoadCsv(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(parseCsvLine).filter(Boolean);
    if (parsed.length === 0) {
      setOptionsStatus('No valid rows found. Expected format: Service Name, Price');
      return;
    }
    estimateOptions = parsed;
    renderOptionsTable();
    setOptionsStatus(`Imported ${parsed.length} option(s) from CSV.`);
  };
  reader.readAsText(file);
}

function syncOptionsFromInputs() {
  document.querySelectorAll('.opt-label-input').forEach(input => {
    estimateOptions[Number(input.dataset.idx)].label = input.value;
  });
  document.querySelectorAll('.opt-price-input').forEach(input => {
    estimateOptions[Number(input.dataset.idx)].price = Number(input.value);
  });
}

function renderOptionsTable() {
  const tbody = document.getElementById('options-tbody');
  if (estimateOptions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:#999;">No options yet. Import a CSV or add a row.</td></tr>';
    return;
  }
  tbody.innerHTML = estimateOptions.map((opt, i) => `
    <tr>
      <td><input type="text" class="opt-label-input" data-idx="${i}" value="${escHtml(opt.label)}" placeholder="Service name"></td>
      <td><input type="number" class="opt-price-input" data-idx="${i}" value="${opt.price}" min="0" step="1"></td>
      <td><button class="btn-delete-single" onclick="removeOption(${i})">Remove</button></td>
    </tr>
  `).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function removeOption(idx) {
  syncOptionsFromInputs();
  estimateOptions.splice(idx, 1);
  renderOptionsTable();
}

async function saveEstimateOptions() {
  syncOptionsFromInputs();
  const valid = estimateOptions.filter(o => o.label.trim() && !isNaN(o.price));

  if (window.localStore) {
    await window.localStore.saveEstimateOptions(valid).catch(() => {});
  }

  try {
    const res = await fetch(`${serverUrl}/api/estimate-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: valid }),
    });
    if (res.ok) {
      setOptionsStatus(`Saved ${valid.length} option(s) to server.`);
    } else {
      setOptionsStatus('Saved locally. Server returned an error.');
    }
  } catch {
    setOptionsStatus('Saved locally. Server is offline — will push on next startup.');
  }
}

async function loadEstimateOptionsFromServer() {
  try {
    const res = await fetch(`${serverUrl}/api/estimate-options`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        estimateOptions = data;
        renderOptionsTable();
        return;
      }
    }
  } catch { /* fall through to local */ }

  if (window.localStore) {
    const local = await window.localStore.loadEstimateOptions().catch(() => []);
    if (local && local.length > 0) {
      estimateOptions = local;
      renderOptionsTable();
    }
  }
}

async function pushLocalEstimateOptionsToServer() {
  if (!window.localStore) return;
  try {
    const local = await window.localStore.loadEstimateOptions().catch(() => null);
    if (!local || local.length === 0) return;
    await fetch(`${serverUrl}/api/estimate-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: local }),
    });
  } catch { /* server offline — will retry next startup */ }
}

function exportOptionsCsv() {
  syncOptionsFromInputs();
  const rows = estimateOptions.map(o => `"${String(o.label).replace(/"/g, '""')}",${o.price}`);
  const csv = 'Service Name,Price\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'estimate-options.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function setOptionsStatus(msg) {
  const el = document.getElementById('options-status');
  if (el) el.textContent = msg;
}
