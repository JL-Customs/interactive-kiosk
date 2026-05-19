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
  pushAllToServer();
  loadAllEstimateOptions();
  setupPartsLibrary();
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
      if (sectionId === 'parts') renderPartsLibrary();
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
  const allFiles = Array.from(files || []);

  const csvFiles = allFiles.filter(f => f.type === 'text/csv' || f.name.toLowerCase().endsWith('.csv'));
  const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));

  // Process CSVs immediately
  if (csvFiles.length > 0) {
    csvFiles.forEach(f => parseAndLoadCsvAuto(f));
  }

  // Stage images using a DataTransfer so fileInput.files reflects only images
  const dt = new DataTransfer();
  imageFiles.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;

  if (imageFiles.length === 0) {
    uploadArea.classList.remove('has-files');
    if (csvFiles.length > 0) {
      summaryEl.textContent = `${csvFiles.length} CSV file(s) imported as estimate options.`;
      listEl.innerHTML = '';
    } else {
      summaryEl.textContent = 'No files selected yet.';
      listEl.innerHTML = '';
    }
    return;
  }

  uploadArea.classList.add('has-files');
  const csvNote = csvFiles.length > 0 ? ` (+${csvFiles.length} CSV imported)` : '';
  summaryEl.textContent = `${imageFiles.length} photo(s) staged and ready to upload${csvNote}.`;
  listEl.innerHTML = imageFiles.map((file) => `
    <li>
      <span>${file.name}</span>
      <span class="selected-file-size">${formatFileSize(file.size)}</span>
    </li>
  `).join('');
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
// estimateOptions      = current company's [{ category, items }]
// estimateOptionsByCompany = { Company_1: [...], Company_2: [...] }

let estimateOptions = [];
let estimateOptionsByCompany = {};
let currentCompany = null;

function setupCsvTab() {
  const dropZone = document.getElementById('csv-upload-area');
  const fileInput = document.getElementById('csv-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(f => {
      if (f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv') parseAndLoadCsv(f);
    });
  });
  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files).forEach(f => parseAndLoadCsv(f));
    fileInput.value = '';
  });

  document.getElementById('add-company-btn').addEventListener('click', addCompany);
  document.getElementById('add-option-btn').addEventListener('click', addCategory);
  document.getElementById('save-options-btn').addEventListener('click', saveEstimateOptions);
  document.getElementById('export-csv-btn').addEventListener('click', exportOptionsCsv);
}

// Parse CSV text into [{ category, items }]
// Supports:
//   4 col: "Category, Item, Price, Requires"  (Requires = pipe-separated item labels)
//   3 col: "Category, Item, Price"
//   2 col: "Item, Price"  (legacy → "General" category)
function parseCsvText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const map = new Map();

  for (const line of lines) {
    const parts = line.split(',');

    if (parts.length >= 3) {
      const category = parts[0].trim().replace(/^"|"$/g, '');
      if (category.toLowerCase() === 'category') continue; // skip header

      let label, price, requires = [];

      if (parts.length >= 4) {
        // 4-col: Category, Item, Price, Requires
        label = parts[1].trim().replace(/^"|"$/g, '');
        price = parseFloat(parts[2].replace(/[^0-9.]/g, ''));
        const req = parts[3].trim().replace(/^"|"$/g, '');
        requires = req ? req.split('|').map(r => r.trim()).filter(Boolean) : [];
      } else {
        // 3-col: Category, Item, Price
        label = parts[1].trim().replace(/^"|"$/g, '');
        price = parseFloat(parts[2].replace(/[^0-9.]/g, ''));
      }

      if (!category || !label || isNaN(price)) continue;
      if (!map.has(category)) map.set(category, []);
      map.get(category).push({ label, price, requires });
    } else if (parts.length === 2) {
      const label = parts[0].trim().replace(/^"|"$/g, '');
      const price = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
      if (!label || isNaN(price)) continue;
      if (!map.has('General')) map.set('General', []);
      map.get('General').push({ label, price, requires: [] });
    }
  }

  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

// Normalize loaded data: handle both new [{category,items}] and old [{label,price}] formats
function normalizeEstimateOptions(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (data[0].category !== undefined) return data;
  // Legacy flat format
  return [{ category: 'General', items: data }];
}

function parseAndLoadCsv(file) {
  const company = file.name.replace(/\.csv$/i, '') || 'New Company';
  const isReplace = company in estimateOptionsByCompany;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const parsed = parseCsvText(e.target.result);
    if (parsed.length === 0) { setOptionsStatus(`No valid rows found in ${file.name}.`); return; }
    estimateOptionsByCompany[company] = parsed;
    switchToCompany(company);
    await saveAllToLocalStore();
    try {
      await fetch(`${serverUrl}/api/estimate-options/${encodeURIComponent(company)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: parsed }),
      });
    } catch { /* server offline */ }
    const total = parsed.reduce((s, c) => s + c.items.length, 0);
    setOptionsStatus(`${isReplace ? 'Replaced' : 'Imported'} ${total} item(s) for "${company}".`);
  };
  reader.readAsText(file);
}

function parseAndLoadCsvAuto(file) {
  const company = file.name.replace(/\.csv$/i, '') || currentCompany || 'New Company';
  const isReplace = company in estimateOptionsByCompany;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const parsed = parseCsvText(e.target.result);
    if (parsed.length === 0) return;
    estimateOptionsByCompany[company] = parsed;
    renderCompanyList();
    if (company === currentCompany) { estimateOptions = parsed; renderOptionsTable(); }
    await saveAllToLocalStore();
    try {
      await fetch(`${serverUrl}/api/estimate-options/${encodeURIComponent(company)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: parsed }),
      });
    } catch { /* server offline */ }
    const total = parsed.reduce((s, c) => s + c.items.length, 0);
    setOptionsStatus(`${isReplace ? 'Replaced' : 'Imported'} ${total} item(s) from ${file.name}.`);
  };
  reader.readAsText(file);
}

function syncOptionsFromInputs() {
  document.querySelectorAll('.opt-category-input').forEach(input => {
    const c = Number(input.dataset.cat);
    if (estimateOptions[c]) estimateOptions[c].category = input.value;
  });
  document.querySelectorAll('.opt-label-input').forEach(input => {
    const c = Number(input.dataset.cat), i = Number(input.dataset.item);
    if (estimateOptions[c]?.items[i]) estimateOptions[c].items[i].label = input.value;
  });
  document.querySelectorAll('.opt-price-input').forEach(input => {
    const c = Number(input.dataset.cat), i = Number(input.dataset.item);
    if (estimateOptions[c]?.items[i]) estimateOptions[c].items[i].price = Number(input.value);
  });
  document.querySelectorAll('.opt-requires-input').forEach(input => {
    const c = Number(input.dataset.cat), i = Number(input.dataset.item);
    if (estimateOptions[c]?.items[i]) {
      const val = input.value.trim();
      estimateOptions[c].items[i].requires = val ? val.split('|').map(r => r.trim()).filter(Boolean) : [];
    }
  });
  document.querySelectorAll('.opt-type-select').forEach(input => {
    const c = Number(input.dataset.cat);
    if (estimateOptions[c]) estimateOptions[c].type = input.value;
  });
}

function renderOptionsTable() {
  const tbody = document.getElementById('options-tbody');
  if (estimateOptions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:#999;">No options yet. Import a CSV or add a category.</td></tr>';
    return;
  }

  let html = '';
  estimateOptions.forEach((cat, catIdx) => {
    const catType = cat.type || 'multiple';
    html += `
      <tr class="category-header-row">
        <td colspan="2">
          <input type="text" class="opt-category-input" data-cat="${catIdx}" value="${escHtml(cat.category)}" placeholder="Category name">
        </td>
        <td>
          <select class="opt-type-select" data-cat="${catIdx}">
            <option value="multiple"${catType === 'multiple' ? ' selected' : ''}>Multiple</option>
            <option value="single"${catType === 'single' ? ' selected' : ''}>Single</option>
          </select>
        </td>
        <td>
          <button class="btn-delete-single" onclick="removeCategory(${catIdx})">Remove Category</button>
        </td>
      </tr>
    `;
    cat.items.forEach((item, itemIdx) => {
      const requiresVal = Array.isArray(item.requires) ? item.requires.join('|') : (item.requires || '');
      html += `
        <tr class="category-item-row">
          <td><input type="text" class="opt-label-input" data-cat="${catIdx}" data-item="${itemIdx}" value="${escHtml(item.label)}" placeholder="Item name"></td>
          <td><input type="number" class="opt-price-input" data-cat="${catIdx}" data-item="${itemIdx}" value="${item.price}" min="0" step="1"></td>
          <td><input type="text" class="opt-requires-input" data-cat="${catIdx}" data-item="${itemIdx}" value="${escHtml(requiresVal)}" placeholder="Item 1|Item 2"></td>
          <td><button class="btn-delete-single" onclick="removeItem(${catIdx},${itemIdx})">Remove</button></td>
        </tr>
      `;
    });
    html += `
      <tr class="category-add-row">
        <td colspan="4">
          <button class="btn btn-primary add-item-btn" onclick="addItem(${catIdx})">+ Add Item</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addCategory() {
  syncOptionsFromInputs();
  estimateOptions.push({ category: 'New Category', type: 'multiple', items: [] });
  renderOptionsTable();
}

function addItem(catIdx) {
  syncOptionsFromInputs();
  if (estimateOptions[catIdx]) {
    estimateOptions[catIdx].items.push({ label: '', price: 0 });
    renderOptionsTable();
  }
}

function removeCategory(catIdx) {
  syncOptionsFromInputs();
  estimateOptions.splice(catIdx, 1);
  renderOptionsTable();
}

function removeItem(catIdx, itemIdx) {
  syncOptionsFromInputs();
  if (estimateOptions[catIdx]) {
    estimateOptions[catIdx].items.splice(itemIdx, 1);
    renderOptionsTable();
  }
}

// ── Company panel ──────────────────────────────────────────────

function renderCompanyList() {
  const list = document.getElementById('company-list');
  const companies = Object.keys(estimateOptionsByCompany).sort();

  const csvCountEl = document.getElementById('csv-count');
  if (csvCountEl) csvCountEl.textContent = companies.length;

  if (companies.length === 0) {
    list.innerHTML = '<p class="company-empty">No companies yet.<br>Import a CSV or click + Add.</p>';
    return;
  }

  list.innerHTML = companies.map(name => {
    const opts = estimateOptionsByCompany[name] || [];
    const count = opts.reduce((s, c) => s + (c.items?.length || 0), 0);
    const active = name === currentCompany ? 'active' : '';
    return `
      <div class="company-item ${active}" onclick="switchToCompany('${escHtml(name)}')">
        <div class="company-item-info">
          <span class="company-item-name">${escHtml(name)}</span>
          <span class="company-item-count">${count} item${count !== 1 ? 's' : ''}</span>
        </div>
        <button class="company-item-delete" onclick="event.stopPropagation();deleteCompany('${escHtml(name)}')" title="Remove">&times;</button>
      </div>
    `;
  }).join('');
}

function switchToCompany(name) {
  if (currentCompany && currentCompany !== name) syncOptionsFromInputs();
  currentCompany = name;
  estimateOptions = estimateOptionsByCompany[name] || [];
  renderCompanyList();
  renderOptionsTable();
  setOptionsStatus('');
}

function addCompany() {
  const name = prompt('Company name:');
  if (!name?.trim()) return;
  const trimmed = name.trim();
  estimateOptionsByCompany[trimmed] = [];
  switchToCompany(trimmed);
}

function deleteCompany(name) {
  if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
  delete estimateOptionsByCompany[name];
  if (currentCompany === name) {
    const remaining = Object.keys(estimateOptionsByCompany).sort();
    currentCompany = remaining[0] || null;
    estimateOptions = currentCompany ? (estimateOptionsByCompany[currentCompany] || []) : [];
  }
  renderCompanyList();
  renderOptionsTable();
  saveAllToLocalStore();
}

async function saveAllToLocalStore() {
  if (!window.localStore) return;
  await window.localStore.saveEstimateOptions(estimateOptionsByCompany).catch(() => {});
}

async function loadAllEstimateOptions() {
  // Load from server
  try {
    const res = await fetch(`${serverUrl}/api/estimate-options`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [company, opts] of Object.entries(data)) {
          estimateOptionsByCompany[company] = normalizeEstimateOptions(opts);
        }
      }
    }
  } catch { /* fall through */ }

  // Merge local store (fills in anything missing from server)
  if (window.localStore) {
    const local = await window.localStore.loadEstimateOptions().catch(() => null);
    if (local && typeof local === 'object' && !Array.isArray(local)) {
      for (const [company, opts] of Object.entries(local)) {
        if (!estimateOptionsByCompany[company]) {
          estimateOptionsByCompany[company] = normalizeEstimateOptions(opts);
        }
      }
    }
  }

  renderCompanyList();
  const first = Object.keys(estimateOptionsByCompany).sort()[0];
  if (first) switchToCompany(first);
  renderPartsLibrary();
}

async function pushAllToServer() {
  if (!window.localStore) return;
  const local = await window.localStore.loadEstimateOptions().catch(() => null);
  if (!local || typeof local !== 'object' || Array.isArray(local)) return;
  for (const [company, opts] of Object.entries(local)) {
    if (!opts || opts.length === 0) continue;
    fetch(`${serverUrl}/api/estimate-options/${encodeURIComponent(company)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: opts }),
    }).catch(() => {});
  }
}

async function saveEstimateOptions() {
  if (!currentCompany) { setOptionsStatus('Select a company first.'); return; }
  syncOptionsFromInputs();

  const valid = estimateOptions
    .map(cat => ({ ...cat, category: cat.category.trim(), items: cat.items.filter(i => i.label.trim() && !isNaN(i.price)) }))
    .filter(cat => cat.category && cat.items.length > 0);

  estimateOptionsByCompany[currentCompany] = valid;
  await saveAllToLocalStore();
  renderCompanyList();

  try {
    const res = await fetch(`${serverUrl}/api/estimate-options/${encodeURIComponent(currentCompany)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: valid }),
    });
    const total = valid.reduce((s, c) => s + c.items.length, 0);
    setOptionsStatus(res.ok ? `Saved ${total} item(s) for "${currentCompany}".` : 'Saved locally. Server returned an error.');
  } catch {
    setOptionsStatus('Saved locally. Server is offline — will push on next startup.');
  }
}

function exportOptionsCsv() {
  syncOptionsFromInputs();
  const rows = [];
  estimateOptions.forEach(cat => {
    cat.items.forEach(item => {
      const cat_ = String(cat.category).replace(/"/g, '""');
      const label = String(item.label).replace(/"/g, '""');
      const req = Array.isArray(item.requires) ? item.requires.join('|') : (item.requires || '');
      rows.push(`"${cat_}","${label}",${item.price},${req}`);
    });
  });
  const csv = 'Category,Item,Price,Requires\n' + rows.join('\n');
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

// ── Parts Library ──────────────────────────────────────────────

let partsSort = { col: 'label', dir: 1 };
let partsGrouped = []; // [{ label, entries: [{ company, category, price, requires }] }]

function setupPartsLibrary() {
  document.getElementById('parts-search').addEventListener('input', renderPartsLibrary);
  document.getElementById('parts-company-filter').addEventListener('change', renderPartsLibrary);
  document.querySelectorAll('#parts-table .sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      partsSort.dir = partsSort.col === col ? partsSort.dir * -1 : 1;
      partsSort.col = col;
      renderPartsLibrary();
    });
  });
}

function renderPartsLibrary() {
  const search = (document.getElementById('parts-search')?.value || '').toLowerCase().trim();
  const companyFilter = document.getElementById('parts-company-filter')?.value || '';

  // Build flat rows from all companies
  const allRows = [];
  for (const [company, cats] of Object.entries(estimateOptionsByCompany)) {
    for (const cat of (cats || [])) {
      for (const item of (cat.items || [])) {
        allRows.push({
          company,
          category: cat.category || '',
          label: item.label || '',
          price: item.price ?? 0,
          requires: Array.isArray(item.requires) ? item.requires : [],
        });
      }
    }
  }

  // Sync company filter dropdown
  const filterEl = document.getElementById('parts-company-filter');
  if (filterEl) {
    const companies = [...new Set(allRows.map(r => r.company))].sort();
    filterEl.innerHTML = '<option value="">All Companies</option>' +
      companies.map(c => `<option value="${escHtml(c)}"${c === companyFilter ? ' selected' : ''}>${escHtml(c)}</option>`).join('');
  }

  // Filter by company and search
  let rows = allRows.filter(row => {
    if (companyFilter && row.company !== companyFilter) return false;
    if (search && !`${row.company} ${row.category} ${row.label}`.toLowerCase().includes(search)) return false;
    return true;
  });

  // Sort flat rows (determines order within groups and group order)
  rows.sort((a, b) => {
    if (partsSort.col === 'price') return (a.price - b.price) * partsSort.dir;
    return String(a[partsSort.col]).localeCompare(String(b[partsSort.col])) * partsSort.dir;
  });

  // Group by normalized item label; preserve sorted order
  const groupMap = new Map();
  for (const row of rows) {
    const key = row.label.trim().toLowerCase();
    if (!groupMap.has(key)) groupMap.set(key, { label: row.label, entries: [] });
    groupMap.get(key).entries.push(row);
  }
  for (const group of groupMap.values()) {
    group.entries.sort((a, b) => a.company.localeCompare(b.company));
  }
  partsGrouped = [...groupMap.values()];

  // Stats
  const statsEl = document.getElementById('parts-stats');
  if (statsEl) {
    const filtered = search || companyFilter;
    statsEl.innerHTML =
      `<span class="parts-stat">${Object.keys(estimateOptionsByCompany).length} companies</span>` +
      `<span class="parts-stat">${allRows.length} total entries</span>` +
      (filtered
        ? `<span class="parts-stat parts-stat-filtered">${partsGrouped.length} item${partsGrouped.length !== 1 ? 's' : ''} shown</span>`
        : `<span class="parts-stat">${partsGrouped.length} unique items</span>`);
  }

  const tbody = document.getElementById('parts-tbody');
  if (!tbody) return;

  if (partsGrouped.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#999;">${
      allRows.length === 0 ? 'No parts loaded. Upload CSVs in Estimate Options.' : 'No items match your search.'
    }</td></tr>`;
    updatePartsSortArrows();
    return;
  }

  tbody.innerHTML = partsGrouped.map((group, idx) => {
    const first = group.entries[0];
    const multi = group.entries.length > 1;
    const companyCell = multi
      ? `<select class="parts-company-sel" data-group="${idx}">
           ${group.entries.map((e, i) => `<option value="${i}">${escHtml(e.company)}</option>`).join('')}
         </select>`
      : escHtml(first.company);

    return `<tr>
      <td>${companyCell}</td>
      <td class="parts-cat-cell">${escHtml(first.category)}</td>
      <td>${escHtml(group.label)}</td>
      <td class="parts-price-cell">$${partsFormatPrice(first.price)}</td>
      <td class="parts-req-cell">${partsReqTags(first.requires)}</td>
      <td><button class="btn-delete-single parts-edit-btn" onclick="editPartsRow(${idx})">Edit</button></td>
    </tr>`;
  }).join('');

  // Wire company dropdowns
  tbody.querySelectorAll('.parts-company-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const entry = partsGrouped[Number(sel.dataset.group)].entries[Number(sel.value)];
      const tr = sel.closest('tr');
      tr.querySelector('.parts-cat-cell').textContent = entry.category;
      tr.querySelector('.parts-price-cell').textContent = '$' + partsFormatPrice(entry.price);
      tr.querySelector('.parts-req-cell').innerHTML = partsReqTags(entry.requires);
    });
  });

  updatePartsSortArrows();
}

function partsFormatPrice(price) {
  return Number(price).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function partsReqTags(requires) {
  if (!requires || requires.length === 0) return '';
  return requires.map(r => `<span class="parts-req-tag">${escHtml(r)}</span>`).join('');
}

function updatePartsSortArrows() {
  document.querySelectorAll('#parts-table .sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = th.dataset.col === partsSort.col ? (partsSort.dir === 1 ? ' ↑' : ' ↓') : '';
  });
}

function editPartsRow(groupIdx) {
  const group = partsGrouped[groupIdx];
  const tbody = document.getElementById('parts-tbody');
  const tr = tbody.querySelectorAll('tr')[groupIdx];

  // Use whichever company is currently selected in the dropdown (or 0 for single)
  const sel = tr.querySelector('.parts-company-sel');
  const entryIdx = sel ? Number(sel.value) : 0;
  const entry = group.entries[entryIdx];

  tr.dataset.origCompany = entry.company;
  tr.dataset.origCategory = entry.category;
  tr.dataset.origLabel = entry.label;

  tr.innerHTML = `
    <td><span class="parts-edit-company">${escHtml(entry.company)}</span></td>
    <td><input class="parts-edit-input" id="edit-cat-${groupIdx}" value="${escHtml(entry.category)}"></td>
    <td><input class="parts-edit-input" id="edit-label-${groupIdx}" value="${escHtml(entry.label)}"></td>
    <td><input class="parts-edit-input parts-edit-price" id="edit-price-${groupIdx}" type="number" value="${entry.price}" min="0" step="1"></td>
    <td><input class="parts-edit-input" id="edit-req-${groupIdx}" value="${escHtml(entry.requires.join('|'))}" placeholder="Item 1|Item 2"></td>
    <td>
      <div class="parts-row-actions">
        <button class="btn btn-primary parts-save-btn" onclick="savePartsEdit(${groupIdx})">Save</button>
        <button class="btn parts-cancel-btn" onclick="renderPartsLibrary()">Cancel</button>
      </div>
    </td>
  `;

  document.getElementById(`edit-label-${groupIdx}`).focus();
}

async function savePartsEdit(groupIdx) {
  const tbody = document.getElementById('parts-tbody');
  const tr = tbody.querySelectorAll('tr')[groupIdx];

  const origCompany = tr.dataset.origCompany;
  const origCategory = tr.dataset.origCategory;
  const origLabel = tr.dataset.origLabel;

  const newCategory = document.getElementById(`edit-cat-${groupIdx}`).value.trim();
  const newLabel = document.getElementById(`edit-label-${groupIdx}`).value.trim();
  const newPrice = Number(document.getElementById(`edit-price-${groupIdx}`).value);
  const reqRaw = document.getElementById(`edit-req-${groupIdx}`).value.trim();
  const newRequires = reqRaw ? reqRaw.split('|').map(r => r.trim()).filter(Boolean) : [];

  if (!newLabel || !newCategory) {
    alert('Item name and category cannot be empty.');
    return;
  }

  const cats = estimateOptionsByCompany[origCompany];
  if (!cats) { renderPartsLibrary(); return; }

  const oldCatIdx = cats.findIndex(c => c.category === origCategory);
  if (oldCatIdx === -1) { renderPartsLibrary(); return; }

  const oldItemIdx = cats[oldCatIdx].items.findIndex(i => i.label === origLabel);
  if (oldItemIdx === -1) { renderPartsLibrary(); return; }

  if (newCategory === origCategory) {
    cats[oldCatIdx].items[oldItemIdx] = { label: newLabel, price: newPrice, requires: newRequires };
  } else {
    cats[oldCatIdx].items.splice(oldItemIdx, 1);
    if (cats[oldCatIdx].items.length === 0) cats.splice(oldCatIdx, 1);
    let targetCat = cats.find(c => c.category === newCategory);
    if (!targetCat) {
      targetCat = { category: newCategory, items: [] };
      cats.push(targetCat);
    }
    targetCat.items.push({ label: newLabel, price: newPrice, requires: newRequires });
  }

  await saveAllToLocalStore();
  try {
    await fetch(`${serverUrl}/api/estimate-options/${encodeURIComponent(origCompany)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: cats }),
    });
  } catch { /* server offline */ }

  renderPartsLibrary();
  setOptionsStatus(`Saved "${newLabel}" in ${origCompany}.`);
}
