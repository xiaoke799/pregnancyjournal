function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function subtractDays(dateStr, days) {
  return addDays(dateStr, -days);
}

function calculateDueDateFromLmp(lmpDateStr) {
  return addDays(lmpDateStr, 280);
}

function calculateDueDateFromConception(conceptionDateStr) {
  return addDays(conceptionDateStr, 266);
}

function calculateLmpFromDueDate(dueDateStr) {
  return subtractDays(dueDateStr, 280);
}

function calculateGestationalAge(lmpDateStr, refDateStr) {
  const lmp = parseDate(lmpDateStr);
  const ref = refDateStr ? parseDate(refDateStr) : new Date();
  ref.setHours(0, 0, 0, 0);
  const diffMs = ref.getTime() - lmp.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (totalDays < 0) {
    return { weeks: 0, days: 0, totalDays: 0 };
  }
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  return { weeks, days, totalDays };
}

function getTrimester(weeks) {
  if (weeks < 13) return '孕早期';
  if (weeks < 28) return '孕中期';
  return '孕晚期';
}

function daysUntilDue(dueDateStr, refDateStr) {
  const due = parseDate(dueDateStr);
  const ref = refDateStr ? parseDate(refDateStr) : new Date();
  ref.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - ref.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

module.exports = {
  calculateDueDateFromLmp,
  calculateDueDateFromConception,
  calculateLmpFromDueDate,
  calculateGestationalAge,
  getTrimester,
  daysUntilDue
};
