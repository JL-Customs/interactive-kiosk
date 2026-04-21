// Photo Gallery Script - Fullscreen Display

let photos = [];
let currentIndex = 0;
let isPlaying = true;
let rotationInterval = parseInt(localStorage.getItem('galleryInterval')) || 5;
const DEFAULT_SERVER_URL = 'https://interactive-monitor-thing.onrender.com';
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
    console.warn('Could not reach server, showing cached photos.');
  }
}

async function cachePhotoData(photoList) {
  if (!window.photoCache) return;
  try {
    await window.photoCache.saveMetadata(photoList);
    for (const photo of photoList) {
      if (photo.filename) {
        window.photoCache.downloadPhoto(photo.url, photo.filename).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Error caching photos:', err);
  }
}

async function loadCachedPhotos() {
  if (!window.photoCache) return [];
  try {
    const cached = await window.photoCache.loadMetadata();
    if (!cached || cached.length === 0) return [];

    const resolved = await Promise.all(
      cached
        .filter(p => p.active !== false)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .map(async (photo) => {
          if (photo.filename) {
            const localUrl = await window.photoCache.getLocalPath(photo.filename);
            if (localUrl) return { ...photo, url: localUrl };
          }
          return photo;
        })
    );

    photos = resolved;
    if (photos.length > 0) {
      if (currentIndex >= photos.length) currentIndex = 0;
      displayPhoto();
      if (!autoPlayTimer) startAutoPlay();
    }
    return photos;
  } catch (err) {
    console.error('Error loading cached photos:', err);
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

function startAutoRefresh() {
  // Check for photo changes every 10 seconds
  refreshTimer = setInterval(() => {
    loadRemoteSettings();
    loadPhotos();
  }, 10000);
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
