// Photo Gallery Script - Fullscreen Display

let photos = [];
let currentIndex = 0;
let isPlaying = true;
let rotationInterval = parseInt(localStorage.getItem('galleryInterval')) || 5;
const DEFAULT_SERVER_URL = window.JLConfig.serverUrl;
let serverUrl = getInitialServerUrl();
let autoPlayTimer = null;
let refreshTimer = null;
let lastPhotoCount = 0;

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
  setupFullscreenControls();
  setupPhotoClickNavigation();
  setupKeyboardShortcuts();
  loadRemoteSettings().then(async () => {
    // Show cached photos immediately so the kiosk is never blank on startup
    await loadCachedPhotos();
    startAutoPlay();
    startAutoRefresh();
    // Refresh from server in background; updates display + cache if anything changed
    loadPhotos();
  });
});

function setupPhotoClickNavigation() {
  const photoEl = document.getElementById('current-photo');
  if (!photoEl) return;

  photoEl.addEventListener('click', () => {
    window.location.href = 'home.html';
  });
}

function setupFullscreenControls() {
  const toggleButton = document.getElementById('fullscreen-toggle');
  if (!toggleButton || !window.windowControls) return;

  const syncLabel = async () => {
    const isFullscreen = await window.windowControls.getFullscreenState();
    toggleButton.textContent = isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen';
  };

  toggleButton.addEventListener('click', async () => {
    await window.windowControls.toggleFullscreen();
    await syncLabel();
  });

  syncLabel();
}

async function loadPhotos() {
  try {
    const response = await fetch(`${serverUrl}/api/photos`);
    if (response.ok) {
      const newPhotos = await response.json();

      // Check if photos changed
      if (newPhotos.length !== lastPhotoCount) {
        console.log(`Photo count changed: ${lastPhotoCount} -> ${newPhotos.length}`);
        lastPhotoCount = newPhotos.length;
      }

      // Sort by order property if available and filter inactive photos
      photos = newPhotos
        .filter(p => p.active !== false)
        .sort((a, b) => {
          const orderA = a.order ?? 999;
          const orderB = b.order ?? 999;
          return orderA - orderB;
        });

      window.appLog?.write(`Server: fetched ${newPhotos.length} photo(s)`);
      // Persist to disk cache in the background
      cachePhotoData(newPhotos);

      if (photos.length > 0) {
        if (currentIndex >= photos.length) {
          currentIndex = 0;
        }
        displayPhoto();
        if (!autoPlayTimer) startAutoPlay();
      }
      return photos;
    }
  } catch (error) {
    window.appLog?.write(`Server: unreachable — showing cached photos (${error.message})`);
  }
}

async function cachePhotoData(photoList) {
  if (!window.photoCache) return;
  try {
    await window.photoCache.saveMetadata(photoList);
    window.appLog?.write(`Cache: saved metadata for ${photoList.length} photo(s)`);
    for (const photo of photoList) {
      if (photo.filename) {
        window.photoCache.downloadPhoto(photo.url, photo.filename)
          .then(localUrl => window.appLog?.write(`Cache: downloaded ${photo.filename} -> ${localUrl ? 'ok' : 'failed'}`))
          .catch(err => window.appLog?.write(`Cache: download error for ${photo.filename}: ${err.message}`));
      }
    }
  } catch (err) {
    window.appLog?.write(`Cache: saveMetadata error: ${err.message}`);
  }
}

async function loadCachedPhotos() {
  if (!window.photoCache) { window.appLog?.write('Cache: photoCache API not available'); return []; }
  try {
    const cached = await window.photoCache.loadMetadata();
    if (!cached || cached.length === 0) {
      window.appLog?.write('Cache: no metadata found — starting blank');
      return [];
    }
    window.appLog?.write(`Cache: loaded metadata for ${cached.length} photo(s)`);

    let localHits = 0;
    const resolved = await Promise.all(
      cached
        .filter(p => p.active !== false)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .map(async (photo) => {
          if (photo.filename) {
            const localUrl = await window.photoCache.getLocalPath(photo.filename);
            if (localUrl) { localHits++; return { ...photo, url: localUrl }; }
            window.appLog?.write(`Cache: missing local file for ${photo.filename} — will use remote`);
          }
          return photo;
        })
    );

    window.appLog?.write(`Cache: ${localHits}/${cached.length} photos resolved from local disk`);
    photos = resolved;
    if (photos.length > 0) {
      if (currentIndex >= photos.length) currentIndex = 0;
      displayPhoto();
      if (!autoPlayTimer) startAutoPlay();
    }
    return photos;
  } catch (err) {
    window.appLog?.write(`Cache: loadCachedPhotos error: ${err.message}`);
    return [];
  }
}

async function loadRemoteSettings() {
  try {
    const response = await fetch(`${serverUrl}/api/settings`);
    if (!response.ok) return;

    const data = await response.json();
    const nextInterval = Number(data.rotationInterval);
    if (Number.isFinite(nextInterval) && nextInterval >= 1 && nextInterval !== rotationInterval) {
      rotationInterval = nextInterval;
      localStorage.setItem('galleryInterval', String(rotationInterval));
      resetAutoPlay();
    }
  } catch {
    console.warn('Server offline — using cached rotation interval.');
  }
}

function displayPhoto() {
  if (photos.length === 0) return;
  const photo = photos[currentIndex];
  document.getElementById('current-photo').src = photo.url;
}

function nextPhoto() {
  if (photos.length === 0) return;
  currentIndex = (currentIndex + 1) % photos.length;
  displayPhoto();
}

function previousPhoto() {
  if (photos.length === 0) return;
  currentIndex = (currentIndex - 1 + photos.length) % photos.length;
  displayPhoto();
  resetAutoPlay();
}

function startAutoPlay() {
  if (autoPlayTimer) clearInterval(autoPlayTimer);

  if (isPlaying && photos.length > 0) {
    autoPlayTimer = setInterval(() => {
      nextPhoto();
    }, rotationInterval * 1000);
  }
}

function stopAutoPlay() {
  if (autoPlayTimer) {
    clearInterval(autoPlayTimer);
    autoPlayTimer = null;
  }
}

function resetAutoPlay() {
  if (isPlaying) {
    stopAutoPlay();
    startAutoPlay();
  }
}

async function refreshEstimateCache() {
  try {
    const res = await fetch(`${serverUrl}/api/estimate-options`);
    if (!res.ok) return;
    const all = await res.json();
    for (const [company, data] of Object.entries(all)) {
      if (Array.isArray(data) && data.length > 0) {
        localStorage.setItem(`cachedEstimateOptions_${company}`, JSON.stringify(data));
      }
    }
    window.appLog?.write(`EstimateCache: refreshed ${Object.keys(all).length} company/companies`);
  } catch (err) {
    window.appLog?.write(`EstimateCache: refresh failed — ${err.message}`);
  }
}

function startAutoRefresh() {
  // Check for photo changes every 10 seconds
  refreshTimer = setInterval(() => {
    loadRemoteSettings();
    loadPhotos();
  }, 10000);
  // Refresh estimate options cache once an hour
  refreshEstimateCache();
  setInterval(refreshEstimateCache, 60 * 5 * 1000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}



function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'F11' || e.key.toLowerCase() === 'f') && window.windowControls) {
      e.preventDefault();
      window.windowControls.toggleFullscreen().then((isFullscreen) => {
        const toggleButton = document.getElementById('fullscreen-toggle');
        if (toggleButton) {
          toggleButton.textContent = isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen';
        }
      });
      return;
    }
  });
}
