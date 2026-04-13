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
let _userRole        = null; // 'owner' | 'franchise' | 'manager' | 'payroll_officer'
let _ownerBusinessId = null; // owner's root business
let _franchises      = [];   // child franchise businesses
let _payFrequency    = 'weekly'; // 'weekly' | 'fortnightly' | 'monthly'

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

  // Check for team invite token — show simplified join UI
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('team_invite');
  if (token) {
    showInviteAuthMode(token);
  }
}

async function showInviteAuthMode(token) {
  // Look up the invite to get the business name and pre-fill email
  const { data: invite } = await _supabase
    .from('business_users')
    .select('email, business_id, businesses!business_id(biz_name)')
    .eq('invite_token', token)
    .eq('status', 'pending')
    .maybeSingle();

  document.getElementById('auth-normal-mode').style.display = 'none';
  document.getElementById('auth-invite-mode').style.display = 'block';

  if (invite) {
    const bizName = invite.businesses?.biz_name || 'your team';
    document.getElementById('auth-invite-biz').textContent  = bizName;
    document.getElementById('auth-invite-sub').textContent  = "You've been invited to join";
    if (invite.email) document.getElementById('auth-invite-email').value = invite.email;
  } else {
    document.getElementById('auth-invite-biz').textContent = 'your team';
  }
}

async function doInviteSignup() {
  const email  = document.getElementById('auth-invite-email').value.trim();
  const pw     = document.getElementById('auth-invite-pw').value;
  const errEl  = document.getElementById('auth-invite-error');
  errEl.style.display = 'none';

  if (!email || !pw) { errEl.textContent = 'Please enter your email and a password.'; errEl.style.display = 'block'; return; }
  if (pw.length < 6)  { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }

  const { error: signUpErr } = await _supabase.auth.signUp({ email, password: pw });

  if (signUpErr) {
    if (signUpErr.status === 422 || signUpErr.message.includes('already registered')) {
      // Try signing in with same password
      const { error: signInErr } = await _supabase.auth.signInWithPassword({ email, password: pw });
      if (signInErr) {
        errEl.textContent = 'This email already has an account. Click "Already have an account? Sign In" and enter your existing password.';
        errEl.style.display = 'block';
      }
    } else {
      errEl.textContent = signUpErr.message;
      errEl.style.display = 'block';
    }
    return;
  }
  // onAuthStateChange fires → afterLogin → accepts token → loads app
}

function switchToSignIn() {
  const email = document.getElementById('auth-invite-email')?.value;
  document.getElementById('auth-invite-mode').style.display = 'none';
  document.getElementById('auth-normal-mode').style.display = 'block';
  if (email) document.getElementById('auth-email').value = email;
  document.getElementById('auth-password').focus();
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
  // Check for team invite token first — before anything else
  const params = new URLSearchParams(window.location.search);
  const teamToken = params.get('team_invite');

  // First check if they own a business — get the root business (no parent)
  const { data: ownedBizList } = await _supabase
    .from('businesses').select('*')
    .eq('user_id', _currentUser.id)
    .is('parent_business_id', null);

  const ownedBiz = ownedBizList?.[0] || null;

  if (ownedBiz) {
    _businessProfile = ownedBiz;
    _businessId      = ownedBiz.id;
    _ownerBusinessId = ownedBiz.id;
    _userRole        = 'owner';

    // Load all franchises owned by this user
    const { data: franchiseData } = await _supabase
      .from('businesses')
      .select('*')
      .eq('parent_business_id', ownedBiz.id)
      .order('biz_name');
    _franchises = franchiseData || [];

    await applyProfile(ownedBiz);
    hideAuth();
    return;
  }

  // Check if they're already an active team member
  const { data: membership } = await _supabase
    .from('business_users')
    .select('*')
    .eq('user_id', _currentUser.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membership) {
    // Fetch the business separately
    const { data: bizData } = await _supabase
      .from('businesses')
      .select('*')
      .eq('id', membership.business_id)
      .maybeSingle();

    if (!bizData) { toast('Could not load business data'); return; }

    _businessProfile = bizData;
    _businessId      = membership.business_id;
    _userRole        = membership.role;
    await applyProfile(bizData);
    hideAuth();
    return;
  }

  // If there's a team invite token, try to accept it
  if (teamToken) {
    const accepted = await acceptTeamInviteToken(teamToken);
    if (accepted) return;
    // Token failed — show friendly message instead of business setup
    showInviteErrorScreen();
    return;
  }

  // New user with no business and no invite — show business setup
  showBusinessSetup();
}

function showInviteErrorScreen() {
  document.getElementById('auth-overlay').style.display  = 'none';
  document.getElementById('setup-overlay').style.display = 'none';
  document.getElementById('app-shell').style.display     = 'none';
  // Show a simple message
  let el = document.getElementById('invite-error-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'invite-error-screen';
    el.style.cssText = 'position:fixed;inset:0;background:#0f1623;display:flex;align-items:center;justify-content:center;';
    el.innerHTML = `
      <div style="background:#1e2235;border-radius:16px;padding:40px 36px;max-width:420px;text-align:center;color:#fff;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px;">Invite Link Issue</div>
        <div style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:24px;">
          This invite link has expired or already been used. Ask your employer to send a new invite link.
        </div>
        <button onclick="window.location.href=window.location.pathname"
          style="background:#d4a017;color:#111;border:none;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">
          Back to Sign In
        </button>
      </div>`;
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

async function applyProfile(profile) {
  _businessId      = profile.id;
  _payFrequency    = profile.pay_frequency || 'weekly';

  // Set linked Business account ID for sales mirroring
  if (typeof _linkedBusinessId !== 'undefined') {
    _linkedBusinessId = profile.linked_business_id || null;
  }

  const nameEl = document.getElementById('header-biz-name');
  if (nameEl) nameEl.textContent = profile.biz_name || 'My Business';

  // Render franchise switcher for owners with franchises
  renderFranchiseSwitcher();

  const userName = _currentUser?.user_metadata?.name || _currentUser?.email?.split('@')[0] || 'Account';
  const userEl   = document.getElementById('header-user');
  if (userEl) userEl.textContent = userName;

  // Avatar initials
  const avatarEl = document.getElementById('header-avatar');
  if (avatarEl) avatarEl.textContent = userName[0]?.toUpperCase() || '?';

  // Dropdown info
  const ddName  = document.getElementById('dd-user-name');
  const ddEmail = document.getElementById('dd-user-email');
  const ddRole  = document.getElementById('dd-role-badge');
  if (ddName)  ddName.textContent  = userName;
  if (ddEmail) ddEmail.textContent = _currentUser?.email || '';
  if (ddRole)  ddRole.innerHTML    = `<span class="role-badge role-${_userRole}">${roleName(_userRole)}</span>`;

  // Apply role gating
  applyRoleGating();

  // Initialise custom award from business profile so dashboard can use it immediately
  if (typeof DEFAULT_CUSTOM_AWARD !== 'undefined') {
    _customAward = profile.custom_award
      ? JSON.parse(JSON.stringify(profile.custom_award))
      : JSON.parse(JSON.stringify(DEFAULT_CUSTOM_AWARD));
  }

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

  // Handle team invite token if present in URL
  handleTeamInviteToken();

  // Show billing banner if needed
  showBillingBanner();

  // Populate leave employee select
  populateLeaveEmployeeSelect();

  // Handle billing redirect params
  const billingParam = new URLSearchParams(window.location.search).get('billing');
  if (billingParam === 'success') {
    toast('🎉 Subscription activated! Welcome to Tayla Workforce.');
    window.history.replaceState({}, '', window.location.pathname);
    // Reload business profile to get updated subscription status
    const { data } = await _supabase.from('businesses').select('*').eq('id', _businessId).maybeSingle();
    if (data) { _businessProfile = data; }
  }
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
  if (id === 'leave'      && typeof initLeavePage              === 'function') initLeavePage();
}

// ══════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════

function renderDashboard() {
  if (!_appReady) return;
  const today     = localDateStr(new Date());

  // Render franchise analytics for owners
  renderFranchiseAnalytics();
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
  const phRateEl = document.getElementById('dash-ph-rate');
  if (phEl) {
    // Get PH multiplier from custom award if active, otherwise MA000003 default (2.5)
    // Get PH multiplier — respect active award type
    const isCustomActive = _businessProfile?.award_type === 'custom';
    const phMultiplier = (isCustomActive && typeof _customAward !== 'undefined' && _customAward?.permanent?.publicHoliday)
      ? _customAward.permanent.publicHoliday
      : 2.5;
    const phPct  = Math.round(phMultiplier * 100) + '%';
    const awardName = (isCustomActive && typeof _customAward !== 'undefined' && _customAward?.name)
      ? _customAward.name
      : 'MA000003';
    if (phRateEl) phRateEl.textContent = `${awardName} · ${phPct} rate`;

    const upcoming = ALL_PUBLIC_HOLIDAYS.filter(d => d >= today).slice(0, 3);
    phEl.innerHTML = upcoming.length
      ? upcoming.map(d => `
          <div style="display:flex;justify-content:space-between;padding:8px 20px;border-bottom:1px solid var(--border);font-size:13px;">
            <span>${parseLocalDate(d).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})}</span>
            <span class="badge badge-red">${phPct}</span>
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

function openModal(id) {
  document.getElementById(id)?.classList.add('show');
}

function toggleUserMenu() {
  const d = document.getElementById('user-dropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  const drop = document.getElementById('user-dropdown');
  if (wrap && drop && !wrap.contains(e.target)) drop.style.display = 'none';
});

// ══════════════════════════════════════════════════════
//  ROLE HELPERS
// ══════════════════════════════════════════════════════

function roleName(role) {
  return { owner: 'Owner', franchise: 'Franchise', manager: 'Manager', payroll_officer: 'Payroll Officer' }[role] || role;
}

function canAccess(feature) {
  const r = _userRole;
  const rules = {
    dashboard:   ['owner','franchise','manager','payroll_officer'],
    employees:   ['owner','franchise','manager','payroll_officer'],
    roster:      ['owner','franchise','manager','payroll_officer'],
    sales:       ['owner','franchise','manager'],
    timesheets:  ['owner','franchise','manager','payroll_officer'],
    awards:      ['owner','franchise','manager','payroll_officer'],
    push_payslip:['owner','franchise','payroll_officer'],
    approve_ts:  ['owner','franchise','manager'],
    team:        ['owner','franchise'],
    business:    ['owner','franchise'],
    // Edit restrictions
    roster_edit: ['owner','franchise','manager'],
    ts_edit:     ['owner','franchise','manager'],
  };
  return (rules[feature] || []).includes(r);
}

function applyRoleGating() {
  // Nav tabs
  const tabMap = { sales: 'sales', awards: 'awards' };
  Object.entries(tabMap).forEach(([page, feature]) => {
    const tab = document.querySelector(`[data-page="${page}"]`);
    if (tab) tab.style.display = canAccess(feature) ? '' : 'none';
  });

  // Team/Business items in dropdown
  const teamItem = document.getElementById('dd-team-item');
  const bizItem  = document.getElementById('dd-business-item');
  if (teamItem) teamItem.style.display = canAccess('team') ? '' : 'none';
  if (bizItem)  bizItem.style.display  = canAccess('business') ? '' : 'none';

  // Timesheet buttons
  const approveAllBtn = document.getElementById('ts-approve-all-btn');
  const pushBtn       = document.getElementById('ts-push-btn');
  if (approveAllBtn) approveAllBtn.style.display = canAccess('approve_ts')   ? '' : 'none';
  if (pushBtn)       pushBtn.style.display       = canAccess('push_payslip') ? '' : 'none';

  // Team/Business/Billing tabs in modal
  const teamTab    = document.getElementById('acct-tab-team');
  const bizTab     = document.getElementById('acct-tab-business');
  const billingTab = document.getElementById('acct-tab-billing');
  if (teamTab)    teamTab.style.display    = canAccess('team') ? '' : 'none';
  if (bizTab)     bizTab.style.display     = canAccess('business') ? '' : 'none';
  if (billingTab) billingTab.style.display = _userRole === 'owner' ? '' : 'none';
}

// ══════════════════════════════════════════════════════
//  ACCOUNT SETTINGS MODAL
// ══════════════════════════════════════════════════════

function openAccountSettings(tab = 'profile') {
  document.getElementById('user-dropdown').style.display = 'none';

  // Populate profile tab
  document.getElementById('acct-email').value        = _currentUser?.email || '';
  document.getElementById('acct-name').value         = _currentUser?.user_metadata?.name || '';
  document.getElementById('acct-role-display').value = roleName(_userRole);
  document.getElementById('acct-new-pw').value       = '';
  document.getElementById('acct-confirm-pw').value   = '';
  document.getElementById('acct-profile-msg').textContent = '';

  // Populate business tab
  document.getElementById('biz-name-input').value         = _businessProfile?.biz_name      || '';
  document.getElementById('biz-abn-input').value          = _businessProfile?.abn            || '';
  document.getElementById('biz-pay-frequency-input').value = _businessProfile?.pay_frequency || 'weekly';
  document.getElementById('biz-address-street-input').value  = _businessProfile?.address_street  || '';
  document.getElementById('biz-address-suburb-input').value  = _businessProfile?.address_suburb  || '';
  document.getElementById('biz-address-state-input').value   = _businessProfile?.address_state   || '';
  document.getElementById('biz-address-postcode-input').value = _businessProfile?.address_postcode || '';
  document.getElementById('biz-phone-input').value        = _businessProfile?.phone          || '';
  document.getElementById('biz-bsb-input').value          = _businessProfile?.bank_bsb       || '';
  document.getElementById('biz-bank-account-input').value = _businessProfile?.bank_account   || '';
  const linkedEl = document.getElementById('biz-linked-business-input');
  if (linkedEl) linkedEl.value = _businessProfile?.linked_business_id || '';

  switchAcctTab(tab);
  document.getElementById('account-modal')?.classList.add('show');
  if (tab === 'team') loadTeamList();
}

function switchAcctTab(tab) {
  ['profile','team','business','billing'].forEach(t => {
    document.getElementById(`acct-tab-${t}`)?.classList.toggle('active', t === tab);
    const panel = document.getElementById(`acct-panel-${t}`);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'team') {
    const franchisesSection = document.getElementById('franchises-section');
    if (franchisesSection) {
      franchisesSection.style.display = _userRole === 'owner' ? 'block' : 'none';
    }
    if (_userRole === 'owner') loadFranchiseList();
    loadTeamList();
  }
  if (tab === 'billing') loadBillingPanel();
}

async function saveProfile() {
  const name   = document.getElementById('acct-name').value.trim();
  const newPw  = document.getElementById('acct-new-pw').value;
  const confPw = document.getElementById('acct-confirm-pw').value;
  const msgEl  = document.getElementById('acct-profile-msg');
  msgEl.style.color = 'var(--danger)';

  const updates = {};
  if (name) updates.data = { name };

  if (newPw) {
    if (newPw.length < 6) { msgEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (newPw !== confPw) { msgEl.textContent = 'Passwords do not match.'; return; }
    updates.password = newPw;
  }

  if (!Object.keys(updates).length) { msgEl.textContent = 'Nothing to save.'; return; }

  const { error } = await _supabase.auth.updateUser(updates);
  if (error) { msgEl.textContent = error.message; return; }

  // Update header display name
  if (name) {
    const userEl   = document.getElementById('header-user');
    const avatarEl = document.getElementById('header-avatar');
    const ddName   = document.getElementById('dd-user-name');
    if (userEl)   userEl.textContent   = name;
    if (avatarEl) avatarEl.textContent = name[0]?.toUpperCase() || '?';
    if (ddName)   ddName.textContent   = name;
  }

  msgEl.style.color = 'var(--success)';
  msgEl.textContent = '✓ Saved successfully';
  setTimeout(() => { msgEl.textContent = ''; }, 3000);
  document.getElementById('acct-new-pw').value    = '';
  document.getElementById('acct-confirm-pw').value = '';
}

async function saveBusinessSettings() {
  if (!canAccess('business')) return;
  const msgEl = document.getElementById('acct-biz-msg');
  msgEl.style.color = 'var(--danger)';

  const updates = {
    biz_name:          document.getElementById('biz-name-input').value.trim(),
    abn:               document.getElementById('biz-abn-input').value.trim(),
    pay_frequency:     document.getElementById('biz-pay-frequency-input').value,
    address_street:    document.getElementById('biz-address-street-input').value.trim(),
    address_suburb:    document.getElementById('biz-address-suburb-input').value.trim(),
    address_state:     document.getElementById('biz-address-state-input').value.trim(),
    address_postcode:  document.getElementById('biz-address-postcode-input').value.trim(),
    phone:             document.getElementById('biz-phone-input').value.trim(),
    bank_bsb:          document.getElementById('biz-bsb-input').value.trim(),
    bank_account:      document.getElementById('biz-bank-account-input').value.trim(),
    linked_business_id: document.getElementById('biz-linked-business-input')?.value.trim() || null,
  };

  const { error } = await _supabase.from('businesses').update(updates).eq('id', _businessId);
  if (error) { msgEl.textContent = error.message; return; }

  _businessProfile = { ..._businessProfile, ...updates };
  _payFrequency    = updates.pay_frequency;
  // Update linked business ID in sales module
  if (typeof _linkedBusinessId !== 'undefined') {
    _linkedBusinessId = updates.linked_business_id || null;
  }
  const nameEl = document.getElementById('header-biz-name');
  if (nameEl) nameEl.textContent = updates.biz_name || 'My Business';

  msgEl.style.color = 'var(--success)';
  msgEl.textContent = '✓ Business settings saved';
  setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

async function testBusinessLink() {
  const linkedId = document.getElementById('biz-linked-business-input')?.value.trim();
  const statusEl = document.getElementById('biz-link-status');
  if (!statusEl) return;

  if (!linkedId) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = 'Enter a Business ID to test';
    return;
  }

  statusEl.style.color = 'var(--text3)';
  statusEl.textContent = 'Testing connection…';

  try {
    const _BIZ_URL  = 'https://vyikolyljzygmxiahcul.supabase.co';
    const _BIZ_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5aWtvbHlsanp5Z214aWFoY3VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzMyNDQsImV4cCI6MjA5MDM0OTI0NH0.v75aCYpDGlUgnaNFj3JE_clvVxmt2YAA_I9AYFABZII';
    const client = supabase.createClient(_BIZ_URL, _BIZ_ANON);
    const { data, error } = await client
      .from('businesses')
      .select('biz_name')
      .eq('id', linkedId)
      .maybeSingle();

    if (error || !data) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '✕ Business ID not found — check you copied it correctly';
    } else {
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ Connected to "${data.biz_name}" — save to activate`;
    }
  } catch (e) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '✕ Connection failed — check your internet and try again';
  }
}

// ══════════════════════════════════════════════════════
//  FRANCHISE MANAGEMENT
// ══════════════════════════════════════════════════════

function renderFranchiseSwitcher() {
  const wrap = document.getElementById('franchise-switcher-wrap');
  if (!wrap) return;

  // Only show for owners
  if (_userRole !== 'owner') { wrap.style.display = 'none'; return; }
  // Only show if there are franchises
  if (!_franchises.length) { wrap.style.display = 'none'; return; }

  wrap.style.display = 'flex';
  wrap.innerHTML = `
    <select id="franchise-select" onchange="switchFranchise(this.value)"
      style="font-size:12px;padding:5px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;max-width:180px;">
      <option value="${_ownerBusinessId}" ${_businessId === _ownerBusinessId ? 'selected' : ''}>
        🏢 Head Office
      </option>
      ${_franchises.map(f => `
        <option value="${f.id}" ${_businessId === f.id ? 'selected' : ''}>
          📍 ${f.biz_name}
        </option>
      `).join('')}
    </select>
  `;
}

async function switchFranchise(businessId) {
  if (businessId === _businessId) return;

  // Find the business profile
  let profile;
  if (businessId === _ownerBusinessId) {
    const { data } = await _supabase.from('businesses').select('*').eq('id', businessId).maybeSingle();
    profile = data;
  } else {
    profile = _franchises.find(f => f.id === businessId);
    if (!profile) {
      const { data } = await _supabase.from('businesses').select('*').eq('id', businessId).maybeSingle();
      profile = data;
    }
  }
  if (!profile) return;

  _businessProfile = profile;
  _businessId      = businessId;

  // Clear all cached data so nothing from the old franchise bleeds through
  if (typeof shifts !== 'undefined')     { shifts.length = 0; }
  if (typeof employees !== 'undefined')  { employees.length = 0; }
  if (typeof timesheets !== 'undefined') { timesheets.length = 0; }
  if (typeof salesData !== 'undefined')  { Object.keys(salesData).forEach(k => delete salesData[k]); }
  if (typeof availabilityData !== 'undefined') { Object.keys(availabilityData).forEach(k => delete availabilityData[k]); }

  // Render immediately with empty data to clear stale UI
  renderEmployees();
  renderDashboard();

  // Reset loaded ranges
  if (typeof _shiftsLoadedRange !== 'undefined')     _shiftsLoadedRange     = null;
  if (typeof _timesheetsLoadedRange !== 'undefined') _timesheetsLoadedRange = null;
  if (typeof _availabilityLoaded !== 'undefined')    _availabilityLoaded    = false;

  // Update header
  const nameEl = document.getElementById('header-biz-name');
  if (nameEl) nameEl.textContent = profile.biz_name || 'My Business';

  toast(`Switched to ${profile.biz_name} ✓`);

  // Reload all data fresh for this franchise
  const today     = localDateStr(new Date());
  const weekStart = getWeekStart(today);
  const weekEnd   = getWeekDates(weekStart)[6];

  await Promise.all([
    dbLoadEmployees(),
    typeof _dbLoadShiftsRaw === 'function' ? _dbLoadShiftsRaw(weekStart, weekEnd) : Promise.resolve(),
    typeof _dbLoadTimesheetsRaw === 'function' ? _dbLoadTimesheetsRaw(weekStart, weekEnd) : Promise.resolve(),
    typeof dbLoadAvailability === 'function' ? dbLoadAvailability() : Promise.resolve(),
  ]);

  if (typeof _shiftsLoadedRange !== 'undefined')     _shiftsLoadedRange     = `${weekStart}:${weekEnd}`;
  if (typeof _timesheetsLoadedRange !== 'undefined') _timesheetsLoadedRange = `${weekStart}:${weekEnd}`;

  _appReady = true;
  renderDashboard();
  renderEmployees();
  if (typeof renderRosterFromMemory === 'function') renderRosterFromMemory();
  renderSales();
  if (typeof renderTimesheetsFromMemory === 'function') renderTimesheetsFromMemory();
}

async function loadFranchiseList() {
  const el = document.getElementById('franchise-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:13px;">Loading…</div>';

  const { data } = await _supabase
    .from('businesses')
    .select('*')
    .eq('parent_business_id', _ownerBusinessId || _businessId)
    .order('biz_name');

  _franchises = data || [];
  renderFranchiseSwitcher();

  if (!_franchises.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">No franchises yet. Add one below.</div>';
    return;
  }

  el.innerHTML = _franchises.map(f => `
    <div style="padding:14px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div class="avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0;">📍</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;">${f.biz_name}</div>
          <div style="font-size:11px;color:var(--text3);">${f.abn ? 'ABN: ' + f.abn + ' · ' : ''}${f.address || ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="inviteToFranchise('${f.id}','${f.biz_name.replace(/'/g,"\\'")}')">Invite User</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:2px;">Business Connector Code</div>
          <div style="font-size:13px;font-family:monospace;font-weight:600;color:var(--accent2);">
            ${f.business_connector_code || '<span style="color:var(--text3);font-weight:400;">Not generated — re-save franchise to generate</span>'}
          </div>
        </div>
        ${f.business_connector_code ? `
          <button class="btn btn-ghost btn-sm" style="flex-shrink:0;" onclick="navigator.clipboard.writeText('${f.business_connector_code}').then(()=>toast('Code copied ✓'))">
            Copy
          </button>` : ''}
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;padding:0 2px;">
        The franchise owner enters this code in Tayla Business → Settings → Franchise Setup to link their Business account.
      </div>
    </div>
  `).join('');
}

async function createFranchise() {
  const name    = document.getElementById('franchise-name').value.trim();
  const abn     = document.getElementById('franchise-abn').value.trim();
  const address = document.getElementById('franchise-address').value.trim();
  if (!name) { toast('Franchise name is required'); return; }

  const parentId = _ownerBusinessId || _businessId;

  // Generate a unique connector code — TF- + 6 random alphanumeric chars
  const connectorCode = 'TF-' + Math.random().toString(36).toUpperCase().slice(2, 8);

  const { data, error } = await _supabase.from('businesses').insert({
    user_id:                _currentUser.id,
    biz_name:               name,
    abn,
    address,
    parent_business_id:     parentId,
    business_connector_code: connectorCode,
    created_at:             new Date().toISOString(),
  }).select().single();

  if (error) { toast('Error: ' + error.message); return; }

  // Also create an owner business_users record for this franchise
  await _supabase.from('business_users').insert({
    business_id:  data.id,
    user_id:      _currentUser.id,
    email:        _currentUser.email,
    role:         'owner',
    status:       'active',
    accepted_at:  new Date().toISOString(),
  });

  toast(`${name} created ✓ · Connector code: ${connectorCode}`);
  document.getElementById('franchise-name').value    = '';
  document.getElementById('franchise-abn').value     = '';
  document.getElementById('franchise-address').value = '';
  document.getElementById('add-franchise-form').style.display = 'none';
  loadFranchiseList();
}

function inviteToFranchise(franchiseId, franchiseName) {
  const labelEl = document.getElementById('invite-franchise-label');
  const idEl    = document.getElementById('invite-franchise-id');
  if (idEl)    idEl.value = franchiseId;
  if (labelEl) { labelEl.textContent = `Inviting to: ${franchiseName}`; labelEl.style.display = 'block'; }
  document.getElementById('invite-team-form').style.display = 'block';
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-link-result').style.display = 'none';
}

// ══════════════════════════════════════════════════════
//  TEAM MANAGEMENT
// ══════════════════════════════════════════════════════

async function loadTeamList() {
  const el = document.getElementById('team-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">Loading…</div>';

  const { data, error } = await _supabase
    .from('business_users')
    .select('*')
    .eq('business_id', _businessId)
    .order('created_at');

  if (error || !data?.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">No team members yet.</div>';
    return;
  }

  el.innerHTML = data.map(u => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <div class="avatar" style="width:32px;height:32px;font-size:12px;flex-shrink:0;">
        ${(u.email?.[0] || '?').toUpperCase()}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.email}</div>
        <div style="font-size:11px;color:var(--text3);">
          <span class="role-badge role-${u.role}">${roleName(u.role)}</span>
          <span style="margin-left:6px;">${u.status === 'pending' ? '· Invite pending' : u.status === 'active' ? '· Active' : '· Revoked'}</span>
        </div>
      </div>
      ${u.role !== 'owner' && canAccess('team') ? `
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);flex-shrink:0;"
          onclick="revokeTeamMember('${u.id}','${u.email}')">Remove</button>
      ` : ''}
    </div>
  `).join('');
}

function openInviteTeamMember() {
  document.getElementById('invite-team-form').style.display = 'block';
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-link-result').style.display = 'none';
}

async function generateTeamInvite() {
  const email       = document.getElementById('invite-email').value.trim();
  const role        = document.getElementById('invite-role').value;
  const franchiseEl = document.getElementById('invite-franchise-id');
  const targetBizId = franchiseEl?.value || _businessId;
  const resEl       = document.getElementById('invite-link-result');

  if (!email) { toast('Please enter an email address'); return; }
  if (!targetBizId) return;

  // Generate a token
  const token   = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Delete any existing invite for this email+business (revoked or pending)
  await _supabase.from('business_users')
    .delete()
    .eq('business_id', targetBizId)
    .eq('email', email)
    .in('status', ['pending', 'revoked']);

  const { error } = await _supabase.from('business_users').insert({
    business_id:    targetBizId,
    email,
    role,
    invited_by:     _currentUser.id,
    status:         'pending',
    invite_token:   token,
    invite_expires: expires,
  });

  if (error) { toast('Error: ' + error.message); return; }

  const inviteUrl = `${window.location.origin}/app/?team_invite=${token}`;

  resEl.style.display = 'block';
  resEl.innerHTML = `
    <div style="padding:12px 14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);">
      <div style="font-weight:600;font-size:12px;color:var(--success);margin-bottom:8px;">✓ Invite created for ${email}</div>
      <div style="font-size:11px;color:var(--text2);word-break:break-all;background:var(--bg);padding:8px;border-radius:6px;font-family:'DM Mono',monospace;">${inviteUrl}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="navigator.clipboard.writeText('${inviteUrl}').then(()=>toast('Link copied ✓'))">Copy Link</button>
    </div>`;

  loadTeamList();
}

async function revokeTeamMember(id, email) {
  if (!confirm(`Remove ${email} from your team?`)) return;
  const { error } = await _supabase.from('business_users').update({ status: 'revoked' }).eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast(`${email} removed ✓`);
  loadTeamList();
}

// Core invite acceptance — called both from afterLogin and handleTeamInviteToken
async function acceptTeamInviteToken(token) {
  const { data: invite } = await _supabase
    .from('business_users')
    .select('*')
    .eq('invite_token', token)
    .eq('status', 'pending')
    .maybeSingle();

  if (!invite) { toast('Invalid or expired invite link'); return false; }
  if (new Date(invite.invite_expires) < new Date()) { toast('This invite has expired'); return false; }

  // Accept the invite — link to current user
  const { error } = await _supabase.from('business_users').update({
    user_id:      _currentUser.id,
    status:       'active',
    accepted_at:  new Date().toISOString(),
    invite_token: null,
  }).eq('id', invite.id);

  if (error) { toast('Error accepting invite: ' + error.message); return false; }

  // Clear token from URL and reload so afterLogin picks up the new membership
  window.history.replaceState({}, '', window.location.pathname);
  toast('Welcome to the team! Launching now… ✓');
  setTimeout(() => window.location.reload(), 1200);
  return true;
}

// Handle team invite token on page load (for already-logged-in users)
async function handleTeamInviteToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('team_invite');
  if (!token || !_currentUser) return;
  await acceptTeamInviteToken(token);
}

// ══════════════════════════════════════════════════════
//  VISIBILITY — reload page when returning to tab
// ══════════════════════════════════════════════════════

let _lastVisible = Date.now();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _lastVisible = Date.now();
    return;
  }

  // If away more than 5 seconds, reload the page cleanly
  const awayMs = Date.now() - _lastVisible;
  if (awayMs > 5000 && _appReady) {
    window.location.reload();
  }
});

// ══════════════════════════════════════════════════════
//  BILLING
// ══════════════════════════════════════════════════════

async function getBillingStatus() {
  if (!_businessProfile) return null;
  // Internal accounts are always active — never billed
  if (_businessProfile.is_internal) return 'active';
  const status    = _businessProfile.subscription_status || 'trial';
  const trialEnd  = _businessProfile.trial_ends_at ? new Date(_businessProfile.trial_ends_at) : null;
  const periodEnd = _businessProfile.current_period_end ? new Date(_businessProfile.current_period_end) : null;
  const graceEnd  = _businessProfile.grace_period_end ? new Date(_businessProfile.grace_period_end) : null;
  const now       = new Date();

  // Check if trial has expired
  if (status === 'trial' && trialEnd && now > trialEnd) return 'trial_expired';
  // Check if grace period has expired
  if (status === 'grace' && graceEnd && now > graceEnd) return 'locked';
  return status;
}

// ══════════════════════════════════════════════════════
//  SUPER PAYMENT AUDIT TRAIL
//  Records when SuperStream files are exported
//  Provides proof of compliance for Payday Super (July 2026)
// ══════════════════════════════════════════════════════

async function recordSuperPayment(weekStart, weekEnd, totalAmount, empCount) {
  if (!_businessId) return;
  await _supabase.from('super_payments').insert({
    business_id:      _businessId,
    pay_period_start: weekStart,
    pay_period_end:   weekEnd,
    payment_date:     localDateStr(new Date()),
    total_amount:     totalAmount,
    employee_count:   empCount,
    status:           'exported',
    exported_at:      new Date().toISOString(),
  });
}

async function markSuperSubmitted(paymentId) {
  await _supabase.from('super_payments')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', paymentId);
  toast('Super marked as submitted ✓');
  loadSuperPaymentHistory();
}

async function loadSuperPaymentHistory() {
  const el = document.getElementById('super-payment-history');
  if (!el) return;

  const { data } = await _supabase
    .from('super_payments')
    .select('*')
    .eq('business_id', _businessId)
    .order('pay_period_end', { ascending: false })
    .limit(20);

  if (!data?.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px;">No super payments recorded yet.</div>';
    return;
  }

  // Check for any overdue (>7 days since pay period end, not submitted)
  const today = new Date();
  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Pay Period</th>
          <th style="text-align:right;">Employees</th>
          <th style="text-align:right;">Total Super</th>
          <th>Due Date</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${data.map(p => {
          const dueDate = new Date(p.pay_period_end);
          dueDate.setDate(dueDate.getDate() + 7);
          const isOverdue = p.status !== 'submitted' && today > dueDate;
          const dueDateStr = dueDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
          const statusBadge = p.status === 'submitted'
            ? '<span class="badge badge-green">Submitted</span>'
            : isOverdue
              ? '<span class="badge badge-red">Overdue</span>'
              : '<span class="badge badge-yellow">Exported</span>';
          return `
            <tr>
              <td class="mono" style="font-size:12px;">${p.pay_period_start} → ${p.pay_period_end}</td>
              <td style="text-align:right;">${p.employee_count}</td>
              <td style="text-align:right;" class="mono">${fmt(p.total_amount)}</td>
              <td style="font-size:12px;${isOverdue ? 'color:var(--danger);font-weight:600;' : ''}">${dueDateStr}</td>
              <td>${statusBadge}</td>
              <td>
                ${p.status !== 'submitted' ? `
                  <button class="btn btn-ghost btn-sm" onclick="markSuperSubmitted('${p.id}')">Mark Submitted</button>
                ` : ''}
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function loadBillingPanel() {
  if (_userRole !== 'owner') return;

  const statusEl   = document.getElementById('billing-status-badge');
  const detailEl   = document.getElementById('billing-status-detail');
  const breakdownEl = document.getElementById('billing-breakdown');
  const subBtn     = document.getElementById('billing-subscribe-btn');
  const portalBtn  = document.getElementById('billing-portal-btn');
  if (!statusEl || !detailEl) return;

  const status   = await getBillingStatus();
  const trialEnd = _businessProfile?.trial_ends_at ? new Date(_businessProfile.trial_ends_at) : null;
  const periodEnd = _businessProfile?.current_period_end ? new Date(_businessProfile.current_period_end) : null;

  // Count employees and franchises for cost breakdown
  const empCount      = (typeof employees !== 'undefined') ? employees.length : 0;
  const franchiseCount = _franchises?.length || 0;
  const monthlyCost   = (empCount * 4) + (franchiseCount * 2);

  // Breakdown
  if (breakdownEl) {
    breakdownEl.innerHTML = `
      <div style="background:var(--surface2);border-radius:10px;padding:16px;border:1px solid var(--border);">
        <div style="font-weight:700;font-size:13px;margin-bottom:12px;">Monthly Cost Breakdown</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border);">
          <span>${empCount} employees × $4.00</span>
          <span style="font-weight:600;">$${(empCount * 4).toFixed(2)}</span>
        </div>
        ${franchiseCount > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border);">
          <span>${franchiseCount} franchise${franchiseCount > 1 ? 's' : ''} × $2.00</span>
          <span style="font-weight:600;">$${(franchiseCount * 2).toFixed(2)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:8px 0;color:var(--accent);">
          <span>Total per month</span>
          <span>$${monthlyCost.toFixed(2)} AUD</span>
        </div>
      </div>`;
  }

  // Status display
  const fmt = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const statusMap = {
    trial: {
      badge: '🎉 Free Trial',
      color: 'var(--accent2)',
      detail: trialEnd ? `Your free trial ends on <strong>${fmt(trialEnd)}</strong>. Subscribe before then to keep access.` : 'You are on a free trial.',
      showSub: true, showPortal: false,
    },
    trial_expired: {
      badge: '⚠️ Trial Expired',
      color: 'var(--danger)',
      detail: 'Your free trial has ended. Subscribe to restore access.',
      showSub: true, showPortal: false,
    },
    active: {
      badge: '✓ Active',
      color: 'var(--success)',
      detail: periodEnd ? `Your subscription renews on <strong>${fmt(periodEnd)}</strong>.` : 'Your subscription is active.',
      showSub: false, showPortal: true,
    },
    grace: {
      badge: '⚠️ Payment Failed',
      color: 'var(--accent2)',
      detail: `Your last payment failed. Update your payment method within 10 days to avoid losing access.`,
      showSub: false, showPortal: true,
    },
    locked: {
      badge: '🔒 Locked',
      color: 'var(--danger)',
      detail: 'Access suspended due to non-payment. Subscribe to restore access.',
      showSub: true, showPortal: false,
    },
    cancelled: {
      badge: '✕ Cancelled',
      color: 'var(--text3)',
      detail: periodEnd ? `Access continues until <strong>${fmt(periodEnd)}</strong>.` : 'Your subscription has been cancelled.',
      showSub: true, showPortal: true,
    },
  };

  const s = statusMap[status || 'trial'] || statusMap.trial;
  statusEl.innerHTML = `<span style="padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;background:${s.color}22;color:${s.color};">${s.badge}</span>`;
  detailEl.innerHTML = s.detail;
  if (subBtn)    subBtn.style.display    = s.showSub ? '' : 'none';
  if (portalBtn) portalBtn.style.display = s.showPortal ? '' : 'none';
}

async function startCheckout() {
  const btn = document.getElementById('billing-subscribe-btn') || document.getElementById('billing-banner-btn');
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

  try {
    const token = _supabase.changedAccessToken || (await _supabase.auth.getSession())?.data?.session?.access_token;
    const res   = await fetch(`https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'checkout' }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { toast('Error: ' + (data.error || 'Could not create checkout')); }
  } catch (err) {
    toast('Error: ' + err);
  } finally {
    if (btn) { btn.textContent = 'Subscribe Now'; btn.disabled = false; }
  }
}

async function openBillingPortal() {
  const btn = document.getElementById('billing-portal-btn');
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

  try {
    const token = _supabase.changedAccessToken || (await _supabase.auth.getSession())?.data?.session?.access_token;
    const res   = await fetch(`https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'portal' }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { toast('Error: ' + (data.error || 'Could not open portal')); }
  } catch (err) {
    toast('Error: ' + err);
  } finally {
    if (btn) { btn.textContent = 'Manage Billing'; btn.disabled = false; }
  }
}

function showBillingBanner() {
  if (_userRole !== 'owner') return;
  getBillingStatus().then(status => {
    const banner  = document.getElementById('billing-banner');
    const msgEl   = document.getElementById('billing-banner-msg');
    const btn     = document.getElementById('billing-banner-btn');
    if (!banner || !msgEl) return;

    const trialEnd  = _businessProfile?.trial_ends_at ? new Date(_businessProfile.trial_ends_at) : null;
    const graceEnd  = _businessProfile?.grace_period_end ? new Date(_businessProfile.grace_period_end) : null;
    const now       = new Date();

    let show = false;
    let msg  = '';
    let bgColor = '';

    if (status === 'trial' && trialEnd) {
      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 7) {
        show = true;
        msg = `⏳ Your free trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Subscribe to keep access.`;
        bgColor = '#7c3aed';
      }
    } else if (status === 'trial_expired') {
      show = true;
      msg = '⚠️ Your free trial has expired. Subscribe to restore full access.';
      bgColor = 'var(--danger)';
    } else if (status === 'grace') {
      const daysLeft = graceEnd ? Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 10;
      show = true;
      msg = `⚠️ Payment failed. Update your payment method within ${daysLeft} day${daysLeft !== 1 ? 's' : ''} to avoid lockout.`;
      bgColor = '#d97706';
    } else if (status === 'locked') {
      show = true;
      msg = '🔒 Your account is locked due to non-payment. Subscribe to restore access.';
      bgColor = 'var(--danger)';
      if (btn) btn.textContent = 'Subscribe Now';
    }

    if (show) {
      banner.style.display = 'flex';
      banner.style.background = bgColor;
      banner.style.color = '#fff';
      msgEl.textContent = msg;
    } else {
      banner.style.display = 'none';
    }
  });
}

// ══════════════════════════════════════════════════════
//  FRANCHISE ANALYTICS
// ══════════════════════════════════════════════════════

let _analyticsTab    = 'overview';
let _analyticsPeriod = 'week';

const FRANCHISE_COLOURS = [
  '#3d5afe','#d4a017','#38a169','#e53e3e','#805ad5','#dd6b20','#0bc5ea','#ed64a6'
];

function switchAnalyticsTab(tab) {
  _analyticsTab = tab;
  document.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`atab-${tab}`)?.classList.add('active');
  renderFranchiseAnalytics();
}

function switchAnalyticsPeriod(period) {
  _analyticsPeriod = period;
  document.querySelectorAll('.analytics-period').forEach(b => b.classList.remove('active'));
  document.getElementById(`aperiod-${period}`)?.classList.add('active');
  renderFranchiseAnalytics();
}

function getPeriodRange(period) {
  const now   = new Date();
  const today = localDateStr(now);
  let start, end;

  if (period === 'week') {
    start = getWeekStart(today);
    end   = getWeekDates(start)[6];
  } else if (period === 'month') {
    start = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    end   = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    start   = localDateStr(new Date(now.getFullYear(), q * 3, 1));
    end     = localDateStr(new Date(now.getFullYear(), q * 3 + 3, 0));
  } else { // year
    start = localDateStr(new Date(now.getFullYear(), 0, 1));
    end   = localDateStr(new Date(now.getFullYear(), 11, 31));
  }
  return { start, end };
}

async function loadFranchiseAnalyticsData() {
  const { start, end } = getPeriodRange(_analyticsPeriod);

  // Owners see all franchises only from Head Office view
  // When switched to a franchise, or franchise user — show only current business
  let allBizIds, bizMap;
  if (_userRole === 'owner' && _businessId === _ownerBusinessId) {
    allBizIds = _franchises.map(f => f.id).filter(Boolean);
    bizMap = _franchises.reduce((m, f) => ({ ...m, [f.id]: f.biz_name }), {});
  } else {
    allBizIds = [_businessId].filter(Boolean);
    bizMap = { [_businessId]: _businessProfile?.biz_name || 'My Business' };
  }

  if (!allBizIds.length) return [];

  // Fetch all data in parallel across all businesses
  const [empsRes, shiftsRes, salesRes] = await Promise.all([
    _supabase.from('employees').select('*').in('business_id', allBizIds),
    _supabase.from('shifts').select('*').in('business_id', allBizIds).gte('date', start).lte('date', end),
    _supabase.from('sales_data').select('*').in('business_id', allBizIds).gte('date', start).lte('date', end),
  ]);

  const allEmps   = empsRes.data  || [];
  const allShifts = shiftsRes.data || [];
  const allSales  = salesRes.data  || [];

  // Build results per business
  return allBizIds.map(bizId => {
    const emps      = allEmps.filter(e => e.business_id === bizId);
    const bizShifts = allShifts.filter(s => s.business_id === bizId);
    const salesRows = allSales.filter(s => s.business_id === bizId);

    let labourCost = 0, totalHours = 0;
    bizShifts.forEach(shift => {
      const emp = emps.find(e => e.id === shift.employee_id);
      if (!emp) return;
      const pay = calcShiftPay(shift, emp);
      labourCost += pay.totalPay;
      totalHours += pay.workedHours;
    });

    const revenue = salesRows.reduce((s, r) => {
      const val = r.actual != null ? Number(r.actual) : 0;
      return s + (isNaN(val) ? 0 : val);
    }, 0);

    const spch = totalHours > 0 ? revenue / totalHours : 0;

    return {
      id: bizId,
      name: bizMap[bizId] || bizId,
      labourCost,
      revenue,
      spch,
      totalHours,
      empCount: emps.filter(e => e.active !== false).length,
    };
  });
}

async function renderFranchiseAnalytics() {
  const el = document.getElementById('analytics-chart');
  if (!el) return;

  // Only show for owners with franchises, or franchise users
  const analyticsSection = document.getElementById('franchise-analytics');
  if (!analyticsSection) return;
  if (_userRole !== 'owner' && _userRole !== 'franchise') {
    analyticsSection.style.display = 'none';
    return;
  }
  analyticsSection.style.display = 'block';

  el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">Loading analytics…</div>';

  const data = await loadFranchiseAnalyticsData();
  if (!data.length) { el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3);">No data for this period.</div>'; return; }

  if (_analyticsTab === 'overview') {
    renderOverviewAnalytics(el, data);
  } else {
    renderBarChart(el, data, _analyticsTab);
  }
}

function renderOverviewAnalytics(el, data) {
  const totalLabour  = data.reduce((s, d) => s + d.labourCost, 0);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const avgSpch      = data.filter(d => d.spch > 0).reduce((s, d) => s + d.spch, 0) / (data.filter(d => d.spch > 0).length || 1);

  const maxVal = Math.max(...data.map(d => Math.max(d.labourCost, d.revenue)), 1);

  el.innerHTML = `
    <div class="analytics-overview-grid">
      <div class="kpi"><div class="kpi-label">Total Labour</div><div class="kpi-value negative">${fmt(totalLabour)}</div></div>
      <div class="kpi"><div class="kpi-label">Total Revenue</div><div class="kpi-value positive">${fmt(totalRevenue)}</div></div>
      <div class="kpi"><div class="kpi-label">Avg SPCH</div><div class="kpi-value">${fmt(avgSpch)}</div></div>
      <div class="kpi"><div class="kpi-label">Locations</div><div class="kpi-value">${data.length}</div></div>
    </div>
    <div class="analytics-bars">
      ${data.map((d, i) => {
        const labourPct  = Math.max((d.labourCost / maxVal) * 100, 2);
        const revenuePct = Math.max((d.revenue / maxVal) * 100, d.revenue > 0 ? 2 : 0);
        const colour     = FRANCHISE_COLOURS[i % FRANCHISE_COLOURS.length];
        return `
          <div class="analytics-bar-wrap">
            <div style="display:flex;gap:4px;align-items:flex-end;width:100%;justify-content:center;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                <div class="analytics-bar-value" style="font-size:10px;">${fmt(d.labourCost)}</div>
                <div class="analytics-bar" style="height:${labourPct}%;background:${colour};opacity:.7;"></div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                <div class="analytics-bar-value" style="font-size:10px;color:var(--success);">${fmt(d.revenue)}</div>
                <div class="analytics-bar" style="height:${revenuePct}%;background:#38a169;"></div>
              </div>
            </div>
            <div class="analytics-bar-label">${d.name}</div>
          </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:11px;color:var(--text3);">
      <span><span style="display:inline-block;width:10px;height:10px;background:${FRANCHISE_COLOURS[0]};opacity:.7;border-radius:2px;margin-right:4px;"></span>Labour</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#38a169;border-radius:2px;margin-right:4px;"></span>Revenue (actual)</span>
    </div>
  `;
}

function renderBarChart(el, data, metric) {
  const metricMap = {
    labour:  { key: 'labourCost', label: 'Labour Cost',  fmt: v => fmt(v),   colour: '#e53e3e' },
    revenue: { key: 'revenue',    label: 'Revenue',       fmt: v => fmt(v),   colour: '#38a169' },
    spch:    { key: 'spch',       label: 'SPCH',          fmt: v => fmt(v),   colour: '#3d5afe' },
  };
  const m      = metricMap[metric];
  const maxVal = Math.max(...data.map(d => d[m.key]), 1);

  el.innerHTML = `
    <div class="analytics-bars">
      ${data.map((d, i) => {
        const val = d[m.key];
        const pct = Math.max((val / maxVal) * 100, 2);
        const colour = FRANCHISE_COLOURS[i % FRANCHISE_COLOURS.length];
        return `
          <div class="analytics-bar-wrap" title="${d.name}: ${m.fmt(val)}">
            <div class="analytics-bar-value">${m.fmt(val)}</div>
            <div class="analytics-bar" style="height:${pct}%;background:${colour};"></div>
            <div class="analytics-bar-label">${d.name}</div>
          </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center;">${m.label} by location</div>
  `;
}

// ══════════════════════════════════════════════════════
//  STP2
// ══════════════════════════════════════════════════════

function openSTP2Modal() {
  const modal = document.getElementById('stp2-modal');
  if (!modal) return;

  // Show readiness check by default
  const issues = typeof checkSTP2Readiness === 'function' ? checkSTP2Readiness() : [];
  const summaryEl = document.getElementById('stp2-summary');

  summaryEl.innerHTML = `
    <div style="margin-bottom:16px;font-size:13px;color:var(--text2);line-height:1.6;">
      STP Phase 2 reports your payroll data to the ATO each pay run.
      Download the JSON file and submit via the
      <strong>ATO Business Portal</strong> or give it to your tax agent.
    </div>
    <div style="padding:12px 14px;background:var(--surface2);border-radius:8px;font-size:12px;margin-bottom:16px;">
      <div style="font-weight:600;margin-bottom:6px;">Current pay period</div>
      <div style="color:var(--text2);">${_tsWeekStart || 'Go to Timesheets tab first'} to ${typeof getWeekDates === 'function' && _tsWeekStart ? getWeekDates(_tsWeekStart)[6] : ''}</div>
    </div>
    ${issues.length > 0 ? `
    <div style="padding:12px 14px;background:rgba(229,62,62,.08);border-radius:8px;border:1px solid rgba(229,62,62,.2);font-size:12px;color:var(--danger);margin-bottom:12px;">
      ⚠ ${issues.length} employee${issues.length !== 1 ? 's' : ''} missing STP2 data — click "Check Employee Readiness" for details
    </div>` : `
    <div style="padding:12px 14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);font-size:12px;color:var(--success);margin-bottom:12px;">
      ✓ All employees have required STP2 data
    </div>`}
  `;

  modal.classList.add('show');
  // Load super payment history
  if (typeof loadSuperPaymentHistory === 'function') loadSuperPaymentHistory();
}

function populateLeaveEmployeeSelect() {
  const sel = document.getElementById('leave-emp-select');
  if (!sel) return;
  const eligible = employees.filter(e => e.active !== false && e.employment_type !== 'casual');
  sel.innerHTML = '<option value="">Select employee…</option>' +
    eligible.map(e => `<option value="${e.id}">${e.first_name} ${e.last_name}</option>`).join('');
}
