/* ============================================================
   ZENMARKET — BLOG DATA  (pure data module — no admin side effects)
   Safe to import from both storefront pages AND admin pages.
   ============================================================ */

export const BLOG_KEY = 'zm_blog_posts';

// ── Default seed posts ────────────────────────────────────────
export const DEFAULT_POSTS = [
  {
    id: 'post-001',
    title: 'The Ultimate Guide to Ceylon Spices',
    slug: 'guide-to-ceylon-spices',
    category: 'Food & Culture',
    excerpt: 'Discover the rich heritage of Sri Lankan spices and how to use them in your cooking.',
    content: `<p>Sri Lanka, the ancient island of Ceylon, has been renowned for its extraordinary spices for over two thousand years.</p><h2>True Cinnamon</h2><p>Ceylon cinnamon (Cinnamomum verum) is the "true" cinnamon, distinct from the more common cassia variety found in supermarkets worldwide.</p><h2>Black Pepper</h2><p>Known as the "King of Spices," Sri Lankan black pepper is prized for its bold, complex heat.</p><h2>Cardamom</h2><p>The misty highlands of Nuwara Eliya provide perfect conditions for cardamom cultivation.</p>`,
    coverImage: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&q=80',
    author: 'Manarize Team',
    published: true,
    featured: true,
    readTime: 5,
    tags: ['spices', 'ceylon', 'food'],
    seoTitle: '',
    seoDesc: '',
    createdAt: '2024-03-10T08:00:00.000Z',
    updatedAt: '2024-03-10T08:00:00.000Z',
  },
  {
    id: 'post-002',
    title: 'Traditional Batik: A Living Art Form',
    slug: 'traditional-batik-sri-lanka',
    category: 'Fashion',
    excerpt: 'How Sri Lankan artisans keep the ancient art of batik alive in modern fashion.',
    content: `<p>Batik is one of Sri Lanka's most treasured textile traditions, with roots stretching back centuries to the influences of the Dutch, Portuguese, and indigenous Sinhalese artisans.</p><h2>The Art of Wax-Resist Dyeing</h2><p>Traditional batik uses hot wax applied to fabric before dyeing, creating intricate patterns by preventing dye from penetrating the waxed areas.</p><h2>Modern Batik Fashion</h2><p>Today's Sri Lankan designers are bringing batik into contemporary fashion, blending traditional motifs with modern silhouettes.</p>`,
    coverImage: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80',
    author: 'Manarize Team',
    published: true,
    featured: false,
    readTime: 4,
    tags: ['fashion', 'batik', 'culture'],
    seoTitle: '',
    seoDesc: '',
    createdAt: '2024-03-05T08:00:00.000Z',
    updatedAt: '2024-03-05T08:00:00.000Z',
  },
  {
    id: 'post-003',
    title: 'Ceylon Tea: From Garden to Cup',
    slug: 'ceylon-tea-garden-to-cup',
    category: 'Lifestyle',
    excerpt: 'A journey through the highlands of Nuwara Eliya and the world-famous Ceylon tea industry.',
    content: `<p>Ceylon tea is considered among the finest in the world, grown in the misty highlands of Sri Lanka at elevations between 600 and 2,200 metres above sea level.</p><h2>The Tea Regions</h2><p>Sri Lanka's tea country is divided into three elevation zones: high-grown (above 1,200m), mid-grown (600–1,200m), and low-grown (below 600m), each producing teas with distinct character.</p><h2>How to Brew the Perfect Cup</h2><p>Use freshly boiled water at 90–95°C, steep for 3–4 minutes, and enjoy with or without milk.</p>`,
    coverImage: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=800&q=80',
    author: 'Manarize Team',
    published: true,
    featured: false,
    readTime: 6,
    tags: ['tea', 'ceylon', 'lifestyle'],
    seoTitle: '',
    seoDesc: '',
    createdAt: '2024-02-28T08:00:00.000Z',
    updatedAt: '2024-02-28T08:00:00.000Z',
  },
];

// ── CRUD helpers ──────────────────────────────────────────────
// ── Supabase-backed CRUD (async) ──────────────────────────────
// Falls back to localStorage / DEFAULT_POSTS in demo mode.

async function _getStore() {
  const { DEMO_MODE } = await import('./config.js');
  if (DEMO_MODE) return null;
  return import('./supabase-store.js');
}

export async function getPosts({ adminMode = false } = {}) {
  try {
    const store = await _getStore();
    if (store) return store.getBlogPosts({ adminMode });
    // Demo fallback
    const raw = localStorage.getItem(BLOG_KEY);
    if (raw === null) return JSON.parse(JSON.stringify(DEFAULT_POSTS));
    const saved = JSON.parse(raw);
    return Array.isArray(saved) ? saved : JSON.parse(JSON.stringify(DEFAULT_POSTS));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_POSTS));
  }
}

export async function savePosts(posts) {
  const store = await _getStore();
  if (store) { await store.savePosts(posts); return; }
  localStorage.setItem(BLOG_KEY, JSON.stringify(posts));
}

export async function savePost(post) {
  const store = await _getStore();
  if (store) { await store.saveBlogPost(post); return; }
  const posts = await getPosts({ adminMode: true });
  const idx   = posts.findIndex(p => p.id === post.id);
  if (idx >= 0) posts[idx] = post; else posts.unshift(post);
  localStorage.setItem(BLOG_KEY, JSON.stringify(posts));
}

export async function deletePost(id) {
  const store = await _getStore();
  if (store) { await store.deleteBlogPost(id); return; }
  const posts = (await getPosts({ adminMode: true })).filter(p => p.id !== id);
  localStorage.setItem(BLOG_KEY, JSON.stringify(posts));
}

export function generatePostId() {
  return `post-${Date.now()}`;
}

export function generatePostSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
