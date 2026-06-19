const DEFAULT_SERVER_URL = window.JLConfig.serverUrl;
let photos = [];
let lightboxIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  setupLightboxControls();
  loadPhotos();
});

async function loadPhotos() {
  try {
    const response = await fetch(`${DEFAULT_SERVER_URL}/api/photos`);
    if (response.ok) {
      const allPhotos = await response.json();
      photos = allPhotos
        .filter(p => p.active !== false)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      renderGrid();
      return;
    }
  } catch (e) {
    // server unreachable, fall through to cache
  }
  await loadFromCache();
}

async function loadFromCache() {
  if (!window.photoCache) {
    renderGrid();
    return;
  }
  try {
    const cached = await window.photoCache.loadMetadata();
    if (!cached || cached.length === 0) {
      renderGrid();
      return;
    }
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
  } catch (e) {
    console.error('Failed to load from cache:', e);
  }
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';

  if (photos.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-photos';
    msg.textContent = 'No photos to show yet — check back soon.';
    grid.appendChild(msg);
    return;
  }

  photos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = photo.name || `Photo ${index + 1}`;
    img.loading = 'lazy';
    item.appendChild(img);
    item.addEventListener('click', () => openLightbox(index));
    grid.appendChild(item);
  });
}

function openLightbox(index) {
  lightboxIndex = index;
  updateLightbox();
  document.getElementById('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.body.style.overflow = '';
}

function updateLightbox() {
  const photo = photos[lightboxIndex];
  document.getElementById('lightbox-img').src = photo.url;
  document.getElementById('lightbox-counter').textContent = `${lightboxIndex + 1} / ${photos.length}`;
}

function lightboxNext() {
  lightboxIndex = (lightboxIndex + 1) % photos.length;
  updateLightbox();
}

function lightboxPrev() {
  lightboxIndex = (lightboxIndex - 1 + photos.length) % photos.length;
  updateLightbox();
}

function setupLightboxControls() {
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-next').addEventListener('click', lightboxNext);
  document.getElementById('lightbox-prev').addEventListener('click', lightboxPrev);

  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightbox').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') lightboxNext();
    if (e.key === 'ArrowLeft') lightboxPrev();
    if (e.key === 'Escape') closeLightbox();
  });
}
