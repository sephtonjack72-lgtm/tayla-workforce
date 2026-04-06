/* ══════════════════════════════════════════════════════
   Tayla Workforce — Core App Logic
   app.js
══════════════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://whedwekxzjfqwjuoarid.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoZWR3ZWt4empmcXdqdW9hcmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjU3MDEsImV4cCI6MjA5MDUwMTcwMX0.KaNI_pbRwWcL7jF_r4gmyP03CnFuSy5ZV2ZFrftL0QY';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let _currentUser     = null;
let _businessProfile = null;
let _businessId      = null;

// ── Loaded range tracking — prevents redundant Supabase fetches
let _shiftsLoadedRange     = null; // e.g. '2026-03-30:2026-04-05'
let _timesheetsLoadedRange = null;
let _availabilityLoaded    = false;
let _appReady              = false;

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) { _currentUser = session.user; await afterLogin(); }
  else { showAuth(); }

  _supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      _currentUser = session.user;
      await afterLogin();
    } else if (event === 'SIGNED_OUT') {
      _currentUser = null;
      _appReady = false;
      _shiftsLoadedRange = _timesheetsLoadedRange = null;
      _availabilityLoaded = false;
      showAuth();
    }
  });
});

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════

function showAuth() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('app-shell').style.display   = 'none';
}

function hideAuth() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app-shell').style.display   = 'flex';
}

async function doLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('auth-btn');
  errEl.style.display = 'none';
  if (!email || !pw) { errEl.textContent = 'Please enter email and password.'; errEl.style.display = 'block'; return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  const { error } = await _supabase.auth.signInWithPassword({ email, password: pw });
  btn.textContent = 'Sign In'; btn.disabled = false;
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; }
}

async function doSignup() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('signup-btn');
  errEl.style.display = 'none';
  if (!email || !pw) { errEl.textContent = 'Please enter email and password.'; errEl.style.display = 'block'; return; }
  if (pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  btn.textContent = 'Creating account…'; btn.disabled = true;
  const { error } = await _supabase.auth.signUp({ email, password: pw });
  btn.textContent = 'Create Account'; btn.disabled = false;
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  errEl.style.background = '#d4edda'; errEl.style.color = '#155724';
  errEl.textContent = 'Account created — check your email to confirm.';
  errEl.style.display = 'block';
}

async function signOut() {
  await _supabase.auth.signOut();
  showAuth();
}

// ══════════════════════════════════════════════════════
//  AFTER LOGIN — one fetch, then render everything
// ══════════════════════════════════════════════════════

async function afterLogin() {
  const { data } = await _supabase
    .from('businesses').select('*')
    .eq('user_id', _currentUser.id)
    .maybeSingle();

  if (data) {
    _businessProfile = data;
    _businessId      = data.id;
    await applyProfile(data);
    hideAuth();
  } else {
    showBusinessSetup();
  }
}

async function applyProfile(profile) {
  _businessId = profile.id;

  const nameEl = document.getElementById('header-biz-name');
  if (nameEl) nameEl.textContent = profile.biz_name || 'My Business';
  const userEl = document.getElementById('header-user');
  if (userEl) userEl.textContent = _currentUser?.email?.split('@')[0] || 'Account';

  const today     = localDateStr(new Date());
  const weekStart = getWeekStart(today);
  const weekEnd   = getWeekDates(weekStart)[6];
  const rangeKey  = `${weekStart}:${weekEnd}`;

  // Single parallel fetch on login — never repeated on tab switch
  await Promise.all([
    dbLoadEmployees(),
    _dbLoadShiftsRaw(weekStart, weekEnd),
    _dbLoadTimesheetsRaw(weekStart, weekEnd),
    dbLoadAvailability(),
  ]);

  _shiftsLoadedRange     = rangeKey;
  _timesheetsLoadedRange = rangeKey;
  _availabilityLoaded    = true;
  _appReady              = true;

  renderDashboard();
  renderEmployees();
  if (typeof renderRosterFromMemory === 'function') renderRosterFromMemory();
  renderSales();
  if (typeof renderTimesheetsFromMemory === 'function') renderTimesheetsFromMemory();
  if (typeof initAwardPage === 'function') initAwardPage();
}

// ── Business setup
function showBusinessSetup() {
  document.getElementById('setup-overlay').style.display = 'flex';
  document.getElementById('auth-overlay').style.display  = 'none';
  document.getElementById('app-shell').style.display     = 'none';
}

async function saveBusinessSetup() {
  const name      = document.getElementById('setup-biz-name').value.trim();
  const abn       = document.getElementById('setup-abn').value.trim();
  const awardType = document.getElementById('setup-award').value;
  if (!name) { toast('Business name is required'); return; }
  const { data, error } = await _supabase.from('businesses').insert({
    user_id: _currentUser.id, biz_name: name, abn, award_type: awardType,
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) { toast('Error: ' + error.message); return; }
  _businessProfile = data;
  _businessId      = data.id;
  document.getElementById('setup-overlay').style.display = 'none';
  hideAuth();
  await applyProfile(data);
  toast('Welcome to Tayla Workforce! 🎉');
}

// ══════════════════════════════════════════════════════
//  SMART DATA LOADERS
//  Raw loaders update in-memory arrays.
//  Smart loaders skip fetch if range already loaded.
// ══════════════════════════════════════════════════════

async function _dbLoadShiftsRaw(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('shifts').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart).lte('date', weekEnd);
  if (error) { console.error('Load shifts failed:', error); return; }
  const other = shifts.filter(s => s.date < weekStart || s.date > weekEnd);
  shifts = [...other, ...(data || [])];
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
}

async function _dbLoadTimesheetsRaw(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('timesheets').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart).lte('date', weekEnd);
  if (error) { console.error('Load timesheets failed:', error); return; }
  const other = timesheets.filter(t => t.date < weekStart || t.date > weekEnd);
  timesheets = [...other, ...(data || [])];
  localStorage.setItem('wf_timesheets', JSON.stringify(timesheets));
}

// Call these from roster.js / timesheets.js when navigating weeks
async function ensureShiftsLoaded(weekStart, weekEnd) {
  const key = `${weekStart}:${weekEnd}`;
  if (_shiftsLoadedRange === key) return; // already in memory — skip fetch
  await _dbLoadShiftsRaw(weekStart, weekEnd);
  _shiftsLoadedRange = key;
}

async function ensureTimesheetsLoaded(weekStart, weekEnd) {
  const key = `${weekStart}:${weekEnd}`;
  if (_timesheetsLoadedRange === key) return;
  await _dbLoadTimesheetsRaw(weekStart, weekEnd);
  _timesheetsLoadedRange = key;
}

// Call after saves to mark the range as current (data already in memory)
function markShiftsLoaded(weekStart, weekEnd) {
  _shiftsLoadedRange = `${weekStart}:${weekEnd}`;
}

function markTimesheetsLoaded(weekStart, weekEnd) {
  _timesheetsLoadedRange = `${weekStart}:${weekEnd}`;
}

// ══════════════════════════════════════════════════════
//  NAVIGATION — instant, from memory only
// ══════════════════════════════════════════════════════

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.querySelector(`[data-page="${id}"]`)?.classList.add('active');

  if (id === 'dashboard')  renderDashboard();
  if (id === 'employees')  renderEmployees();
  if (id === 'roster'     && typeof renderRosterFromMemory    === 'function') renderRosterFromMemory();
  if (id === 'sales')      renderSales();
  if (id === 'timesheets' && typeof renderTimesheetsFromMemory === 'function') renderTimesheetsFromMemory();
  if (id === 'awards'     && typeof initAwardPage              === 'function') initAwardPage();
}

// ══════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════

function renderDashboard() {
  if (!_appReady) return;
  const today     = localDateStr(new Date());
  const weekDates = getWeekDates(getWeekStart(today));

  const totalActive = employees.filter(e => e.active !== false).length;
  const todayShifts = shifts.filter(s => s.date === today && s.status !== 'cancelled');
  const weekShifts  = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');

  let weekCost = 0;
  employees.forEach(emp => {
    weekCost += calcWeeklyPay(weekShifts.filter(s => s.employee_id === emp.id), emp).totalPay;
  });

  const pendingTs = timesheets.filter(t => t.status === 'pending').length;

  document.getElementById('dash-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Active Employees</div><div class="kpi-value">${totalActive}</div></div>
    <div class="kpi"><div class="kpi-label">Shifts Today</div><div class="kpi-value">${todayShifts.length}</div></div>
    <div class="kpi"><div class="kpi-label">This Week Labour</div><div class="kpi-value negative">${fmt(weekCost)}</div></div>
    <div class="kpi"><div class="kpi-label">Pending Timesheets</div><div class="kpi-value ${pendingTs > 0 ? 'warning' : ''}">${pendingTs}</div></div>
  `;

  const todayEl = document.getElementById('dash-today');
  if (todayEl) {
    if (!todayShifts.length) {
      todayEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No shifts rostered today.</div>';
    } else {
      todayEl.innerHTML = todayShifts.map(s => {
        const emp      = employees.find(e => e.id === s.employee_id);
        const initials = emp ? ((emp.first_name?.[0]||'')+(emp.last_name?.[0]||'')).toUpperCase() : '?';
        const name     = emp ? `${emp.first_name} ${emp.last_name}` : 'Unassigned';
        const pay      = emp ? calcShiftPay(s, emp) : null;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="avatar" style="${!emp?'background:var(--surface2);color:var(--text3);border:2px dashed var(--border);':''}">${initials}</div>
              <div>
                <div style="font-weight:500;${!emp?'color:var(--text3);':''}">${name}</div>
                <div style="font-size:12px;color:var(--text3);">${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}${pay?` · ${pay.billableHours}h`:''}</div>
              </div>
            </div>
            <div class="mono" style="font-weight:600;">${pay?fmt(pay.totalPay):'—'}</div>
          </div>`;
      }).join('');
    }
  }

  const phEl = document.getElementById('dash-public-holidays');
  if (phEl) {
    const upcoming = ALL_PUBLIC_HOLIDAYS.filter(d => d >= today).slice(0, 3);
    phEl.innerHTML = upcoming.length
      ? upcoming.map(d => `
          <div style="display:flex;justify-content:space-between;padding:8px 20px;border-bottom:1px solid var(--border);font-size:13px;">
            <span>${parseLocalDate(d).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})}</span>
            <span class="badge badge-red">250%</span>
          </div>`).join('')
      : '<div style="padding:16px 20px;color:var(--text3);font-size:13px;">No upcoming public holidays.</div>';
  }
}

function goToSalesProjection(date) {
  showPage('sales');
  if (typeof _salesWeekStart !== 'undefined') _salesWeekStart = getWeekStart(date);
  if (typeof renderSales === 'function') renderSales();
  setTimeout(() => { if (typeof switchSalesDay === 'function') switchSalesDay(date); }, 80);
}

// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════

function toggleUserMenu() {
  const d = document.getElementById('user-dropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  const drop = document.getElementById('user-dropdown');
  if (wrap && drop && !wrap.contains(e.target)) drop.style.display = 'none';
});
