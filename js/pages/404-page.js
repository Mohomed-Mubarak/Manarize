import { animate, utils } from 'https://cdn.jsdelivr.net/npm/animejs@4.0.2/lib/anime.esm.min.js';

    // Hide loader — CDN import resolved, page is ready
    const _loader = document.getElementById('page-loader');
    if (_loader) setTimeout(() => _loader.classList.add('hidden'), 300);

    const field = document.getElementById('particle-field');
    const COUNT = 140;

    // Spawn & animate each particle independently
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement('div');
      el.classList.add('particle');

      // Visual variety: normal / glow / tiny
      const roll = i % 12;
      if (roll === 0) el.classList.add('glow');
      else if (roll <= 3) el.classList.add('tiny');

      // Scatter randomly across the whole viewport
      el.style.left = utils.random(0, 100) + '%';
      el.style.top = utils.random(0, 100) + '%';
      field.appendChild(el);

      const dur = utils.random(3000, 7000);
      const delay = utils.random(0, 3500);
      const peak = utils.random(0.25, 0.8, 2);

      animate(el, {
        // Gentle drift in both axes
        x: [
          { to: utils.random(-140, 140) + 'px' },
          { to: utils.random(-140, 140) + 'px' },
        ],
        y: [
          { to: utils.random(-90, 90) + 'px' },
          { to: utils.random(-90, 90) + 'px' },
        ],
        // Breathe in → breathe out
        opacity: [
          { from: 0, to: peak },
          { to: 0 },
        ],
        scale: [
          { from: 0, to: utils.random(0.6, 1.5, 2) },
          { to: 0 },
        ],
        duration: dur,
        delay: delay,
        ease: 'inOutSine',
        loop: true,
      });
    }

    // Search → redirect to store
    document.getElementById('search-404').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) window.location.href = 'store.html?q=' + encodeURIComponent(q);
      }
    });
