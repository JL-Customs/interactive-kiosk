/* ============================================================
   JL Customs - on-screen touch keyboard
   Renders a QWERTY touch keyboard and wires it to any text field
   on the page. Letters, numbers, and symbols only - deliberately
   no function keys, tab, ctrl, alt, arrows, etc. Just what a
   customer needs to type a name, phone number, or email.
   ============================================================ */
(function () {
  'use strict';

  // Fields the keyboard should attach to. Radio/checkbox/number
  // spinners and the like are intentionally excluded.
  const TEXT_TYPES = ['text', 'tel', 'email', 'search', 'url', 'password'];

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return TEXT_TYPES.includes(type) && !el.disabled && !el.readOnly;
    }
    return false;
  }

  // ── Key layouts ────────────────────────────────────────────
  // Each entry is a printable character unless it's an object
  // describing a special key.
  const BACKSPACE = { special: 'backspace', label: '⌫', cls: 'kb-wide' };
  const SHIFT     = { special: 'shift',     label: '⇧', cls: 'kb-wide' };
  const LAYER_SYM = { special: 'layer',     label: '?123',   cls: 'kb-wide', to: 'symbols' };
  const LAYER_ABC = { special: 'layer',     label: 'ABC',    cls: 'kb-wide', to: 'letters' };
  const SPACE     = { special: 'space',     label: 'space',  cls: 'kb-space' };
  const DONE      = { special: 'done',      label: 'Done',   cls: 'kb-return' };

  const LAYOUTS = {
    letters: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      [SHIFT, 'z', 'x', 'c', 'v', 'b', 'n', 'm', BACKSPACE],
      [LAYER_SYM, '@', SPACE, '.', DONE],
    ],
    symbols: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['@', '#', '$', '&', '*', '(', ')', '-', '_', '+'],
      ['=', '/', ':', ';', '"', "'", '!', '?', ','],
      [{ special: 'layer', label: '#+=', cls: 'kb-wide', to: 'more' }, '%', '~', '\\', '|', '<', '>', '.', BACKSPACE],
      [LAYER_ABC, ',', SPACE, '.', DONE],
    ],
    more: [
      ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
      ['£', '€', '¥', '¢', '°', '±', '×', '÷', '§'],
      ['`', '•', '…', '™', '®', '©', '<', '>'],
      [{ special: 'layer', label: '?123', cls: 'kb-wide', to: 'symbols' }, '_', '\\', '|', '~', BACKSPACE],
      [LAYER_ABC, '@', SPACE, '.', DONE],
    ],
  };

  let target = null;      // currently focused editable field
  let layer = 'letters';  // active key layer
  let shifted = false;    // caps for the letter layer
  let rootEl = null;      // .kb container

  // ── Text manipulation ──────────────────────────────────────
  function fireInput(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function selRange(el) {
    // Some input types report null for selection; fall back to end.
    let start = el.selectionStart;
    let end = el.selectionEnd;
    if (start == null || end == null) {
      start = end = el.value.length;
    }
    return [start, end];
  }

  function insertText(el, text) {
    const [start, end] = selRange(el);
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (_) {}
    fireInput(el);
  }

  function backspace(el) {
    let [start, end] = selRange(el);
    if (start === end) {
      if (start === 0) return;
      el.value = el.value.slice(0, start - 1) + el.value.slice(end);
      start -= 1;
    } else {
      el.value = el.value.slice(0, start) + el.value.slice(end);
    }
    try { el.setSelectionRange(start, start); } catch (_) {}
    fireInput(el);
  }

  // ── Rendering ──────────────────────────────────────────────
  function render() {
    rootEl.innerHTML = '';
    const rows = LAYOUTS[layer];
    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      row.forEach((key) => rowEl.appendChild(buildKey(key)));
      rootEl.appendChild(rowEl);
    });
  }

  function buildKey(key) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'kb-key';
    el.tabIndex = -1;

    if (typeof key === 'string') {
      const ch = shifted && layer === 'letters' ? key.toUpperCase() : key;
      el.textContent = ch;
      el.dataset.char = ch;
    } else {
      el.textContent = key.label;
      if (key.cls) el.className += ' ' + key.cls;
      el.dataset.special = key.special;
      if (key.to) el.dataset.to = key.to;
      if (key.special === 'shift' && shifted) el.className += ' kb-active';
    }
    return el;
  }

  // ── Key handling ───────────────────────────────────────────
  function handleKey(el) {
    if (!target) return;

    if (el.dataset.char != null) {
      insertText(target, el.dataset.char);
      // Auto-drop shift after a single capital, like a phone keyboard.
      if (shifted && layer === 'letters') {
        shifted = false;
        render();
      }
      return;
    }

    switch (el.dataset.special) {
      case 'backspace': backspace(target); break;
      case 'space':     insertText(target, ' '); break;
      case 'shift':     shifted = !shifted; render(); break;
      case 'layer':     layer = el.dataset.to; shifted = false; render(); break;
      case 'done':      hide(); target.blur(); break;
    }
  }

  // ── Show / hide ────────────────────────────────────────────
  function show() {
    rootEl.classList.add('kb-visible');
    document.body.classList.add('kb-open');
  }

  function hide() {
    rootEl.classList.remove('kb-visible');
    document.body.classList.remove('kb-open');
    target = null;
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    rootEl = document.createElement('div');
    rootEl.className = 'kb';
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('aria-label', 'On-screen keyboard');
    render();
    document.body.appendChild(rootEl);

    // Pressing a key must not steal focus from the input.
    rootEl.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('.kb-key');
      if (!key) return;
      e.preventDefault();
      key.classList.add('kb-pressed');
    });
    rootEl.addEventListener('pointerup', (e) => {
      const key = e.target.closest('.kb-key');
      rootEl.querySelectorAll('.kb-pressed').forEach((k) => k.classList.remove('kb-pressed'));
      if (!key) return;
      e.preventDefault();
      handleKey(key);
    });
    // Guard for environments that fire click without pointer events.
    rootEl.addEventListener('click', (e) => e.preventDefault());

    document.addEventListener('focusin', (e) => {
      if (isEditable(e.target)) {
        target = e.target;
        layer = 'letters';
        shifted = false;
        render();
        show();
      }
    });

    // While the keyboard is up, swallow clicks that land on a modal
    // backdrop. Opening the keyboard re-aligns the overlay (centered →
    // top), so the modal jumps upward between the finger going down on
    // the field and the click resolving - the click then lands on the
    // exposed backdrop and would otherwise dismiss the dialog. The
    // modal's own Cancel/close buttons are inside .modal, so they're
    // unaffected. Capture phase so we win before the app's handler.
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('kb-open')) return;
      const t = e.target;
      if (t && t.classList && t.classList.contains('modal-overlay')) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Hide only on a deliberate tap outside the keyboard and outside any
    // field. We deliberately do NOT hide on `focusout`: on the Linux/
    // Electron touch stack, tapping a field briefly bounces focus to
    // <body>, which would otherwise slam the keyboard shut immediately.
    function onOutsidePointer(e) {
      if (!rootEl.classList.contains('kb-visible')) return;
      const t = e.target;
      if (t && t.closest && (t.closest('.kb') || isEditable(t))) return;
      hide();
    }
    document.addEventListener('pointerdown', onOutsidePointer, true);
    // Fallback for environments that don't deliver pointer events.
    document.addEventListener('touchstart', onOutsidePointer, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
