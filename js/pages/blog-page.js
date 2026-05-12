import { withLoader } from '../loader.js';
    import { injectLayout } from '../layout.js';
    import { getPosts } from '../blog-data.js';
    withLoader(async () => {
      injectLayout({ activePage: 'Blog' });
      const allPosts = (await getPosts()).filter(p => p.published);
      const cats = ['All', ...new Set(allPosts.map(p => p.category).filter(Boolean))];
      let active = 'All';
      renderFilterBar(cats);
      renderPosts(allPosts);
      function renderFilterBar(cats) {
        const bar = document.getElementById('blog-filter-bar');
        if (!bar) return;
        bar.innerHTML = cats.map(c => `<button class="blog-filter-btn${c===active?' active':''}" data-cat="${c}">${c}</button>`).join('');
        bar.querySelectorAll('.blog-filter-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            active = btn.dataset.cat;
            bar.querySelectorAll('.blog-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderPosts(active === 'All' ? allPosts : allPosts.filter(p => p.category === active));
          });
        });
      }
      function fmt(d) { return new Date(d).toLocaleDateString('en-LK',{day:'2-digit',month:'short',year:'numeric'}); }
      function renderPosts(posts) {
        const featured = posts.filter(p => p.featured).slice(0,2);
        const rest = posts.filter(p => !featured.includes(p));
        const bannerEl = document.getElementById('blog-featured');
        if (bannerEl) {
          bannerEl.style.display = featured.length ? '' : 'none';
          bannerEl.innerHTML = featured.map(p => `
            <a href="blog-post.html?slug=${p.slug}" class="blog-featured-card">
              <img src="${p.coverImage||''}" alt="${p.title}" data-err-hide loading="lazy">
              <div class="blog-featured-body">
                <div class="blog-featured-cat">${p.category||''}</div>
                <div class="blog-featured-title">${p.title}</div>
                <div class="blog-featured-meta"><i class="fa-regular fa-calendar"></i> ${fmt(p.createdAt)} &nbsp;·&nbsp; ${p.readTime||5} min read</div>
              </div>
            </a>`).join('');
        }
        const grid = document.getElementById('blog-grid');
        const empty = document.getElementById('blog-empty');
        if (!grid) return;
        if (!posts.length) { grid.innerHTML=''; if(empty) empty.style.display=''; return; }
        if (empty) empty.style.display = 'none';
        grid.innerHTML = rest.map((p,i) => `
          <article class="blog-card reveal${i>0?` delay-${Math.min(i,3)}`:''}">
            <div class="blog-card-img"><img src="${p.coverImage||'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=70'}" alt="${p.title}" loading="lazy"></div>
            <div class="blog-card-body">
              <div class="blog-card-cat">${p.category||'General'}</div>
              <h3 class="blog-card-title">${p.title}</h3>
              <p class="blog-card-excerpt">${p.excerpt||''}</p>
            </div>
            <div class="blog-card-footer">
              <span class="blog-meta"><i class="fa-regular fa-calendar"></i> ${fmt(p.createdAt)} &nbsp;·&nbsp; ${p.readTime||5} min</span>
              <a href="blog-post.html?slug=${p.slug}" style="font-size:.8125rem;color:var(--clr-gold)">Read More →</a>
            </div>
          </article>`).join('');
      }
    });
