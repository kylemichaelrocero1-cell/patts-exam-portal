// Seed data for the demo build. Entirely invented — no real student, no real
// score, and no real answer key. The questions are deliberately generic so the
// demo can be public without giving anything away about an actual exam.

const now = Date.now();
const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export const DEMO_SECTION = 'AENG DEMO-1';

export const demoStudent = {
  id: 'stu-demo-0001',
  full_name: 'Juan Dela Cruz',
  section: DEMO_SECTION,
  student_email: 'juan.delacruz@demo.local',
  student_code: '2026-1-0001',
  session_token: null,
};

export const demoInstructor = {
  id: 'ins-demo-0001',
  email: 'instructor@demo.local',
  full_name: 'Demo Instructor',
};

// A handful of classmates so the instructor views have something to show.
export const demoUsers = [
  demoStudent,
  { id: 'stu-demo-0002', full_name: 'Maria Santos',   section: DEMO_SECTION, student_email: 'maria@demo.local',  student_code: '2026-1-0002' },
  { id: 'stu-demo-0003', full_name: 'Jose Rizal',     section: DEMO_SECTION, student_email: 'jose@demo.local',   student_code: '2026-1-0003' },
  { id: 'stu-demo-0004', full_name: 'Andres Bonifacio', section: DEMO_SECTION, student_email: 'andres@demo.local', student_code: '2026-1-0004' },
  { id: 'stu-demo-0005', full_name: 'Gabriela Silang', section: DEMO_SECTION, student_email: 'gab@demo.local',   student_code: '2026-1-0005' },
];

export const demoAssessments = [
  {
    id: 'asm-demo-quiz', kind: 'seatwork',
    title: 'Seatwork 1 — Units and Conversions',
    description: 'Short practice set. Try the interface here first.',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_open: true, opens_at: null, closes_at: null,
    duration_minutes: 15, has_password: false, exam_password: null,
    created_at: iso(-3 * DAY),
  },
  {
    id: 'asm-demo-exam', kind: 'exam',
    title: 'Practice Exam — Aerodynamics Basics',
    description: 'A full-length practice exam so you can see the exam screen.',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_open: true, opens_at: null, closes_at: null,
    duration_minutes: 30, has_password: false, exam_password: null,
    created_at: iso(-2 * DAY),
  },
  {
    id: 'asm-demo-sched', kind: 'seatwork',
    title: 'Seatwork 2 — Opens Later (scheduling demo)',
    description: 'Shows what a scheduled assessment looks like before it opens.',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_open: true, opens_at: iso(2 * DAY), closes_at: iso(3 * DAY),
    duration_minutes: 20, has_password: false, exam_password: null,
    created_at: iso(-1 * DAY),
  },
];

// Generic aviation-flavoured questions. Nothing here is from a real paper.
const q = (id, assessment_id, n, text, a, b, c, d, correct) => ({
  id, exam_id: assessment_id, assessment_id, question_number: n,
  question_text: text, question_type: 'multiple_choice', category: null,
  choice_a: a, choice_b: b, choice_c: c, choice_d: d,
  correct_answer: correct, image_url: null, created_at: iso(-3 * DAY),
});

export const demoQuestions = [
  q('q-d-1', 'asm-demo-quiz', 1, 'One nautical mile is closest to how many metres?', '1000 m', '1609 m', '1852 m', '2000 m', 2),
  q('q-d-2', 'asm-demo-quiz', 2, 'Standard sea-level pressure in the ISA is:', '1013.25 hPa', '1000 hPa', '950 hPa', '1100 hPa', 0),
  q('q-d-3', 'asm-demo-quiz', 3, 'Convert 100 knots to approximate km/h:', '154 km/h', '185 km/h', '100 km/h', '212 km/h', 1),
  q('q-d-4', 'asm-demo-quiz', 4, 'ISA sea-level temperature is:', '0 °C', '15 °C', '20 °C', '25 °C', 1),
  q('q-d-5', 'asm-demo-quiz', 5, 'One foot equals how many metres?', '0.3048 m', '0.254 m', '0.5 m', '1.0 m', 0),

  q('q-e-1', 'asm-demo-exam', 1, 'Lift is generated primarily by:', 'Engine thrust', 'A pressure difference across the wing', 'Aircraft weight', 'Tail surfaces', 1),
  q('q-e-2', 'asm-demo-exam', 2, 'The angle between the chord line and the relative wind is the:', 'Dihedral', 'Angle of incidence', 'Angle of attack', 'Sweep angle', 2),
  q('q-e-3', 'asm-demo-exam', 3, 'A stall occurs when:', 'The engine stops', 'The critical angle of attack is exceeded', 'Airspeed reaches Vne', 'Flaps are extended', 1),
  q('q-e-4', 'asm-demo-exam', 4, 'Induced drag is greatest at:', 'High speed', 'Low speed / high angle of attack', 'Cruise', 'Zero lift', 1),
  q('q-e-5', 'asm-demo-exam', 5, 'Aspect ratio is defined as:', 'Span squared over area', 'Chord over span', 'Area over span', 'Span over thickness', 0),
  q('q-e-6', 'asm-demo-exam', 6, 'Which control surface controls roll?', 'Rudder', 'Elevator', 'Ailerons', 'Flaps', 2),
];

export const demoSubjects = [
  { id: 'sub-demo-1', title: 'Aerodynamics', description: null, target_section: DEMO_SECTION, instructor_id: demoInstructor.id, sort_order: 1, created_at: iso(-5 * DAY) },
  { id: 'sub-demo-2', title: 'Aircraft Systems', description: null, target_section: DEMO_SECTION, instructor_id: demoInstructor.id, sort_order: 2, created_at: iso(-5 * DAY) },
];

export const demoLessons = [
  {
    id: 'les-demo-1', subject_id: 'sub-demo-1',
    title: 'How a Wing Makes Lift',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_published: true, published_at: iso(-4 * DAY), sort_order: 1,
    created_at: iso(-4 * DAY), updated_at: iso(-4 * DAY),
    content_md: `# How a Wing Makes Lift

A wing turns the air downward. By Newton's third law, the air pushes the wing
**up**. The same effect can be described through the pressure difference between
the upper and lower surfaces.

## The lift equation

$$L = \\tfrac{1}{2}\\,\\rho\\,V^2\\,S\\,C_L$$

| Symbol | Meaning | Unit |
|---|---|---|
| $\\rho$ | air density | kg/m³ |
| $V$ | true airspeed | m/s |
| $S$ | wing area | m² |
| $C_L$ | lift coefficient | – |

Notice that lift varies with the **square** of airspeed — doubling speed
quadruples lift, all else equal.

## Things to remember

- $C_L$ rises with angle of attack, up to the **critical angle**.
- Past that angle the flow separates and the wing *stalls*.
- A stall is about **angle**, not speed. You can stall at any airspeed.

> Try Seatwork 1 once you have read this — it covers the units used above.
`,
  },
  {
    id: 'les-demo-2', subject_id: 'sub-demo-1',
    title: 'Angle of Attack and the Stall',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_published: true, published_at: iso(-2 * DAY), sort_order: 2,
    created_at: iso(-2 * DAY), updated_at: iso(-2 * DAY),
    content_md: `## Angle of Attack

The **angle of attack** ($\\alpha$) is the angle between the chord line and the
relative wind. It is *not* the same as pitch attitude.

1. As $\\alpha$ increases, so does $C_L$ — at first.
2. At the critical angle (roughly 15° for many aerofoils), flow separates.
3. Beyond that, $C_L$ drops sharply: the stall.

### Recovery

- Reduce the angle of attack — lower the nose.
- Add power as appropriate.
- Level the wings once flying again.

\`\`\`
Remember: an aircraft always stalls at the same ANGLE,
never at the same SPEED.
\`\`\`
`,
  },
  {
    id: 'les-demo-3', subject_id: 'sub-demo-2',
    title: 'Reading the Airspeed Indicator',
    target_section: DEMO_SECTION, instructor_id: demoInstructor.id,
    is_published: true, published_at: iso(-1 * DAY), sort_order: 3,
    created_at: iso(-1 * DAY), updated_at: iso(-1 * DAY),
    content_md: `## Airspeed, four ways

- **IAS** — what the instrument reads.
- **CAS** — IAS corrected for position and instrument error.
- **EAS** — CAS corrected for compressibility.
- **TAS** — EAS corrected for density altitude.

As you climb, TAS increases for a given IAS because the air thins.

### Colour markings

| Marking | Meaning |
|---|---|
| White arc | Flap operating range |
| Green arc | Normal operating range |
| Yellow arc | Caution — smooth air only |
| Red line | $V_{NE}$, never exceed |
`,
  },
];

// One classmate result per assessment so instructor views are not empty.
// The demo student has none, so they can take the assessments themselves.
export const demoResults = [
  { id: 'res-d-1', student_id: 'stu-demo-0002', exam_id: 'asm-demo-quiz', assessment_id: 'asm-demo-quiz', score: 4, total_items: 5, answers_json: {}, time_taken_seconds: 420, tab_switches: 0, violation_logs: [], submitted_at: iso(-2 * DAY), created_at: iso(-2 * DAY) },
  { id: 'res-d-2', student_id: 'stu-demo-0003', exam_id: 'asm-demo-quiz', assessment_id: 'asm-demo-quiz', score: 3, total_items: 5, answers_json: {}, time_taken_seconds: 510, tab_switches: 1, violation_logs: [], submitted_at: iso(-2 * DAY), created_at: iso(-2 * DAY) },
  { id: 'res-d-3', student_id: 'stu-demo-0004', exam_id: 'asm-demo-quiz', assessment_id: 'asm-demo-quiz', score: 5, total_items: 5, answers_json: {}, time_taken_seconds: 300, tab_switches: 0, violation_logs: [], submitted_at: iso(-1 * DAY), created_at: iso(-1 * DAY) },
  { id: 'res-d-4', student_id: 'stu-demo-0002', exam_id: 'asm-demo-exam', assessment_id: 'asm-demo-exam', score: 4, total_items: 6, answers_json: {}, time_taken_seconds: 1200, tab_switches: 0, violation_logs: [], submitted_at: iso(-1 * DAY), created_at: iso(-1 * DAY) },
  { id: 'res-d-5', student_id: 'stu-demo-0005', exam_id: 'asm-demo-exam', assessment_id: 'asm-demo-exam', score: 2, total_items: 6, answers_json: {}, time_taken_seconds: 900, tab_switches: 3, violation_logs: [], submitted_at: iso(-1 * DAY), created_at: iso(-1 * DAY) },
];

export function buildDemoTables() {
  // Deep-cloned so a demo session's writes never mutate the seed and a reload
  // always returns a clean portal.
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    users: clone(demoUsers),
    instructors: clone([demoInstructor]),
    exams: clone(demoAssessments),        // the fallback path reads this name
    assessments: clone(demoAssessments),
    questions: clone(demoQuestions),
    results: clone(demoResults),
    live_sessions: [],
    lessons: clone(demoLessons),
    lesson_subjects: clone(demoSubjects),
    lesson_progress: [],
    exam_shares: [],
    section_instructors: [],
  };
}
