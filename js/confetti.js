/* Confetti animation for order success page */
(function(){
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');

  const COLORS = ['#c9a84c','#e8c97a','#ffffff','#f4a261','#a8d8a8','#74b3ce','#e07ba0'];
  const COUNT  = 140;
  const pieces = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function createPiece(x, y) {
    return {
      x, y,
      w: rand(7, 13),
      h: rand(4, 8),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: rand(0, Math.PI * 2),
      vx: rand(-4, 4),
      vy: rand(-9, -3),
      vrot: rand(-0.18, 0.18),
      gravity: 0.22,
      opacity: 1,
      fade: rand(0.008, 0.016),
      shape: Math.random() > 0.45 ? 'rect' : 'circle',
    };
  }

  // Burst from two points near the top
  function burst() {
    const cx = canvas.width;
    for (let i = 0; i < COUNT; i++) {
      pieces.push(createPiece(rand(cx * 0.3, cx * 0.7), rand(-20, canvas.height * 0.25)));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += p.gravity;
      p.rot += p.vrot;
      p.opacity -= p.fade;
      if (p.opacity <= 0 || p.y > canvas.height + 20) { pieces.splice(i, 1); continue; }

      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (pieces.length > 0) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Fire after page loads (slight delay so loader is gone)
  function fire() { burst(); draw(); }

  if (document.readyState === 'complete') {
    setTimeout(fire, 600);
  } else {
    window.addEventListener('load', () => setTimeout(fire, 600));
  }

  // Second burst for extra celebration
  setTimeout(fire, 1400);
})();
