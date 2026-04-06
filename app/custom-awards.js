/* ══════════════════════════════════════════════════════
   Tayla Workforce — Custom Awards
   custom-awards.js
══════════════════════════════════════════════════════ */

// ── Default custom award template (mirrors MA000003 structure)
const DEFAULT_CUSTOM_AWARD = {
  name:      'My Custom Award',
  base_rate: 24.10,
  casual_loading: 0.25,
  permanent: {
    ordinary:      1.00,
    earlyMorning:  1.15,
    lateNight:     1.15,
    saturday:      1.25,
    sunday:        1.50,
    publicHoliday: 2.50,
    overtime1:     1.50,
    overtime2:     2.00,
  },
  casual: {
    ordinary:      1.25,
    earlyMorning:  1.40,
    lateNight:     1.40,
    saturday:      1.50,
    sunday:        1.75,
    publicHoliday: 2.50,
  },
  min_engagement_hours: 3,
  early_morning_before: 7,   // hour (24h)
  late_night_after:     22,  // hour (24h)
  meal_break_after_hours: 5,
  meal_break_mins: 30,
};

const RATE_ROWS = [
  { key: 'ordinary',      label: 'Ordinary Time',            desc: 'Standard weekday hours' },
  { key: 'earlyMorning',  label: 'Early Morning',            desc: 'Before threshold hour (set below)' },
  { key: 'lateNight',     label: 'Late Night',               desc: 'After threshold hour (set below)' },
  { key: 'saturday',      label: 'Saturday',                 desc: 'All hours worked on Saturday' },
  { key: 'sunday',        label: 'Sunday',                   desc: 'All hours worked on Sunday' },
  { key: 'publicHoliday', label: 'Public Holiday',           desc: 'Gazetted public holidays' },
  { key: 'overtime1',     label: 'Overtime (first 2hrs)',    desc: 'Permanent/part-time only' },
  { key: 'overtime2',     label: 'Overtime (after 2hrs)',    desc: 'Permanent/part-time only' },
];

// ── Current award mode: 'ma000003' or 'custom'
let _awardMode = 'ma000003';
let _customAward = null; // loaded from _businessProfile

// ══════════════════════════════════════════════════════
//  INITIALISE
// ══════════════════════════════════════════════════════

function initAwardPage() {
  // Load saved custom award from business profile
  _customAward = (_businessProfile?.custom_award)
    ? JSON.parse(JSON.stringify(_businessProfile.custom_award))
    : JSON.parse(JSON.stringify(DEFAULT_CUSTOM_AWARD));

  _awardMode = _businessProfile?.award_type || 'ma000003';

  renderAwardPage();
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════

function renderAwardPage() {
  const container = document.getElementById('awards-page-content');
  if (!container) return;

  const isMa = _awardMode === 'ma000003';

  container.innerHTML = `
    <!-- Mode Toggle -->
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      <button
        class="btn ${isMa ? 'btn-primary' : 'btn-ghost'}"
        onclick="setAwardMode('ma000003')"
        style="font-size:13px;">
        📋 Fast Food Award MA000003
      </button>
      <button
        class="btn ${!isMa ? 'btn-primary' : 'btn-ghost'}"
        onclick="setAwardMode('custom')"
        style="font-size:13px;">
        ✏️ Custom Award / Manual Rates
      </button>
      ${_awardMode === 'custom' && _businessProfile?.award_type === 'custom' ? `
        <span style="display:flex;align-items:center;font-size:12px;color:var(--success);gap:4px;">
          ✓ Custom award active
        </span>` : ''}
    </div>

    ${isMa ? renderMA000003View() : renderCustomAwardEditor()}
  `;
}

// ── MA000003 read-only summary
function renderMA000003View() {
  const perm = PENALTIES.permanent;
  const cas  = PENALTIES.casual;

  const rateRow = (label, pKey) => `
    <tr>
      <td style="font-weight:500;">${label}</td>
      <td class="mono" style="text-align:center;">${(perm[pKey] * 100).toFixed(0)}%</td>
      <td class="mono" style="text-align:center;">${fmt(AWARD_BASE_RATE * perm[pKey])}/hr</td>
      <td class="mono" style="text-align:center;">${(cas[pKey] * 100).toFixed(0)}%</td>
      <td class="mono" style="text-align:center;">${fmt(AWARD_BASE_RATE * (cas[pKey] || cas.ordinary))}/hr</td>
    </tr>`;

  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <span class="card-title">Fast Food Industry Award — MA000003</span>
        <span style="font-size:11px;color:var(--text3);">FY2024-25 · Level 1 Adult · Read-only</span>
      </div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
          <div class="kpi"><div class="kpi-label">Base Rate</div><div class="kpi-value">${fmt(AWARD_BASE_RATE)}/hr</div></div>
          <div class="kpi"><div class="kpi-label">Casual Loading</div><div class="kpi-value">25%</div></div>
          <div class="kpi"><div class="kpi-label">Min. Engagement</div><div class="kpi-value">3 hrs</div></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rate Type</th>
                <th style="text-align:center;">Perm %</th>
                <th style="text-align:center;">Perm $/hr</th>
                <th style="text-align:center;">Casual %</th>
                <th style="text-align:center;">Casual $/hr</th>
              </tr>
            </thead>
            <tbody>
              ${rateRow('Ordinary Time', 'ordinary')}
              ${rateRow('Early Morning (before 7am)', 'earlyMorning')}
              ${rateRow('Late Night (after 10pm)', 'lateNight')}
              ${rateRow('Saturday', 'saturday')}
              ${rateRow('Sunday', 'sunday')}
              ${rateRow('Public Holiday', 'publicHoliday')}
              <tr>
                <td style="font-weight:500;">Overtime — First 2hrs</td>
                <td class="mono" style="text-align:center;">${(perm.overtime1 * 100).toFixed(0)}%</td>
                <td class="mono" style="text-align:center;">${fmt(AWARD_BASE_RATE * perm.overtime1)}/hr</td>
                <td colspan="2" style="text-align:center;color:var(--text3);font-size:12px;">Not applicable</td>
              </tr>
              <tr>
                <td style="font-weight:500;">Overtime — After 2hrs</td>
                <td class="mono" style="text-align:center;">${(perm.overtime2 * 100).toFixed(0)}%</td>
                <td class="mono" style="text-align:center;">${fmt(AWARD_BASE_RATE * perm.overtime2)}/hr</td>
                <td colspan="2" style="text-align:center;color:var(--text3);font-size:12px;">Not applicable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px;padding:12px 14px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--text2);">
          <strong>Break Rules:</strong> Paid 10-min rest break for shifts ≥4hrs · Unpaid 30-min meal break for shifts >5hrs ·
          Junior rates apply for employees under 21 · Laundry allowance $1.25/day (capped $6.25/wk)
        </div>
      </div>
    </div>
    <div style="padding:16px 20px;background:rgba(61,90,254,.06);border:1px solid rgba(61,90,254,.15);border-radius:10px;font-size:13px;color:var(--text2);">
      💡 Not on the Fast Food Award? Switch to <strong>Custom Award</strong> above to define your own pay structure.
    </div>
  `;
}

// ── Custom Award editor
function renderCustomAwardEditor() {
  const ca = _customAward;

  const rateInputPerm = (key) => `
    <td style="text-align:center;">
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;">
        <input type="number" min="0" max="10" step="0.01"
          value="${ca.permanent[key] || ''}"
          style="width:60px;padding:4px 6px;text-align:center;font-size:12px;"
          oninput="updateCustomRate('permanent','${key}',this.value)"
          ${key === 'overtime1' || key === 'overtime2' ? '' : ''}>
        <span style="font-size:11px;color:var(--text3);">×</span>
      </div>
    </td>
    <td class="mono" style="text-align:center;font-size:12px;color:var(--text3);" id="ca-perm-${key}-preview">
      ${fmt(ca.base_rate * (ca.permanent[key] || 1))}/hr
    </td>`;

  const rateInputCas = (key) => {
    const casKey = ca.casual[key] !== undefined ? key : null;
    if (!casKey && (key === 'overtime1' || key === 'overtime2')) {
      return `<td colspan="2" style="text-align:center;color:var(--text3);font-size:12px;">N/A</td>`;
    }
    return `
    <td style="text-align:center;">
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;">
        <input type="number" min="0" max="10" step="0.01"
          value="${ca.casual[key] !== undefined ? ca.casual[key] : ''}"
          style="width:60px;padding:4px 6px;text-align:center;font-size:12px;"
          oninput="updateCustomRate('casual','${key}',this.value)">
        <span style="font-size:11px;color:var(--text3);">×</span>
      </div>
    </td>
    <td class="mono" style="text-align:center;font-size:12px;color:var(--text3);" id="ca-cas-${key}-preview">
      ${fmt(ca.base_rate * (ca.casual[key] || 1))}/hr
    </td>`;
  };

  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header flex-between">
        <span class="card-title">Custom Award Builder</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="resetCustomAward()">Reset to Defaults</button>
          <button class="btn btn-primary btn-sm" id="ca-save-btn" onclick="saveCustomAward()">💾 Save &amp; Activate</button>
        </div>
      </div>
      <div class="card-body">

        <!-- Award name + base rate -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;">
          <div class="form-group full" style="grid-column:1/3;">
            <label>Award / Agreement Name</label>
            <input type="text" id="ca-name" value="${ca.name || ''}"
              placeholder="e.g. Enterprise Agreement 2024"
              oninput="_customAward.name=this.value">
          </div>
          <div class="form-group">
            <label>Base Rate ($/hr)</label>
            <input type="number" id="ca-base-rate" min="0" step="0.01"
              value="${ca.base_rate || ''}"
              oninput="updateCustomBaseRate(this.value)">
          </div>
        </div>

        <!-- Penalty rates table -->
        <div class="table-wrap" style="margin-bottom:20px;">
          <table>
            <thead>
              <tr>
                <th>Rate Type</th>
                <th style="text-align:center;" colspan="2">Permanent / Part-time</th>
                <th style="text-align:center;" colspan="2">Casual</th>
              </tr>
              <tr style="background:var(--surface2);font-size:11px;color:var(--text3);">
                <th></th>
                <th style="text-align:center;">Multiplier</th>
                <th style="text-align:center;">Effective Rate</th>
                <th style="text-align:center;">Multiplier</th>
                <th style="text-align:center;">Effective Rate</th>
              </tr>
            </thead>
            <tbody>
              ${RATE_ROWS.map(r => `
                <tr>
                  <td>
                    <div style="font-weight:500;font-size:13px;">${r.label}</div>
                    <div style="font-size:11px;color:var(--text3);">${r.desc}</div>
                  </td>
                  ${rateInputPerm(r.key)}
                  ${rateInputCas(r.key)}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Break & threshold rules -->
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px;">
          <div class="card" style="box-shadow:none;border:1px solid var(--border);padding:16px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:12px;">Time Thresholds</div>
            <div class="form-group">
              <label>Early Morning — before (hour, 24h)</label>
              <input type="number" min="0" max="12" value="${ca.early_morning_before ?? 7}"
                style="max-width:100px;"
                oninput="_customAward.early_morning_before=parseInt(this.value)||7">
            </div>
            <div class="form-group" style="margin-top:10px;">
              <label>Late Night — after (hour, 24h)</label>
              <input type="number" min="12" max="24" value="${ca.late_night_after ?? 22}"
                style="max-width:100px;"
                oninput="_customAward.late_night_after=parseInt(this.value)||22">
            </div>
          </div>
          <div class="card" style="box-shadow:none;border:1px solid var(--border);padding:16px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:12px;">Break Rules</div>
            <div class="form-group">
              <label>Minimum engagement (hours)</label>
              <input type="number" min="0" max="8" step="0.5" value="${ca.min_engagement_hours ?? 3}"
                style="max-width:100px;"
                oninput="_customAward.min_engagement_hours=parseFloat(this.value)||3">
            </div>
            <div class="form-group" style="margin-top:10px;">
              <label>Unpaid meal break after (hours)</label>
              <input type="number" min="0" max="12" step="0.5" value="${ca.meal_break_after_hours ?? 5}"
                style="max-width:100px;"
                oninput="_customAward.meal_break_after_hours=parseFloat(this.value)||5">
            </div>
            <div class="form-group" style="margin-top:10px;">
              <label>Meal break duration (minutes)</label>
              <input type="number" min="0" max="60" value="${ca.meal_break_mins ?? 30}"
                style="max-width:100px;"
                oninput="_customAward.meal_break_mins=parseInt(this.value)||30">
            </div>
          </div>
        </div>

        <div style="padding:12px 14px;background:rgba(232,197,71,.08);border:1px solid rgba(232,197,71,.25);border-radius:8px;font-size:12px;color:var(--text2);">
          ⚠ <strong>Note:</strong> Custom award rates replace MA000003 across all pay calculations, rosters and payslips once activated.
          Junior rates (age-based) still apply as a multiplier on top of your custom base rate.
        </div>

      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  EDITOR ACTIONS
// ══════════════════════════════════════════════════════

function setAwardMode(mode) {
  _awardMode = mode;
  renderAwardPage();
}

function updateCustomBaseRate(val) {
  const rate = parseFloat(val) || 0;
  _customAward.base_rate = rate;

  // Re-render effective rate previews
  RATE_ROWS.forEach(r => {
    const permEl = document.getElementById(`ca-perm-${r.key}-preview`);
    const casEl  = document.getElementById(`ca-cas-${r.key}-preview`);
    if (permEl && _customAward.permanent[r.key] != null) {
      permEl.textContent = fmt(rate * _customAward.permanent[r.key]) + '/hr';
    }
    if (casEl && _customAward.casual[r.key] != null) {
      casEl.textContent = fmt(rate * _customAward.casual[r.key]) + '/hr';
    }
  });
}

function updateCustomRate(empType, key, val) {
  const mult = parseFloat(val) || 0;
  _customAward[empType][key] = mult;

  const preview = document.getElementById(`ca-${empType === 'permanent' ? 'perm' : 'cas'}-${key}-preview`);
  if (preview) preview.textContent = fmt(_customAward.base_rate * mult) + '/hr';
}

function resetCustomAward() {
  if (!confirm('Reset all custom award rates to defaults?')) return;
  _customAward = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_AWARD));
  renderAwardPage();
  toast('Custom award reset to defaults');
}

async function saveCustomAward() {
  if (!_businessId) { toast('Not connected'); return; }

  const btn = document.getElementById('ca-save-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const { error } = await _supabase.from('businesses').update({
    award_type:   'custom',
    custom_award: _customAward,
  }).eq('id', _businessId);

  if (error) {
    toast('⚠ Save failed: ' + error.message);
    console.error('saveCustomAward error:', error);
    if (btn) { btn.textContent = '💾 Save & Activate'; btn.disabled = false; }
    return;
  }

  _businessProfile.award_type   = 'custom';
  _businessProfile.custom_award = _customAward;
  _awardMode = 'custom';

  toast('Custom award saved and activated ✓');
  renderAwardPage();
}

// ══════════════════════════════════════════════════════
//  OVERRIDE AWARD ENGINE — called from awards.js
// ══════════════════════════════════════════════════════

// Replaces getPenaltyKey when custom award is active.
// awards.js calls this via getEffectivePenaltyKey() wrapper.
function getCustomPenaltyKey(dateStr, startTime, endTime) {
  const dayType = getDayType(dateStr);
  if (dayType === 'publicHoliday') return 'publicHoliday';
  if (dayType === 'sunday')        return 'sunday';
  if (dayType === 'saturday')      return 'saturday';

  const ca     = _businessProfile?.custom_award || _customAward || DEFAULT_CUSTOM_AWARD;
  const startH = parseInt(startTime?.split(':')[0] || '9');
  const endH   = parseInt(endTime?.split(':')[0]   || '17');
  const beforeH = ca.early_morning_before ?? 7;
  const afterH  = ca.late_night_after     ?? 22;

  if (startH < beforeH)  return 'earlyMorning';
  if (endH   >= afterH)  return 'lateNight';
  return 'ordinary';
}

// Returns effective penalty multiplier for given key + employment type
function getCustomMultiplier(penaltyKey, empType) {
  const ca = _businessProfile?.custom_award || _customAward || DEFAULT_CUSTOM_AWARD;
  const table = empType === 'casual' ? ca.casual : ca.permanent;
  return table[penaltyKey] ?? 1.0;
}

// Returns custom min engagement hours
function getCustomMinEngagement() {
  const ca = _businessProfile?.custom_award || _customAward || DEFAULT_CUSTOM_AWARD;
  return ca.min_engagement_hours ?? 3;
}

// Returns custom break minutes for a given shift duration
function getCustomBreakMins(shiftHours) {
  const ca = _businessProfile?.custom_award || _customAward || DEFAULT_CUSTOM_AWARD;
  if (shiftHours > (ca.meal_break_after_hours ?? 5)) return ca.meal_break_mins ?? 30;
  return 0;
}
