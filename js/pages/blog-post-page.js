import { withLoader } from '../loader.js';
    import { injectLayout } from '../layout.js';
    import { getPosts } from '../blog-data.js';

    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function safeHtml(html) {
      if (typeof DOMPurify === 'undefined') return esc(html);
      return DOMPurify.sanitize(html || '', {
        ALLOWED_TAGS: ['p','br','h2','h3','h4','ul','ol','li','a','strong','em','b','i',
                       'blockquote','pre','code','img','figure','figcaption','table',
                       'thead','tbody','tr','th','td','hr','span','div'],
        ALLOWED_ATTR: ['href','src','alt','title','class','target','rel'],
        ALLOW_DATA_ATTR: false,
        FORCE_HTTPS: true,
      });
    }

    withLoader(async () => {
      injectLayout({ activePage: 'Blog' });
      const slug = new URLSearchParams(window.location.search).get('slug');
      const posts = await getPosts();
      const post  = slug ? posts.find(p => p.slug === slug && p.published) : null;
      if (!post) {
        document.getElementById('post-content').innerHTML = `
          <div style="text-align:center;padding:5rem 2rem;color:var(--clr-text-3)">
            <i class="fa-solid fa-newspaper" style="font-size:3rem;display:block;margin-bottom:1rem;opacity:.3"></i>
            <h2>Post not found</h2>
            <p>This post may have been removed or the link is incorrect.</p>
            <a href="blog.html" class="btn btn-outline" style="margin-top:1.5rem">\u2190 Back to Blog</a>
          </div>`;
        return;
      }
      document.title = `${esc(post.seoTitle||post.title)} \u2014 Manarize Blog`;
      document.querySelector('meta[name="description"]')?.setAttribute('content', post.seoDesc||post.excerpt||'');
      const fmt = d => new Date(d).toLocaleDateString('en-LK',{day:'2-digit',month:'long',year:'numeric'});
      document.getElementById('post-content').innerHTML = `
        <div class="post-wrap">
          <div class="breadcrumb" style="margin-bottom:1.5rem">
            <a href="index.html">Home</a>
            <span class="breadcrumb-sep"><i class="fa-solid fa-chevron-right" style="font-size:.625rem"></i></span>
            <a href="blog.html">Blog</a>
            <span class="breadcrumb-sep"><i class="fa-solid fa-chevron-right" style="font-size:.625rem"></i></span>
            <span class="current">${esc(post.title)}</span>
          </div>
          ${post.category ? `<div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:var(--clr-gold);margin-bottom:1rem;font-weight:600">${esc(post.category)}</div>` : ''}
          <h1 style="font-size:clamp(1.75rem,4vw,2.5rem);line-height:1.2;margin-bottom:1rem">${esc(post.title)}</h1>
          <div style="display:flex;align-items:center;gap:1rem;color:var(--clr-text-3);font-size:.875rem;margin-bottom:2rem;padding-bottom:2rem;border-bottom:1px solid var(--clr-border);flex-wrap:wrap">
            <span><i class="fa-regular fa-calendar"></i> ${fmt(post.createdAt)}</span>
            <span><i class="fa-regular fa-clock"></i> ${esc(String(post.readTime||5))} min read</span>
            <span><i class="fa-regular fa-user"></i> ${esc(post.author||'Manarize Team')}</span>
          </div>
          ${post.coverImage ? `<img src="${esc(post.coverImage)}" alt="${esc(post.title)}" class="post-hero" data-err-hide loading="lazy">` : ''}
          <div class="post-body info-page-content" style="padding:0">${safeHtml(post.content)}</div>
          ${post.tags?.length ? `<div class="post-tags">${post.tags.map(t=>`<span class="post-tag">#${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="post-nav">
            <a href="blog.html">\u2190 Back to Blog</a>
            <a href="shop.html"><i class="fa-solid fa-store"></i> Shop Now</a>
          </div>
          ${renderRelated(posts, post)}
        </div>`;
      // Share buttons
      const shareUrl = encodeURIComponent(window.location.href);
      const shareText = encodeURIComponent(post.title);
      const shareEl = document.getElementById('share-bar');
      if (shareEl) {
        shareEl.innerHTML = `
          <span style="font-size:.8125rem;color:var(--clr-text-3);margin-right:.5rem">Share:</span>
          <a href="https://wa.me/?text=${shareText}%20${shareUrl}" target="_blank" class="btn btn-ghost btn-sm" style="color:#25d366"><i class="fa-brands fa-whatsapp"></i></a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" class="btn btn-ghost btn-sm" style="color:#1877f2"><i class="fa-brands fa-facebook-f"></i></a>
          <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-brands fa-x-twitter"></i></a>`;
      }
    });
    function renderRelated(posts, current) {
      const related = posts.filter(p => p.published && p.id !== current.id && p.category === current.category).slice(0,3);
      if (!related.length) return '';
      const fmt = d => new Date(d).toLocaleDateString('en-LK',{day:'2-digit',month:'short',year:'numeric'});
      return `
        <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--clr-border)">
          <h3 style="font-family:var(--ff-display);font-size:1.25rem;margin-bottom:1.25rem">More from ${current.category}</h3>
          <div class="related-grid">
            ${related.map(p=>`
              <a href="blog-post.html?slug=${p.slug}" style="text-decoration:none">
                <div style="border-radius:var(--r-lg);overflow:hidden;background:var(--clr-surface);border:1px solid var(--clr-border);transition:all var(--t-fast)" class="card-hover">
                  ${p.coverImage ? `<img src="${p.coverImage}" alt="${p.title}" style="width:100%;height:140px;object-fit:cover" data-err-hide loading="lazy">` : ''}
                  <div style="padding:1rem">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--clr-gold);margin-bottom:.375rem">${p.category}</div>
                    <div style="font-weight:600;font-size:.875rem;color:var(--clr-text);line-height:1.35">${p.title}</div>
                    <div style="font-size:.75rem;color:var(--clr-text-3);margin-top:.375rem">${fmt(p.createdAt)}</div>
                  </div>
                </div>
              </a>`).join('')}
          </div>
        </div>`;
    }
