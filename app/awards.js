/* ══════════════════════════════════════════════════════
   Tayla Workforce — Award Engine
   Multi-award support: MA000003, MA000009, MA000119,
   MA000004, MA000058, MA000005 + Custom Award
   awards.js — Effective 1 July 2025
══════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
//  AWARD DATA — all 6 supported awards
//  Rates: Fair Work pay guides, first full pay period
//  on or after 1 July 2025 (3.5% Annual Wage Review)
//  Always verify at fairwork.gov.au before payroll.
// ══════════════════════════════════════════════════════

const AWARD_DATA = {

  // ── MA000003 Fast Food Industry Award
  ma000003: {
    name:       'Fast Food Industry Award (MA000003)',
    short:      'MA000003',
    base_rate:  26.55, // Level 1 adult hourly rate
    min_engagement_hours: 3,
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 22,
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
    junior_rates: { 15: 0.40, 16: 0.50, 17: 0.60, 18: 0.70, 19: 0.80, 20: 0.90 },
    notes: 'Covers fast food, QSR, takeaway and counter service venues. Min 3hr engagement.',
  },

  // ── MA000009 Hospitality Industry (General) Award (HIGA)
  ma000009: {
    name:       'Hospitality Industry (General) Award (MA000009)',
    short:      'MA000009 — HIGA',
    base_rate:  24.95, // Level 1 Food & Bev Attendant Gr 1
    min_engagement_hours: 2,
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 19, // Evening loading 7pm–midnight Mon–Fri ($2.72/hr flat — approximated as multiplier)
    late_night_loading_flat: 2.72, // $2.72/hr flat added on top — not a multiplier
    permanent: {
      ordinary:      1.00,
      earlyMorning:  1.00, // no early morning multiplier — evening loading is flat
      lateNight:     1.11, // approx: ($24.17 + $2.72) / $24.17 ≈ 1.112
      saturday:      1.25,
      sunday:        1.50,
      publicHoliday: 2.25,
      overtime1:     1.50,
      overtime2:     2.00,
    },
    casual: {
      ordinary:      1.25,
      earlyMorning:  1.25,
      lateNight:     1.36, // 1.25 base + $2.72 flat / base ≈ approximated
      saturday:      1.50,
      sunday:        1.75,
      publicHoliday: 2.75,
    },
    junior_rates: { 15: 0.368, 16: 0.473, 17: 0.578, 18: 0.683, 19: 0.825, 20: 0.977 },
    notes: 'Covers hotels, pubs, bars, accommodation, resorts, casinos. Evening loading $2.72/hr (7pm–midnight Mon–Fri) is a flat all-purpose allowance. Min 2hr casual engagement.',
  },

  // ── MA000119 Restaurant Industry Award (RIA)
  ma000119: {
    name:       'Restaurant Industry Award (MA000119)',
    short:      'MA000119 — RIA',
    base_rate:  24.95, // Level 1 Food & Bev Attendant Gr 1
    min_engagement_hours: 2, // casual 2hrs; PT 3hrs; FT 6hrs/day
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 22,
    permanent: {
      ordinary:      1.00,
      earlyMorning:  1.00,
      lateNight:     1.00, // no late night loading in RIA
      saturday:      1.25,
      sunday:        1.50,
      publicHoliday: 2.25,
      overtime1:     1.50,
      overtime2:     2.00,
    },
    casual: {
      ordinary:      1.25,
      earlyMorning:  1.25,
      lateNight:     1.25,
      saturday:      1.50,
      sunday:        1.75,
      publicHoliday: 2.50,
    },
    junior_rates: { 15: 0.368, 16: 0.473, 17: 0.578, 18: 0.683, 19: 0.825, 20: 0.977 },
    notes: 'Covers restaurants, cafes, bistros (food-primary). NOT pubs/clubs/fast food. Split shift allowance $5.34, meal allowance $16.73, tool allowance $2.03/day. FT min 6hrs/day.',
  },

  // ── MA000004 General Retail Industry Award (GRIA)
  ma000004: {
    name:       'General Retail Industry Award (MA000004)',
    short:      'MA000004 — Retail',
    base_rate:  26.55, // Level 1 adult — notably higher than hospitality
    min_engagement_hours: 3,
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 18, // Evening penalty Mon–Fri after 6pm
    permanent: {
      ordinary:      1.00,
      earlyMorning:  1.00,
      lateNight:     1.25, // after 6pm Mon–Fri
      saturday:      1.25, // first 3 hours
      sunday:        2.00, // highest Sunday rate
      publicHoliday: 2.50,
      overtime1:     1.50, // first 3 hours
      overtime2:     2.00,
    },
    casual: {
      ordinary:      1.25,
      earlyMorning:  1.25,
      lateNight:     1.50,
      saturday:      1.50,
      sunday:        2.25,
      publicHoliday: 2.75,
    },
    junior_rates: { 15: 0.40, 16: 0.50, 17: 0.60, 18: 0.70, 19: 0.80, 20: 0.90 },
    notes: 'Covers shops, supermarkets, department stores, hardware, clothing. Level 1 base $26.55/hr — higher than hospitality. Sunday 200% permanent. Evening penalty 6pm Mon–Fri.',
  },

  // ── MA000058 Registered and Licensed Clubs Award (RLCA)
  ma000058: {
    name:       'Registered & Licensed Clubs Award (MA000058)',
    short:      'MA000058 — Clubs',
    base_rate:  24.95, // Level 1 Kitchen/Bar Attendant Gr 1
    min_engagement_hours: 3,
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 24, // Late/early penalty midnight–7am
    permanent: {
      ordinary:      1.00,
      earlyMorning:  1.50, // midnight–7am
      lateNight:     1.50, // midnight onwards
      saturday:      1.50,
      sunday:        1.75,
      publicHoliday: 2.25,
      overtime1:     1.50,
      overtime2:     2.00,
    },
    casual: {
      ordinary:      1.25,
      earlyMorning:  1.75,
      lateNight:     1.75,
      saturday:      1.75,
      sunday:        2.00,
      publicHoliday: 2.75,
    },
    junior_rates: { 15: 0.368, 16: 0.473, 17: 0.578, 18: 0.683, 19: 0.825, 20: 0.977 },
    notes: 'Covers RSL clubs, sporting clubs, community clubs. Juniors serving alcohol must receive adult rate. Late/early penalty midnight–7am Mon–Fri.',
  },

  // ── MA000005 Hair and Beauty Industry Award (HBIA)
  ma000005: {
    name:       'Hair & Beauty Industry Award (MA000005)',
    short:      'MA000005 — Hair & Beauty',
    base_rate:  25.15, // Level 3 is the "standard rate" — used as benchmark
    min_engagement_hours: 3,
    meal_break_after_hours: 5,
    meal_break_mins: 30,
    early_morning_before: 7,
    late_night_after: 22,
    permanent: {
      ordinary:      1.00,
      earlyMorning:  1.00,
      lateNight:     1.00,
      saturday:      1.25,
      sunday:        2.00,
      publicHoliday: 2.25,
      overtime1:     1.50,
      overtime2:     2.00,
    },
    casual: {
      ordinary:      1.25,
      earlyMorning:  1.25,
      lateNight:     1.25,
      saturday:      1.50,
      sunday:        2.25,
      publicHoliday: 2.50,
    },
    junior_rates: { 15: 0.40, 16: 0.50, 17: 0.60, 18: 0.70, 19: 0.80, 20: 0.90 },
    notes: 'Covers salons, barbershops, beauty/nail salons, day spas. 12-hour mandatory break between shifts. Sunday is employee-choice — employer must roster 1 Sunday off per 4 weeks.',
  },
};

// ── Backwards-compatible alias — used in legacy code
const AWARD_BASE_RATE = AWARD_DATA.ma000003.base_rate;
const PENALTIES = {
  permanent: AWARD_DATA.ma000003.permanent,
  casual:    AWARD_DATA.ma000003.casual,
};

// ── Get active award data based on business profile
function getActiveAward() {
  const type = _businessProfile?.award_type || 'ma000003';
  if (type === 'custom') return null; // handled by custom-awards.js
  return AWARD_DATA[type] || AWARD_DATA.ma000003;
}

// ── Junior rate multipliers by age (uses active award)
const JUNIOR_RATES = {
  15: 0.40, 16: 0.50, 17: 0.60,
  18: 0.70, 19: 0.80, 20: 0.90,
};

// ── Laundry allowance (weekly / daily)
const LAUNDRY_ALLOWANCE = {
  weekly: 6.25,
  daily:  1.25,
};

// ── Minimum engagement (hours) — resolved from active award
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

function getJuniorMultiplier(age, juniorRates) {
  if (!age || age >= 21) return 1.00;
  const rates = juniorRates || JUNIOR_RATES;
  const key = Math.min(Math.max(Math.floor(age), 15), 20);
  return rates[key] || 1.00;
}

// ── Returns effective base rate, respecting custom award if active
function getBaseRate(employee) {
  let base;
  if (employee.hourly_rate) {
    base = employee.hourly_rate;
  } else if (_businessProfile?.award_type === 'custom' && _businessProfile?.custom_award?.base_rate) {
    base = _businessProfile.custom_award.base_rate;
  } else {
    const award = getActiveAward();
    base = award ? award.base_rate : AWARD_BASE_RATE;
  }
  const award = getActiveAward();
  const juniorRates = award ? award.junior_rates : JUNIOR_RATES;
  const juniorMultiplier = getJuniorMultiplier(employee.age, juniorRates);
  return +(base * juniorMultiplier).toFixed(4);
}

// ── Returns penalty key, respecting custom award thresholds
function getPenaltyKey(dateStr, startTime, endTime, employmentType) {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomPenaltyKey(dateStr, startTime, endTime);
  }

  const award   = getActiveAward();
  const dayType = getDayType(dateStr);
  if (dayType === 'publicHoliday') return 'publicHoliday';
  if (dayType === 'sunday')        return 'sunday';
  if (dayType === 'saturday')      return 'saturday';

  const startH  = parseInt(startTime?.split(':')[0] || '9');
  const endH    = parseInt(endTime?.split(':')[0]   || '17');
  const beforeH = award?.early_morning_before ?? 7;
  const afterH  = award?.late_night_after     ?? 22;

  if (startH < beforeH) return 'earlyMorning';
  if (endH   >= afterH) return 'lateNight';
  return 'ordinary';
}

// ── Returns penalty multiplier, respecting custom award if active
function getPenaltyMultiplier(penaltyKey, empType) {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomMultiplier(penaltyKey, empType);
  }
  const award    = getActiveAward();
  const penalties = empType === 'casual'
    ? (award?.casual    || PENALTIES.casual)
    : (award?.permanent || PENALTIES.permanent);
  return penalties[penaltyKey] || penalties.ordinary;
}

// ── Returns minimum engagement hours for active award
function getMinEngagementHours() {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomMinEngagement();
  }
  const award = getActiveAward();
  return award?.min_engagement_hours ?? MIN_ENGAGEMENT_HOURS;
}

// ── Returns break minutes for active award
function calcBreakMins(shiftHours) {
  if (_businessProfile?.award_type === 'custom') {
    return getCustomBreakMins(shiftHours);
  }
  const award = getActiveAward();
  const threshold = award?.meal_break_after_hours ?? 5;
  const duration  = award?.meal_break_mins ?? 30;
  if (shiftHours > threshold) return duration;
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
