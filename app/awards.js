/* ══════════════════════════════════════════════════════
   Tayla Workforce — Award Engine
   Fast Food Industry Award MA000003 + Custom Award support
   awards.js
══════════════════════════════════════════════════════ */

// ── Base hourly rates (Level 1 adult, FY2024-25)
const AWARD_BASE_RATE = 24.10; // Level 1 adult rate per hour

// ── Junior rate multipliers by age
const JUNIOR_RATES = {
  15: 0.40, 16: 0.50, 17: 0.60,
  18: 0.70, 19: 0.80, 20: 0.90,
};

// ── Penalty rate multipliers
const PENALTIES = {
  // Permanent/Part-time
  permanent: {
    ordinary:       1.00,
    earlyMorning:   1.15, // before 7am
    lateNight:      1.15, // after 10pm
    saturday:       1.25,
    sunday:         1.50,
    publicHoliday:  2.50,
    overtime1:      1.50, // first 2hrs
    overtime2:      2.00, // after 2hrs
  },
  // Casual — weekend rates are flat (not base + loading)
  casual: {
    ordinary:       1.25, // base + 25% casual loading
    earlyMorning:   1.40, // 115% + 25%
    lateNight:      1.40, // 115% + 25%
    saturday:       1.50, // flat award rate
    sunday:         1.75, // flat award rate
    publicHoliday:  2.50, // same as permanent
    // Casuals generally don't receive overtime
  },
};

// ── Laundry allowance (weekly / daily)
const LAUNDRY_ALLOWANCE = {
  weekly: 6.25,
  daily:  1.25,
};

// ── Minimum engagement (hours) — MA000003
const MIN_ENGAGEMENT_HOURS = 3;

// ── Break rules
const BREAK_RULES = {
  paidRest:   { minShiftHours: 4,  duration: 10, paid: true  }, // 10 min paid rest for 4+ hrs
  mealBreak:  { minShiftHours: 5,  duration: 30, paid: false }, // 30 min unpaid meal for 5+ hrs
};

// ── Public holidays (Australian national + VIC, update annually)
const PUBLIC_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-27', // Australia Day (observed)
  '2025-04-18', // Good Friday
  '2025-04-19', // Easter Saturday
  '2025-04-20', // Easter Sunday
  '2025-04-21', // Easter Monday
  '2025-04-25', // Anzac Day
  '2025-06-09', // King's Birthday (VIC)
  '2025-11-04', // Melbourne Cup (VIC)
  '2025-12-25', // Christmas Day
  '2025-12-26', // Boxing Day
];

const PUBLIC_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-26', // Australia Day
  '2026-04-03', // Good Friday
  '2026-04-04', // Easter Saturday
  '2026-04-05', // Easter Sunday
  '2026-04-06', // Easter Monday
  '2026-04-25', // Anzac Day
  '2026-06-08', // King's Birthday (VIC)
  '2026-11-03', // Melbourne Cup (VIC)
  '2026-12-25', // Christmas Day
  '2026-12-28', // Boxing Day (observed)
];

const ALL_PUBLIC_HOLIDAYS = [...PUBLIC_HOLIDAYS_2025, ...PUBLIC_HOLIDAYS_2026];

// ══════════════════════════════════════════════════════
//  CORE CALCULATIONS
// ══════════════════════════════════════════════════════

function isPublicHoliday(dateStr) {
  return ALL_PUBLIC_HOLIDAYS.includes(dateStr);
}

function getDayType(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (isPublicHoliday(dateStr)) return 'publicHoliday';
  if (day === 0) return 'sunday';
  if (day === 6) return 'saturday';
  return 'weekday';
}

function getJuniorMultiplier(age) {
  if (!age || age >= 21) return 1.00;
  const key = Math.min(Math.max(Math.floor(age), 15), 20);
  return JUNIOR_RATES[key] || 1.00;
}

// ── Returns effective base rate, respecting custom award if active
function getBaseRate(employee) {
  let base;
  if (employee.hourly_rate) {
    // Employee-specific override always wins
    base = employee.hourly_rate;
  } else if (_businessProfile?.award_type === 'custom' && _businessProfile?.custom_award?.base_rate) {
    base = _businessProfile.custom_award.base_rate;
  } else {
    base = AWARD_BASE_RATE;
  }
  const juniorMultiplier = getJuniorMultiplier(employee.age);
  return +(base * juniorMultiplier).toFixed(4);
}

// ── Returns penalty key, respecting custom award thresholds
function getPenaltyKey(dateStr, startTime, endTime, employmentType) {
  if (_businessProfile?.award_type === 'custom') {
    // Delegate to custom-awards.js
    return getCustomPenaltyKey(dateStr, startTime, endTime);
  }

  const dayType = getDayType(dateStr);
  if (dayType === 'publicHoliday') return 'publicHoliday';
  if (dayType === 'sunday')        return 'sunday';
  if (dayType === 'saturday')      return 'saturday';

  const startH = parseInt(startTime?.split(':')[0] || '9');
  const endH   = parseInt(endTime?.split(':')[0]   || '17');
  if (startH < 7)  return 'earlyMorning';
  if (endH >= 22)  return 'lateNight';
  return 'ordinary';
}

// ── Returns penalty multiplier, respecting custom award if active
function getPenaltyMultiplier(penaltyKey, empType) {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomMultiplier(penaltyKey, empType);
  }
  const penalties = empType === 'casual' ? PENALTIES.casual : PENALTIES.permanent;
  return penalties[penaltyKey] || penalties.ordinary;
}

// ── Returns minimum engagement hours for active award
function getMinEngagementHours() {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomMinEngagement();
  }
  return MIN_ENGAGEMENT_HOURS;
}

// ── Returns break minutes for active award
function calcBreakMins(shiftHours) {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomBreakMins(shiftHours);
  }
  // MA000003: >5 hrs → 30 min unpaid meal break
  if (shiftHours > 5) return 30;
  return 0;
}

function calcShiftPay(shift, employee) {
  const empType    = employee.employment_type || 'casual';
  const baseRate   = getBaseRate(employee);

  // Parse times
  const startParts = shift.start_time.split(':').map(Number);
  const endParts   = shift.end_time.split(':').map(Number);
  const startMins  = startParts[0] * 60 + startParts[1];
  let endMins      = endParts[0] * 60 + endParts[1];
  if (endMins <= startMins) endMins += 24 * 60; // overnight shift

  const totalMins   = endMins - startMins;
  const breakMins   = shift.break_mins ?? calcBreakMins(totalMins / 60);
  const workedMins  = totalMins - breakMins;
  const workedHours = +(workedMins / 60).toFixed(4);

  // Enforce minimum engagement
  const minEng       = getMinEngagementHours();
  const billableHours = Math.max(workedHours, minEng);

  // Get penalty multiplier
  const penaltyKey  = getPenaltyKey(shift.date, shift.start_time, shift.end_time, empType);
  const multiplier  = getPenaltyMultiplier(penaltyKey, empType);
  const hourlyRate  = +(baseRate * multiplier).toFixed(4);
  const grossPay    = +(hourlyRate * billableHours).toFixed(2);

  // Laundry allowance (if applicable)
  const laundryAllowance = employee.laundry_allowance ? LAUNDRY_ALLOWANCE.daily : 0;

  return {
    workedHours:         +workedHours.toFixed(2),
    billableHours:       +billableHours.toFixed(2),
    breakMins,
    penaltyKey,
    multiplier,
    baseRate:            +baseRate.toFixed(4),
    hourlyRate:          +hourlyRate.toFixed(4),
    grossPay:            +grossPay.toFixed(2),
    laundryAllowance:    +laundryAllowance.toFixed(2),
    totalPay:            +(grossPay + laundryAllowance).toFixed(2),
    isMinimumEngagement: workedHours < minEng,
  };
}

function calcWeeklyPay(shifts, employee) {
  const results = shifts.map(s => calcShiftPay(s, employee));
  const totalHours  = +results.reduce((s, r) => s + r.workedHours, 0).toFixed(2);
  const totalGross  = +results.reduce((s, r) => s + r.grossPay,    0).toFixed(2);
  const totalAllow  = +results.reduce((s, r) => s + r.laundryAllowance, 0).toFixed(2);

  // Laundry allowance — cap at weekly rate if daily exceeds it
  const laundryWeekly = Math.min(totalAllow, LAUNDRY_ALLOWANCE.weekly);

  return {
    shifts: results,
    totalHours,
    totalGross,
    laundryAllowance: +laundryWeekly.toFixed(2),
    totalPay: +(totalGross + laundryWeekly).toFixed(2),
  };
}

// ── Format penalty name for display
function penaltyLabel(key) {
  const labels = {
    ordinary:      'Ordinary',
    earlyMorning:  'Early Morning (before 7am)',
    lateNight:     'Late Night (after 10pm)',
    saturday:      'Saturday',
    sunday:        'Sunday',
    publicHoliday: 'Public Holiday',
    overtime1:     'Overtime (first 2hrs)',
    overtime2:     'Overtime (after 2hrs)',
  };
  return labels[key] || key;
}

// ── Week helpers
function getWeekStart(dateStr) {
  const d   = parseLocalDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return localDateStr(mon);
}

function fmtTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')}${period}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localDateStr(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDates(dateStr) {
  const d   = parseLocalDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return localDateStr(dt);
  });
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmt(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
