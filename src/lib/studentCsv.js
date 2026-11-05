// Reading a roster CSV: full_name, student_email, student_id, section, course.
// No supabase import, so it can be tested in Node.
import { COURSES, courseCode } from './courses.js';

export function parseStudentCSV(text) {
  const rawRows = text.trim().split(/\r?\n/);
  const rows = rawRows.map(row => {
    const cells = [];
    let cell = '', inQ = false;
    for (const ch of row) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
      else { cell += ch; }
    }
    cells.push(cell.trim());
    return cells;
  });
  const firstCell = rows[0]?.[0]?.toLowerCase().replace(/\s/g, '_');
  const dataRows = (firstCell === 'full_name' || firstCell === 'name') ? rows.slice(1) : rows;
  const students = [], errors = [];
  dataRows.forEach((cols, idx) => {
    const name = cols[0]?.trim();
    const email = cols[1]?.trim().toLowerCase();
    const code = cols[2]?.trim();
    const section = cols[3]?.trim();
    const courseText = cols[4]?.trim();
    if (!name && !email && !code && !section) return;
    const rowNum = idx + 2;
    if (!name) { errors.push(`Row ${rowNum}: Full name is required.`); return; }
    if (!email) { errors.push(`Row ${rowNum}: Email is required.`); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push(`Row ${rowNum}: "${email}" is not a valid email address.`); return; }
    if (!code) { errors.push(`Row ${rowNum}: Student ID is required.`); return; }
    if (!section) { errors.push(`Row ${rowNum}: Section is required.`); return; }
    // Optional, so a file from before the column still imports. Blank leaves
    // an existing student's course alone.
    const course = courseText ? courseCode(courseText) : null;
    if (courseText && !course) { errors.push(`Row ${rowNum}: "${courseText}" is not a course. Use one of: ${COURSES.map(c => c.code).join(', ')}.`); return; }
    students.push({ full_name: name, student_email: email, student_code: code, section, course });
  });
  // Flag in-file duplicates. One student listed twice for two different
  // sections is a class list, not a mistake — only the same person in the
  // same section twice is, so the section is part of what makes a row a
  // duplicate. The identity columns still have to agree with each other.
  const warnings = [];
  const seenRows = new Map(), seenEmails = new Map(), seenCodes = new Map();
  students.forEach((s, i) => {
    const key = `${s.student_email}||${s.section.toLowerCase()}`;
    if (seenRows.has(key)) errors.push(`Duplicate row in CSV: "${s.student_email}" is listed in "${s.section}" twice (rows ${seenRows.get(key) + 2} & ${i + 2})`);
    else seenRows.set(key, i);

    const emailFirst = seenEmails.get(s.student_email);
    if (emailFirst !== undefined && students[emailFirst].student_code !== s.student_code) {
      errors.push(`"${s.student_email}" is given two different Student IDs (rows ${emailFirst + 2} & ${i + 2})`);
    } else if (emailFirst === undefined) seenEmails.set(s.student_email, i);
    if (emailFirst !== undefined && s.course && students[emailFirst].course && students[emailFirst].course !== s.course) {
      errors.push(`"${s.student_email}" is given two different courses (rows ${emailFirst + 2} & ${i + 2})`);
    }

    // One Student ID against two different emails used to be an error. It is
    // not: two students really can share an ID (sql/014), and the email is
    // what tells them apart. Kept as a warning so a genuine typo still gets
    // looked at, but it no longer blocks the import.
    const codeFirst = seenCodes.get(s.student_code);
    if (codeFirst !== undefined && students[codeFirst].student_email !== s.student_email) {
      warnings.push(`Student ID "${s.student_code}" is shared by ${students[codeFirst].student_email} and ${s.student_email} (rows ${codeFirst + 2} & ${i + 2}). They will be imported as two students.`);
    } else if (codeFirst === undefined) seenCodes.set(s.student_code, i);
  });
  const noCourse = students.filter(s => !s.course).length;
  if (noCourse > 0) warnings.push(`${noCourse} row${noCourse === 1 ? ' has' : 's have'} no course. A new student stays on each paper's own grade base until a course is set; an existing student keeps their course.`);
  return { students, errors, warnings };
}
