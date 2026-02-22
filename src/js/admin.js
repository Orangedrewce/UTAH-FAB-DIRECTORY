/* ═══════════════════════════════════════════════════════════════════════
   ADMIN DASHBOARD  — admin.js
   Supabase-backed CRUD for the Utah Fab Directory
   ═══════════════════════════════════════════════════════════════════════ */

// ── Supabase config ─────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://dntcmvspcwwdwnmyqfiw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGNtdnNwY3d3ZHdubXlxZml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDA5MDksImV4cCI6MjA4NzI3NjkwOX0.cgiLMn6YH0BnLshl_458nGwdjnAJaN3MZz8jT4lwfkc';

if (typeof window.supabase === 'undefined') {
  document.body.innerHTML = '<p style="color:#d63031;text-align:center;margin-top:4rem;">Supabase SDK failed to load. Check your network or script order.</p>';
  throw new Error('Supabase SDK not available');
}

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── All known tags (matches the existing tag vocabulary in shops.json) ──
const ALL_TAGS = [
  '3dprint','aerospace','cnc','heattreat','laser','makerspace',
  'offroad','ornamental','powder','waterjet','welding','plasma',
  'anodize','plating','assembly','prototype','structural','sheetmetal'
];

// ── Canonical categories (single source of truth for datalist + validation) ──
const CATEGORIES = [
  'Fabrication & Machining',
  'Welding & Metalwork',
  'Specialty Automotive',
  'Specialty Automotive & Off-Road',
  'Industrial Finishing: Anodizing, Plating & Heat Treating',
  'Powder Coating & Finishing',
  'Digital Fabrication & Community Spaces',
  'Statewide / Multi-Region Fabrication',
  'Rural Hubs: Moab / Rock Crawling',
  'Rural Hubs: Uinta Basin / Carbon County / Central Utah',
  'Specialty',
  'Finishing & Community',
];

// ── Canonical regions (loaded from DB, fallback hardcoded) ─────────────
let REGIONS = [];

// ── State ───────────────────────────────────────────────────────────────
let allShops  = [];   // full dataset from fab_shops
let filtered  = [];   // after search/filter applied
let _dashboardLoading = false;  // guard against double init

// ── DOM refs ────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const authGate      = $('#authGate');
const adminDash     = $('#adminDash');
const loginForm     = $('#loginForm');
const authError     = $('#authError');
const adminEmailEl  = $('#adminEmail');
const logoutBtn     = $('#logoutBtn');

const adminSearch      = $('#adminSearch');
const adminRegionFilt  = $('#adminRegionFilter');
const adminTagFilt     = $('#adminTagFilter');
const showInactive     = $('#showInactive');
const adminCountEl     = $('#adminCount');
const addShopBtn       = $('#addShopBtn');
const shopTableBody    = $('#shopTableBody');
const tableEmpty       = $('#tableEmpty');

// Modal
const modalBackdrop = $('#modalBackdrop');
const modalTitle    = $('#modalTitle');
const shopForm      = $('#shopForm');
const modalCloseBtn = $('#modalCloseBtn');
const modalCancelBtn= $('#modalCancelBtn');
const deleteBtn     = $('#deleteBtn');
const saveBtn       = $('#saveBtn');
const tagPicker     = $('#tagPicker');

// Form fields
const fId        = $('#fId');
const fName      = $('#fName');
const fCity      = $('#fCity');
const fRegion    = $('#fRegion');
const fCategory  = $('#fCategory');
const fSize      = $('#fSize');
const fServices  = $('#fServices');
const fWebsite   = $('#fWebsite');
const fMapsUrl   = $('#fMapsUrl');
const fIsActive  = $('#fIsActive');


/* ═══════════════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════════════ */

async function checkSession() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    showDashboard(session.user);
  } else {
    authGate.classList.remove('hidden');
    adminDash.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const email = $('#authEmail').value.trim();
  const pass  = $('#authPassword').value;
  const { data, error } = await _supabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    authError.textContent = error.message;
    return;
  }
  showDashboard(data.user);
});

logoutBtn.addEventListener('click', async () => {
  await _supabase.auth.signOut();
  allShops = [];
  shopTableBody.innerHTML = '';
  authGate.classList.remove('hidden');
  adminDash.classList.add('hidden');
});

async function showDashboard(user) {
  // Guard against concurrent calls from onAuthStateChange + checkSession
  if (_dashboardLoading) return;
  _dashboardLoading = true;

  authGate.classList.add('hidden');
  adminDash.classList.remove('hidden');
  adminEmailEl.textContent = user.email;
  populateCategoryList();
  await loadRegions();
  await loadShops();
  // Measure real header/toolbar heights now that dashboard is visible
  syncLayoutHeights();

  _dashboardLoading = false;
}

/** Populate the category datalist from the JS-defined CATEGORIES array */
function populateCategoryList() {
  const dl = document.getElementById('categoryList');
  if (!dl) return;
  dl.innerHTML = CATEGORIES.map(c => `<option value="${esc(c)}">`).join('');
}


/* ═══════════════════════════════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════════════════════════════ */

async function loadRegions() {
  const { data, error } = await _supabase
    .from('regions')
    .select('*')
    .order('sort_order');

  if (!error && data && data.length > 0) {
    REGIONS = data;
  } else {
    // Fallback
    REGIONS = [
      { slug: 'salt-lake',     title: 'Salt Lake Valley' },
      { slug: 'utah-county',   title: 'Utah County' },
      { slug: 'weber-ogden',   title: 'Weber / Ogden Area' },
      { slug: 'cache-valley',  title: 'Cache Valley' },
      { slug: 'southern-utah', title: 'St. George / Southern Utah' },
      { slug: 'other',         title: 'Other: Statewide, Rural & Specialty' },
    ];
  }

  // Populate toolbar region filter (build string, assign once)
  let regionFilterHtml = '<option value="">All Regions</option>';
  REGIONS.forEach(r => {
    const label = r.title || r.name || r.slug;
    regionFilterHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  adminRegionFilt.innerHTML = regionFilterHtml;

  // Populate modal region select (build string, assign once)
  let regionSelectHtml = '';
  REGIONS.forEach(r => {
    const label = r.title || r.name || r.slug;
    regionSelectHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  fRegion.innerHTML = regionSelectHtml;
}

async function loadShops() {
  // Authenticated users can see all shops (including inactive) via RLS
  const { data, error } = await _supabase
    .from('fab_shops')
    .select('*')
    .order('region')
    .order('sort_order')
    .order('name');

  if (error) {
    console.error('Failed to load shops:', error);
    allShops = [];
  } else {
    allShops = data || [];
  }

  // Populate tag filter dropdown with tags that exist in data (build string, assign once)
  const usedTags = new Set();
  allShops.forEach(s => (s.tags || []).forEach(t => usedTags.add(t)));
  const sortedTags = [...usedTags].sort();
  let tagFilterHtml = '<option value="">All Tags</option>';
  sortedTags.forEach(t => {
    tagFilterHtml += `<option value="${esc(t)}">${esc(t)}</option>`;
  });
  adminTagFilt.innerHTML = tagFilterHtml;

  applyFilters();
}


/* ═══════════════════════════════════════════════════════════════════════
   FILTERING
═══════════════════════════════════════════════════════════════════════ */

function applyFilters() {
  const q      = adminSearch.value.trim().toLowerCase();
  const region = adminRegionFilt.value;
  const tag    = adminTagFilt.value;
  const incInactive = showInactive.checked;

  filtered = allShops.filter(s => {
    if (!incInactive && !s.is_active) return false;
    if (region && s.region !== region) return false;
    if (tag && !(s.tags || []).includes(tag)) return false;
    if (q) {
      const haystack = [s.name || '', s.city || '', s.category || '', s.services || '', ...(s.tags||[])].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  renderTable();
}

adminSearch.addEventListener('input', applyFilters);
adminRegionFilt.addEventListener('change', applyFilters);
adminTagFilt.addEventListener('change', applyFilters);
showInactive.addEventListener('change', applyFilters);


/* ═══════════════════════════════════════════════════════════════════════
   TABLE RENDERING
═══════════════════════════════════════════════════════════════════════ */

function renderTable() {
  adminCountEl.textContent = filtered.length;
  if (filtered.length === 0) {
    shopTableBody.innerHTML = '';
    tableEmpty.classList.remove('hidden');
    return;
  }
  tableEmpty.classList.add('hidden');

  shopTableBody.innerHTML = filtered.map(s => {
    const regionLabel = (REGIONS.find(r => r.slug === s.region) || {}).title || s.region;
    const tagHtml = (s.tags || []).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('');
    const activeClass = s.is_active ? '' : ' inactive';

    return `<tr class="${activeClass}" data-id="${s.id}">
      <td class="col-status"><span class="status-dot${s.is_active ? '' : ' off'}"></span></td>
      <td class="col-name">${esc(s.name)}</td>
      <td class="col-city">${esc(s.city)}</td>
      <td class="col-region">${esc(regionLabel)}</td>
      <td class="col-category">${esc(s.category)}</td>
      <td class="col-tags">${tagHtml}</td>
      <td class="col-actions">
        <button class="btn btn-outline btn-sm edit-btn" data-id="${s.id}">Edit</button>
      </td>
    </tr>`;
  }).join('');

  // Event delegation — single listener on parent instead of per-button
}

// Delegate edit-button clicks on the table body (attached once, survives re-renders)
shopTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.edit-btn');
  if (btn) openEditModal(btn.dataset.id);
});

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}


/* ═══════════════════════════════════════════════════════════════════════
   MODAL  — Add / Edit
═══════════════════════════════════════════════════════════════════════ */

function buildTagPicker(selectedTags = []) {
  tagPicker.innerHTML = ALL_TAGS.map(t => {
    const sel = selectedTags.includes(t) ? ' selected' : '';
    return `<span class="tag-chip${sel}" data-tag="${t}">${t}</span>`;
  }).join('');

  tagPicker.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });
}

function getSelectedTags() {
  return [...tagPicker.querySelectorAll('.tag-chip.selected')].map(c => c.dataset.tag);
}

addShopBtn.addEventListener('click', () => openAddModal());

function openAddModal() {
  modalTitle.textContent = 'Add Shop';
  deleteBtn.classList.add('hidden');
  fId.value = '';
  fName.value = '';
  fCity.value = '';
  fRegion.value = REGIONS.length ? REGIONS[0].slug : '';
  fCategory.value = 'Fabrication & Machining';
  fSize.value = '';
  fServices.value = '';
  fWebsite.value = '';
  fMapsUrl.value = '';
  fIsActive.checked = true;
  buildTagPicker([]);
  openModal();
}

function openEditModal(id) {
  const shop = allShops.find(s => String(s.id) === String(id));
  if (!shop) return;

  modalTitle.textContent = 'Edit Shop';
  deleteBtn.classList.remove('hidden');
  fId.value         = shop.id;
  fName.value       = shop.name || '';
  fCity.value       = shop.city || '';
  fRegion.value     = shop.region || '';
  fCategory.value   = shop.category || '';
  fSize.value       = shop.size_desc || '';
  fServices.value   = shop.services || '';
  fWebsite.value    = shop.website || '';
  fMapsUrl.value     = shop.maps_url || '';
  fIsActive.checked  = shop.is_active !== false;
  buildTagPicker(shop.tags || []);
  openModal();
}

function openModal() {
  modalBackdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal() {
  modalBackdrop.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

modalCloseBtn.addEventListener('click', closeModal);
modalCancelBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeModal();
});


/* ═══════════════════════════════════════════════════════════════════════
   SAVE  (INSERT or UPDATE)
═══════════════════════════════════════════════════════════════════════ */

shopForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Validate maps_url if provided
  const mapsUrlRaw = fMapsUrl.value.trim();
  if (mapsUrlRaw) {
    try {
      const mapsUrlObj = new URL(mapsUrlRaw);
      if (!['http:', 'https:'].includes(mapsUrlObj.protocol)) {
        alert('Maps URL must start with http:// or https://');
        return;
      }
    } catch {
      alert('Maps URL is not a valid URL.');
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const payload = {
    name:         fName.value.trim(),
    city:         fCity.value.trim(),
    region:       fRegion.value,
    category:     fCategory.value.trim(),
    size_desc:    fSize.value.trim(),
    services:     fServices.value.trim(),
    website:      fWebsite.value.trim(),
    maps_url:     mapsUrlRaw,
    tags:         getSelectedTags(),
    is_active:    fIsActive.checked,
  };

  let error;
  const editId = fId.value;

  if (editId) {
    // UPDATE
    ({ error } = await _supabase.from('fab_shops').update(payload).eq('id', editId));
  } else {
    // INSERT
    ({ error } = await _supabase.from('fab_shops').insert([payload]));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Shop';

  if (error) {
    alert('Save failed: ' + error.message);
    return;
  }

  closeModal();
  await loadShops();
});


/* ═══════════════════════════════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════════════════════════════ */

deleteBtn.addEventListener('click', async () => {
  const editId = fId.value;
  if (!editId) return;
  if (!confirm('Delete this shop permanently?')) return;

  const DELETE_LABEL = 'Delete';

  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting…';

  const { error } = await _supabase.from('fab_shops').delete().eq('id', editId);

  deleteBtn.disabled = false;
  deleteBtn.textContent = DELETE_LABEL;

  if (error) {
    alert('Delete failed: ' + error.message);
    return;
  }

  closeModal();
  await loadShops();
});


/* ═══════════════════════════════════════════════════════════════════════
   INIT — Reactive auth + layout measurement
═════════════════════════════════════════════════════════════════════ */

/** Measure real header height and set toolbar top + table-scroll max-height dynamically */
function syncLayoutHeights() {
  const header = document.querySelector('.admin-header');
  const toolbar = document.querySelector('.toolbar');
  const tableScroll = document.querySelector('.table-scroll');
  if (!header || !toolbar) return;

  const headerH = header.offsetHeight;
  const toolbarH = toolbar.offsetHeight;
  toolbar.style.top = headerH + 'px';
  if (tableScroll) {
    tableScroll.style.maxHeight = `calc(100vh - ${headerH + toolbarH}px)`;
    tableScroll.style.maxHeight = `calc(100dvh - ${headerH + toolbarH}px)`;
  }
}

// Listen for auth state changes reactively
_supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    allShops = [];
    shopTableBody.innerHTML = '';
    authGate.classList.remove('hidden');
    adminDash.classList.add('hidden');
    _dashboardLoading = false;
  } else if (session) {
    showDashboard(session.user);
  }
});

// Also check on load (handles page refresh with existing session)
checkSession();

// Sync layout heights after dashboard renders and on resize
window.addEventListener('resize', syncLayoutHeights);
