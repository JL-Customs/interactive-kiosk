/* ============================================================
   JL Customs - kiosk print trigger + feedback toast
   Exposes window.kioskPrint(): prints the current page silently to
   the default printer (via the Electron `printer` bridge) and shows
   a small toast for feedback. Outside Electron (e.g. a plain dev
   browser) it falls back to the normal window.print() dialog.
   Pages build their off-screen #print-area first, then call this.
   ============================================================ */
(function () {
  'use strict';

  let toastEl = null;
  let hideTimer = null;

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'print-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
    return toastEl;
  }

  // state: 'printing' | 'ok' | 'error'
  function showToast(message, state) {
    const el = ensureToast();
    clearTimeout(hideTimer);

    el.classList.remove('print-toast-ok', 'print-toast-error');
    if (state === 'ok') el.classList.add('print-toast-ok');
    if (state === 'error') el.classList.add('print-toast-error');

    const glyph = state === 'printing'
      ? '<span class="print-toast-spinner" aria-hidden="true"></span>'
      : `<span class="print-toast-icon" aria-hidden="true">${state === 'ok' ? '✓' : '⚠'}</span>`;
    el.innerHTML = `${glyph}<span>${message}</span>`;

    // Force a reflow so the transition runs when re-showing an existing toast.
    void el.offsetWidth;
    el.classList.add('print-toast-show');

    if (state !== 'printing') {
      hideTimer = setTimeout(() => el.classList.remove('print-toast-show'), 2500);
    }
  }

  window.kioskPrint = async function kioskPrint() {
    // No Electron bridge (dev in a plain browser) - use the normal dialog.
    if (!window.printer || typeof window.printer.print !== 'function') {
      window.print();
      return;
    }

    showToast('Printing…', 'printing');
    try {
      const result = await window.printer.print();
      if (result && result.success) {
        showToast('Sent to printer', 'ok');
      } else {
        showToast('Couldn’t reach the printer', 'error');
      }
    } catch (_) {
      showToast('Couldn’t reach the printer', 'error');
    }
  };
})();
