// How a person's name is shown. Rosters arrive as "Surname , Given Middle" —
// a stray space before the comma — or with no comma at all, and the raw
// string was printed as-is: "Welcome, Reyes , Juan", "Hello, Reyes", and an
// avatar reading "A," because the comma was taken for a letter. The column
// itself is left alone; this only tidies what is drawn.

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** { surname, given } when the name is written "Surname, Given"; else null. */
function splitSurnameFirst(raw) {
  const s = tidy(raw);
  const at = s.indexOf(',');
  if (at < 0) return null;
  const surname = s.slice(0, at).trim();
  const given = s.slice(at + 1).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!surname || !given) return null;
  return { surname, given };
}

/** "Reyes , Juan Miguel" -> "Reyes, Juan Miguel"; a name without a comma is only tidied. */
export function formatName(raw) {
  const p = splitSurnameFirst(raw);
  if (p) return `${p.surname}, ${p.given}`;
  return tidy(raw).replace(/^,+|,+$/g, '').trim();
}

/** The name to greet someone by: the first given name where the order is known. */
export function givenName(raw) {
  const p = splitSurnameFirst(raw);
  const words = (p ? p.given : formatName(raw)).split(' ').filter(Boolean);
  return words[0] || '';
}

/** Two letters for an avatar, built from the name's words, never its punctuation. */
export function nameInitials(raw) {
  const p = splitSurnameFirst(raw);
  const letter = (w) => (String(w).match(/\p{L}|\p{N}/u) || [''])[0];
  if (p) {
    return (letter(p.given) + letter(p.surname)).toUpperCase() || '?';
  }
  const words = formatName(raw).split(' ').map(letter).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0] + words[words.length - 1] : words[0]).toUpperCase();
}

/**
 * An instructor's name for the dashboard. An account made without a display
 * name carries only its email, which was printed whole ("Welcome back,
 * juan.cruz@school.example."); its local part reads as a name instead.
 */
export function instructorName(raw) {
  const s = tidy(raw);
  if (!s.includes('@')) return formatName(s);
  const words = s.split('@')[0].split(/[._\-+\d]+/).filter(Boolean);
  if (!words.length) return s;
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
