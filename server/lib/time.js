'use strict';
// Time helpers. All league times are in LEAGUE_TZ (America/New_York).
// Sessions store starts_at as timestamptz; these helpers convert between
// a "YYYY-MM-DD" date + "HH:MM" time in the league zone and UTC.

const TZ = process.env.LEAGUE_TZ || 'America/New_York';

function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour % 24,
    +parts.minute,
    +parts.second
  );
  return (asUTC - date.getTime()) / 60000;
}

// "2026-11-21" + "18:30" in the league zone -> Date (UTC instant).
function zonedToUtc(dateStr, timeStr, tz = TZ) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const once = new Date(guess - off1 * 60000);
  const off2 = tzOffsetMinutes(once, tz);
  return new Date(guess - off2 * 60000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

function fmtDate(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function fmtTime(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function fmtShort(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

module.exports = { TZ, zonedToUtc, addHours, fmtDate, fmtTime, fmtShort };
