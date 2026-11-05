// Course spellings and the roster CSV's course column.
//   npm run test:courses
import { COURSES, courseCode, isEngineeringCourse } from '../courses.js';
import { parseStudentCSV } from '../studentCsv.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== SPELLINGS ===');
check('every code and full name reads as itself', COURSES.every(c => courseCode(c.code) === c.code && courseCode(c.name) === c.code));
check("the class record's spellings", courseCode("PRE-ENG'G") === "PRE-ENG'G" && courseCode('BSAvTech') === 'BSAvTech' && courseCode('BSAirTrans') === 'BSAirTrans');
check('case and spaces do not matter', courseCode(' bsae ') === 'BSAE' && courseCode('pre eng') === "PRE-ENG'G" && courseCode('bs air transportation') === 'BSAirTrans');
check('a course not on the list is refused', courseCode('BSCS') === null && courseCode('') === null && courseCode(null) === null);
check('only BSAE and Pre-Engineering read the BSAE setting',
  COURSES.filter(c => isEngineeringCourse(c.code)).map(c => c.code).join() === "BSAE,PRE-ENG'G");

console.log('\n=== THE CSV COLUMN ===');
const H = 'full_name,student_email,student_id,section,course';
{
  const r = parseStudentCSV(`${H}\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -1,bsae\n"Dizon, Rey",rey@p.ph,2021-1-2,Sample -1,"PRE-ENG'G"`);
  check('reads and tidies the course', r.errors.length === 0 && r.students[0].course === 'BSAE' && r.students[1].course === "PRE-ENG'G", JSON.stringify(r));
  check('no warning when all have one', r.warnings.length === 0, JSON.stringify(r.warnings));
}
{
  const r = parseStudentCSV('full_name,student_email,student_id,section\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -1');
  check('a file from before the column still imports', r.errors.length === 0 && r.students[0].section === 'Sample -1');
  check('with a null course, so a batch insert keeps one shape', 'course' in r.students[0] && r.students[0].course === null);
  check('and says the course is missing', r.warnings.some(w => /no course/.test(w)), JSON.stringify(r.warnings));
}
{
  const r = parseStudentCSV(`${H}\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -1,BSCS`);
  check('an unknown course stops the row and names the choices', r.students.length === 0 && /"BSCS" is not a course/.test(r.errors[0]) && /BSAMT/.test(r.errors[0]), JSON.stringify(r.errors));
}
{
  const r = parseStudentCSV(`${H}\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -1,BSAE\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -2,BSAMT`);
  check('one student given two courses is an error', r.errors.some(e => /two different courses/.test(e)), JSON.stringify(r.errors));
}
{
  const r = parseStudentCSV(`${H}\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -1,BSAE\n"Cruz, Ana",ana@p.ph,2021-1-1,Sample -2,BSAE`);
  check('one student in two sections on one course is fine', r.errors.length === 0 && r.students.length === 2, JSON.stringify(r.errors));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
