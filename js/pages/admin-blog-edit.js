/**
 * ADMIN-BLOG-EDIT.JS — Sidebar Panel Collapse (Admin Blog Editor)
 * ─────────────────────────────────────────────────────────────────
 * Adds click-to-collapse behaviour to each .sidebar-panel-header.
 * Toggling .collapsed on the header hides / shows .sidebar-panel-body
 * and rotates the chevron icon.
 */

// Collapsible sidebar panels (plain JS, no module needed)
    document.querySelectorAll('.sidebar-panel-header').forEach(header => {
      header.addEventListener('click', () => {
        const bodyId = header.id.replace('-header', '-body');
        const body = document.getElementById(bodyId);
        if (!body) return;
        const isHidden = body.classList.contains('hidden');
        body.classList.toggle('hidden', !isHidden);
        header.classList.toggle('collapsed', !isHidden);
      });
    });

    // Live slug preview
    document.getElementById('post-slug')?.addEventListener('input', e => {
      const preview = document.getElementById('slug-preview');
      if (preview) preview.textContent = e.target.value || 'your-slug';
    });
    // formatBlock select: wire to execCommand (non-module fallback handled in JS module via data-cmd)
    document.querySelector('.rich-toolbar select')?.addEventListener('change', function () {
      if (this.value) { document.execCommand('formatBlock', false, this.value); this.value = ''; }
    });
