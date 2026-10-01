function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

onReady(function () {
  const btn = document.querySelector('[data-toggle-password]');
  const input = document.getElementById('password');
  if (!input) return;

  const eye = btn.querySelector('.icon-eye');
  const eyeOff = btn.querySelector('.icon-eye-off');
  const sr = btn.querySelector('.sr-only');

  function setState(isVisible) {
    btn.setAttribute('aria-pressed', String(isVisible));
    input.setAttribute('type', isVisible ? 'text' : 'password');
    if (eye && eyeOff) {
      eye.hidden = isVisible;
      eyeOff.hidden = !isVisible;
    }
    if (sr) {
      const showLbl = btn.getAttribute('data-label-show') || 'Show password';
      const hideLbl = btn.getAttribute('data-label-hide') || 'Hide password';
      sr.textContent = isVisible ? hideLbl : showLbl;
    }
    const showLbl = btn.getAttribute('data-label-show') || 'Show password';
    const hideLbl = btn.getAttribute('data-label-hide') || 'Hide password';
    btn.setAttribute('aria-label', sr ? sr.textContent : (isVisible ? hideLbl : showLbl));
  }

  function toggleFromEvent(e) {
    e.preventDefault();
    const visible = input.getAttribute('type') === 'password';
    setState(visible);
  }

  if (btn) {
    btn.addEventListener('click', toggleFromEvent);
  }

  // Delegated/click-on-input fallback (in case the button is overlapped)
  document.addEventListener('click', function (e) {
    if (!input) return;
    const btnEl = e.target && (e.target.closest ? e.target.closest('[data-toggle-password]') : null);
    if (btnEl) return toggleFromEvent(e);
    if (e.target === input) {
      try {
        const rect = input.getBoundingClientRect();
        const pad = 56; // keep in sync with CSS padding-right
        if (e.clientX >= rect.right - pad) {
          return toggleFromEvent(e);
        }
      } catch (_) { /* ignore */ }
    }
  }, true);

  // Keyboard friendly: Space toggles too (button handles Enter by default)
  btn.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });
});
