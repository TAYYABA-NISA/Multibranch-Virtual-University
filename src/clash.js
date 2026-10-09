// Two slots clash when they are on the same date and their times overlap.
// A slot with no end time is treated as lasting one hour.
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const endOf = (s) => (s.end_time ? minutes(s.end_time) : minutes(s.start_time) + 60);

export const overlaps = (a, b) => a.date === b.date && minutes(a.start_time) < endOf(b) && minutes(b.start_time) < endOf(a);

// Returns a message naming the first two clashing courses, or null.
export function findClash(slots) {
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    if (overlaps(slots[i], slots[j])) return `${slots[i].code} and ${slots[j].code} are at the same date and time. Pick a different slot for one of them.`;
  }
  return null;
}
