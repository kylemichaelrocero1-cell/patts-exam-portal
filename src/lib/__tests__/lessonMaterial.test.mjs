// Covers the lesson material helpers: the pre-migration fallback, upload
// validation, and the storage-path round trip. Node-only: no browser, no DOM.
//
//   npm run test:material

import {
  LESSON_COLUMNS_STUDENT, MAX_LESSON_FILE_BYTES,
  isMissingColumnError, normalizeLessonRow, isPdfLesson,
  validateLessonFile, lessonFilePath, storagePathFromUrl, formatFileSize,
  makeLessonReader, withMaterial,
} from '../lessonMaterial.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

console.log('\n=== MISSING-COLUMN DETECTION ===');
// The two shapes PostgREST actually returns on an un-migrated database.
check('42703 on select', isMissingColumnError(
  { code: '42703', message: 'column lessons.material_type does not exist' }));
check('PGRST204 on write', isMissingColumnError(
  { code: 'PGRST204', message: "Could not find the 'file_url' column of 'lessons' in the schema cache" }));
check('message alone is enough', isMissingColumnError(
  { message: 'column lessons.file_size does not exist' }));
// Anything else must propagate — swallowing it would hide a real breakage
// behind a silent fallback to fewer columns.
check('permission denied is not a missing column', !isMissingColumnError(
  { code: '42501', message: 'permission denied for table lessons' }));
check('missing TABLE is not a missing column', !isMissingColumnError(
  { code: '42P01', message: 'relation "public.lessons" does not exist' }));
check('null is not an error', !isMissingColumnError(null));

console.log('\n=== ROW NORMALISATION ===');
const legacy = normalizeLessonRow({ id: '1', title: 'Old', content_md: '# hi' });
check('pre-migration row reads as typed', legacy.material_type === 'typed');
check('pre-migration row has null file fields',
  legacy.file_url === null && legacy.file_name === null && legacy.file_size === null);
check('unknown material_type falls back to typed',
  normalizeLessonRow({ material_type: 'video' }).material_type === 'typed');
check('pdf survives normalisation',
  normalizeLessonRow({ material_type: 'pdf', file_url: 'u' }).material_type === 'pdf');
check('content_md is untouched', legacy.content_md === '# hi');

console.log('\n=== IS-PDF ===');
check('pdf with a file', isPdfLesson({ material_type: 'pdf', file_url: 'https://x/lesson-files/a.pdf' }));
// The one that matters: a lesson marked pdf whose upload never landed must not
// render an empty viewer — it falls back to whatever was typed.
check('pdf without a file is not a pdf lesson', !isPdfLesson({ material_type: 'pdf', file_url: null }));
check('typed is never a pdf lesson', !isPdfLesson({ material_type: 'typed', file_url: 'x.pdf' }));

console.log('\n=== FILE VALIDATION ===');
check('a real pdf passes', validateLessonFile(
  { name: 'AELP Module 1.pdf', type: 'application/pdf', size: 2 * 1024 * 1024 }) === null);
check('pdf by extension when the browser sends no type', validateLessonFile(
  { name: 'handout.PDF', type: '', size: 1000 }) === null);
check('a docx is refused', /Only PDF/.test(validateLessonFile(
  { name: 'notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1000 })));
check('an oversize pdf is refused', /limit is/.test(validateLessonFile(
  { name: 'scan.pdf', type: 'application/pdf', size: MAX_LESSON_FILE_BYTES + 1 })));
check('exactly at the limit is allowed', validateLessonFile(
  { name: 'scan.pdf', type: 'application/pdf', size: MAX_LESSON_FILE_BYTES }) === null);
check('nothing chosen is refused', typeof validateLessonFile(null) === 'string');

console.log('\n=== STORAGE PATHS ===');
const path = lessonFilePath('AELP Module 1.pdf', 'seed1');
check('keeps a readable name', path === 'seed1-AELP-Module-1.pdf', path);
check('always ends in .pdf', lessonFilePath('notes', 'seed1').endsWith('.pdf'));
check('strips directory traversal',
  !lessonFilePath('../../etc/passwd.pdf', 's').includes('..'), lessonFilePath('../../etc/passwd.pdf', 's'));
check('strips characters that break a URL',
  lessonFilePath('a b#c?d%e.pdf', 's') === 's-a-b-c-d-e.pdf', lessonFilePath('a b#c?d%e.pdf', 's'));
check('a name of pure punctuation still yields a file',
  lessonFilePath('###.pdf', 's') === 's-material.pdf', lessonFilePath('###.pdf', 's'));
check('long names are truncated', lessonFilePath('x'.repeat(300) + '.pdf', 's').length < 100);

const url = 'https://abc.supabase.co/storage/v1/object/public/lesson-files/inst-1/seed1-AELP-Module-1.pdf';
check('round-trips a public URL back to its key',
  storagePathFromUrl(url) === 'inst-1/seed1-AELP-Module-1.pdf', storagePathFromUrl(url));
check('decodes an escaped name',
  storagePathFromUrl('https://x/storage/v1/object/public/lesson-files/a/My%20File.pdf') === 'a/My File.pdf');
check('drops a query string',
  storagePathFromUrl(url + '?download=1') === 'inst-1/seed1-AELP-Module-1.pdf');
// Never guess: a bad parse here would delete the wrong object.
check('a foreign URL yields no path',
  storagePathFromUrl('https://elsewhere.example/file.pdf') === null);
check('the question-images bucket is not ours', storagePathFromUrl(
  'https://x/storage/v1/object/public/question-images/a.png') === null);
check('null URL yields no path', storagePathFromUrl(null) === null);

console.log('\n=== SIZE FORMATTING ===');
check('bytes', formatFileSize(512) === '512 B');
check('kilobytes', formatFileSize(2048) === '2 KB');
check('megabytes', formatFileSize(3 * 1024 * 1024) === '3.0 MB');
check('zero is not blank', formatFileSize(0) === '0 B');

console.log('\n=== READER FALLBACK ===');
// A fake supabase query builder: records what was asked for, then resolves.
const makeFrom = (responder) => {
  const calls = [];
  const from = () => ({
    select(columns) {
      const q = {
        columns,
        eq() { return q; },
        order() { return q; },
        range() { return q; },
        then(resolve) { calls.push(columns); return Promise.resolve(responder(columns)).then(resolve); },
      };
      return q;
    },
  });
  from.calls = calls;
  return from;
};

const migratedFrom = makeFrom(() => ({ data: [{ id: '1', material_type: 'pdf', file_url: 'u' }], error: null }));
const migrated = makeLessonReader(migratedFrom);
const rowsA = await migrated.select(LESSON_COLUMNS_STUDENT);
check('migrated database asks for the material columns',
  migratedFrom.calls[0] === withMaterial(LESSON_COLUMNS_STUDENT));
check('migrated rows come back as posted', rowsA[0].material_type === 'pdf');
check('probe records availability', migrated.available() === true);

const legacyFrom = makeFrom((columns) =>
  columns.includes('material_type')
    ? { data: null, error: { code: '42703', message: 'column lessons.material_type does not exist' } }
    : { data: [{ id: '1', title: 'Old' }], error: null });
const old = makeLessonReader(legacyFrom);
const rowsB = await old.select(LESSON_COLUMNS_STUDENT);
check('falls back to the base columns', legacyFrom.calls[1] === LESSON_COLUMNS_STUDENT);
check('fallback rows are normalised to typed', rowsB[0].material_type === 'typed');
check('probe records unavailability', old.available() === false);

await old.select(LESSON_COLUMNS_STUDENT);
check('the failed probe is not repeated', legacyFrom.calls.length === 3, legacyFrom.calls.join(' | '));

// A real failure must surface, not degrade into fewer columns.
const brokenFrom = makeFrom(() => ({ data: null, error: { code: '42501', message: 'permission denied for table lessons' } }));
let threw = false;
try { await makeLessonReader(brokenFrom).select(LESSON_COLUMNS_STUDENT); } catch { threw = true; }
check('a permission error is thrown, not swallowed', threw);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
