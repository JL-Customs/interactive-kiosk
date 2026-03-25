// Admin Portal Script

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
  const storedUrl = normalizeServerUrl(
    localStorage.getItem('galleryServerUrl') || localStorage.getItem('serverUrl')
  );

  if (storedUrl && !/localhost|127\.0\.0\.1/i.test(storedUrl)) {
    return storedUrl;
  }

  return DEFAULT_SERVER_URL;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Keep one canonical key while still honoring older saved values.
  localStorage.setItem('galleryServerUrl', serverUrl);
  setupNavigation();
  setupUploadArea();
  setupSettings();
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
  fileInput.files = files;
  console.log(`${files.length} files selected for upload`);
}

async function uploadFiles() {
  const fileInput = document.getElementById('file-input');
  const files = fileInput.files;

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
}

async function loadPhotos() {
  try {
    const response = await fetch(`${serverUrl}/api/photos`);
    if (response.ok) {
      allPhotos = await response.json();
      
      // Initialize display order if not set
      allPhotos.forEach((photo, index) => {
        if (!(photo.id in displayOrder)) {
          displayOrder[photo.id] = index;
        }
      });
      
      displayPhotos(allPhotos);
      document.getElementById('photo-count').textContent = allPhotos.length;
      selectedPhotos.clear();
      document.getElementById('select-all-checkbox').checked = false;
      updateButtonStates();
    }
  } catch (error) {
    console.error('Error loading photos:', error);
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

  serverUrlInput.value = serverUrl;
  rotationIntervalInput.value = rotationInterval;

  saveBtn.addEventListener('click', async () => {
    serverUrl = normalizeServerUrl(serverUrlInput.value);
    rotationInterval = rotationIntervalInput.value;

    localStorage.setItem('galleryServerUrl', serverUrl);
    localStorage.setItem('serverUrl', serverUrl);
    localStorage.setItem('rotationInterval', rotationInterval);

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
    loadPhotos();
  } catch (error) {
    console.error('Error deleting photo:', error);
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
    alert('Photo order updated!');
    loadPhotos();
  } catch (error) {
    console.error('Error updating photo order:', error);
    alert('Failed to update photo order');
  }
}

function setupEventListeners() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadPhotos();
    checkServerStatus();
  });
}
