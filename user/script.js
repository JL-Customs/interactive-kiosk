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
  loadRemoteSettings().then(() => {
    loadPhotos().then(() => {
      startAutoPlay();
      startAutoRefresh();
    });
  });
});

function setupPhotoClickNavigation() {
  const photoEl = document.getElementById('current-photo');
  if (!photoEl) return;

  photoEl.addEventListener('click', () => {
    window.location.href = 'estimate.html';
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
        .filter(p => p.active !== false) // Show photos that are active or don't have active property set
        .sort((a, b) => {
          const orderA = a.order ?? 999;
          const orderB = b.order ?? 999;
          return orderA - orderB;
        });
      
      if (photos.length > 0) {
        // Keep current index in bounds
        if (currentIndex >= photos.length) {
          currentIndex = 0;
        }
        displayPhoto();
      }
      return photos;
    }
  } catch (error) {
    console.error('Error loading photos:', error);
  }
  return [];
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
  } catch (error) {
    console.error('Error loading settings:', error);
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
  resetAutoPlay();
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
