// ─── Board exam survey ──────────────────────────────────────────────────────
// For BSAE graduates who sat the Aeronautical Engineering board exam: what
// came out, how well PATTS prepared them subject by subject, whether the mock
// exams helped, and what they wish the aero faculty had done. One place for
// the questions, so the student's Survey tab (src/StudentSurvey.jsx) and the
// instructor's Board Survey page (src/dashboard/BoardSurvey.jsx) always agree.
// Pure: no browser or Supabase imports. Needs sql/149. Which survey is
// running is set in ./boardSurveyId.js.
//
// Ids are stored in answers. Never reuse an id for a different option or
// question: add a new one instead.

export { SURVEY_ID, SURVEY_LABEL, SURVEY_PARAM } from './boardSurveyId.js';

const opts = (...pairs) => pairs.map(([id, label]) => ({ id, label }));

// ── Topics per subject ──────────────────────────────────────────────────────
const subject = s => ({ ...s, topics: s.groups.flatMap(g => g.topics) });

export const SUBJECTS = [
  subject({
    key: 'math', name: 'Mathematics', short: 'Math',
    example: 'e.g. two ships, N 30° E, find the distance',
    groups: [
      { label: 'Algebra and word problems', topics: opts(
        ['algebra', 'Algebra'], ['work', 'Work problems'], ['units', 'Unit conversion'],
        ['age', 'Age problems'], ['mixture', 'Mixture problems'], ['motion', 'Motion and rate problems'],
        ['logs', 'Logarithms'], ['remainder', 'Remainder and binomial theorems'],
        ['probstat', 'Probability and statistics'],
      ) },
      { label: 'Trigonometry and geometry', topics: opts(
        ['bearing', 'Bearing and azimuth'], ['crab', 'Heading, drift angle and ground speed'],
        ['trig', 'Trigonometry (sine and cosine laws)'], ['spherical', 'Spherical triangles'],
        ['lines', 'Lines, slope and distance between points'], ['conics', 'Conic sections'],
        ['plane_geo', 'Plane geometry'], ['solid_geo', 'Solid geometry'],
      ) },
      { label: 'Calculus and motion', topics: opts(
        ['integration', 'Integration'], ['maxmin', 'Maxima and minima'], ['area_curve', 'Area under the curve'],
        ['kinematics', 'Kinematics using derivatives'], ['derivatives', 'Derivatives (second, implicit, parametric)'],
        ['related_rates', 'Related rates'], ['solids_rev', 'Volume of solids of revolution'],
        ['moments', 'First moment and moment of inertia'], ['diffeq', 'Differential equations'],
        ['free_fall', 'Free fall'], ['rotation', 'Angular velocity and tip speed'],
      ) },
    ],
  }),
  subject({
    key: 'aero', name: 'Aerodynamics', short: 'Aero',
    example: 'e.g. wind tunnel, 1:10 model, test speed',
    groups: [
      { label: 'Problem solving', topics: opts(
        ['turning', 'Turning flight'], ['bank', 'Bank angle'],
        ['hydrostatic', 'Hydrostatic equation and standard atmosphere'], ['load_factor', 'Load factor'],
        ['cd_re', 'Drag coefficient and Reynolds number'], ['v_min_thrust', 'Velocity at minimum thrust required'],
        ['power_req', 'Power required and available'], ['wind_tunnel', 'Wind tunnel problems'],
        ['sound', 'Speed of sound and Mach number'], ['glauert', 'Prandtl–Glauert correction'],
        ['airspeeds', 'True, equivalent and calibrated airspeed'], ['bernoulli', 'Bernoulli and continuity'],
        ['climb_glide', 'Climb and glide'], ['time_climb', 'Time to climb and ceiling'],
        ['stall', 'Stall and maneuvering speed'], ['range', 'Range and endurance'],
        ['polar', 'Drag polar and maximum L/D'], ['thin_airfoil', 'Thin airfoil and flat plate'],
        ['cm', 'Moment coefficient of wing-body'], ['shocks', 'Shock waves and nozzles'],
      ) },
      { label: 'Concepts', topics: opts(
        ['mcrit', 'Critical Mach, drag divergence and transonic flow'],
        ['wing_geom', 'Aspect ratio, taper, sweep and winglets'], ['controls', 'Control surfaces, tabs and V-tail'],
        ['high_lift', 'Slats and flaps'], ['icing', 'Icing and stall'], ['props', 'Propellers and slipstream'],
        ['helicopter', 'Helicopter aerodynamics'],
      ) },
    ],
  }),
  subject({
    key: 'asd', name: 'Aircraft Structures and Design', short: 'Structures',
    example: 'e.g. truss, force in member AB, 60°, 5 kN',
    groups: [
      { label: 'Problem solving', topics: opts(
        ['truss', 'Statics: force in a truss member'], ['lemac', 'LEMAC / %MAC'], ['cg', 'CG location'],
        ['forces', 'Concurrent and parallel forces'], ['reactions', 'Support reactions'],
        ['shear_moment', 'Shear and bending moment'], ['stress_strain', 'Stress and strain'], ['torsion', 'Torsion'],
        ['section', 'Centroid and moment of inertia'], ['shear_center', 'Shear center and shear flow'],
        ['columns', 'Columns and buckling'], ['joints', 'Rivets, bolts and joints'], ['safety', 'Margin / factor of safety'],
      ) },
      { label: 'Design concepts', topics: opts(
        ['vn', 'V-n diagram and flight envelope'], ['gust', 'Gust loads and gust factor'],
        ['controls', 'Flight controls, tabs and ruddervators'], ['tail', 'Tail loads and stabilizers'],
        ['high_lift', 'Slats and flaps'], ['wing_design', 'Wing design'],
        ['aero_design', 'Aero concepts (L/D, drag polar, Mcrit)'], ['fuselage', 'Monocoque and semi-monocoque'],
        ['landing_gear', 'Landing gear'], ['fatigue', 'Fatigue, corrosion and damage'],
        ['design_phase', 'Conceptual and preliminary design'],
      ) },
    ],
  }),
  subject({
    key: 'pp', name: 'Powerplant', short: 'Powerplant',
    example: 'e.g. ideal gas, 2 m³ at 100 kPa to 500 kPa',
    groups: [
      { label: 'Problem solving', topics: opts(
        ['ideal_gas', 'Ideal and combined gas laws'], ['vol_eff', 'Volumetric efficiency'],
        ['prop_eff', 'Propeller efficiency'], ['thermal_eff', 'Thermal efficiency'], ['advance_ratio', 'Advance ratio'],
        ['processes', 'Gas processes and nonflow work'], ['cp_cv', 'cp, cv, R and specific heat ratio'],
        ['displacement', 'Displacement, clearance and compression ratio'],
        ['engine_power', 'Engine power (IHP, BHP, MEP)'], ['sfc', 'Specific fuel consumption'],
        ['otto_diesel', 'Otto and Diesel cycles'], ['brayton', 'Brayton cycle'],
        ['stirling', 'Carnot, Stirling and Ericsson cycles'], ['jet_thrust', 'Jet thrust and exit velocity'],
        ['rocket', 'Rocket thrust and nozzle area'], ['compressor', 'Compressor displacement'],
        ['std_atm', 'Standard atmosphere'], ['temp', 'Temperature conversion'],
        ['mechanics', 'Springs, kinematics and kinetics'],
      ) },
      { label: 'Concepts', topics: opts(
        ['turbofan', 'Turbojet, turbofan, turboprop and ramjet'], ['supercharging', 'Supercharging and critical altitude'],
        ['propellers', 'Propeller pitch and feathering'], ['detonation', 'Detonation and preignition'],
        ['fuel_ignition', 'Fuel and ignition systems'], ['lube_cooling', 'Lubrication and cooling'],
        ['starting', 'Starting systems and flameout'], ['thrust_rev', 'Thrust reversers'],
      ) },
    ],
  }),
  subject({
    key: 'acrm', name: 'Aircraft Construction, Repair and Modification', short: 'ACRM',
    example: 'e.g. NDT for surface cracks in aluminum',
    groups: [
      { label: 'Weight and balance', topics: opts(
        ['weight_balance', 'Weight and balance computation'],
        ['weights', 'Empty weight, payload, tare and residual fuel'], ['stations', 'Stations, datum and buttock lines'],
      ) },
      { label: 'Materials and processes', topics: opts(
        ['materials', 'Aircraft materials and alloys'], ['heat_treat', 'Metal identification and heat treatment'],
        ['welding', 'Forming, joining and welding'], ['composites', 'Composite materials'],
        ['plastics', 'Plastics'], ['finishes', 'Anodizing, plating and painting'], ['corrosion', 'Corrosion'],
        ['ndt', 'Hardness tests and NDT'],
      ) },
      { label: 'Hardware, structures and repair', topics: opts(
        ['hardware', 'Bolts, nuts, rivets and hardware'], ['sheet_metal', 'Sheet metal structures'],
        ['bend', 'Bend allowance and joggling'], ['joints', 'Types of joints and seams'], ['cables', 'Control cables'],
        ['tubing', 'Fluid lines, flaring and fittings'], ['hydraulics', 'Hydraulic systems'], ['tools', 'Shop tools'],
        ['repairs', 'Major and minor repairs'], ['gust_locks', 'Gust locks'],
        ['inspection', 'Inspections and maintenance records'],
      ) },
    ],
  }),
  subject({
    key: 'eemle', name: 'Engineering Economics and Management, Laws and Ethics', short: 'EEMLE',
    example: 'e.g. signing off work you did not check',
    groups: [
      { label: 'Economics and management', topics: opts(
        ['rask', 'RASK'], ['cask', 'CASK'], ['airline_finance', 'Financial stability of airlines'],
        ['econ', 'Interest, depreciation, break-even'], ['annuity', 'Annuities'], ['irr', 'IRR and rate of return'],
        ['capital', 'Authorized capital and shares'], ['costs', 'Production and development costs'],
        ['airline_perf', 'Airline performance'],
      ) },
      { label: 'Laws, regulations and ethics', topics: opts(
        ['pcar1', 'PCAR Part 1'], ['pcar_parts', 'Which PCAR Part covers what'], ['situational', 'Situational questions'],
        ['seaplanes', 'Amphibians and seaplanes'], ['ditching', 'Ditching'], ['vmin', 'Vmin'],
        ['lightning', 'Lightning arrester'], ['alternate', 'Alternate aerodrome'], ['ethics', 'Code of ethics'],
        ['pd1570', 'PD 1570 penalties'], ['freedoms', 'Freedoms of the air'],
        ['air_law', 'Chicago Convention and ICAO Annexes'], ['ra9497', 'RA 9497 (CAAP charter)'],
        ['caap_dg', 'Functions of the CAAP Director General'],
        ['definitions', 'Overhaul, rebuild, major repair definitions'], ['rts', 'Return to service and records'],
        ['categories', 'Aircraft category and class'], ['crew', 'Flight crew duty time'],
        ['emergency', 'Emergency landing loads'], ['vspeeds', 'V-speeds and rough air speed'],
        ['far', 'FAR Part 23 and 25'], ['aerodromes', 'Runways, PCN and aerodromes'],
      ) },
    ],
  }),
];

// ── Answer scales ───────────────────────────────────────────────────────────
// Four points, no middle: each one says which way it leans.
export const PREP = opts(['none', 'Not at all'], ['little', 'A little'], ['well', 'Well'], ['very', 'Very well']);
export const HELPFUL = opts(['none', 'Not helpful'], ['little', 'A little'], ['helpful', 'Helpful'], ['very', 'Very helpful']);
export const READY = opts(['none', 'Not ready'], ['little', 'A little'], ['ready', 'Ready'], ['very', 'Very ready']);
const YES_NO = opts(['yes', 'Yes'], ['no', 'No']);

/** Scales that average to a 1–4 score on the instructor's page. */
export const SCALES = { PREP, HELPFUL, READY };

// ── The steps ───────────────────────────────────────────────────────────────
// Each item is one question:
//   one   — pick one          answers.one[id]  = option id
//   many  — pick any          answers.many[id] = [option ids]   (max: a cap)
//   text  — type              answers.text[id] = string
// `when(answers)` hides a question until it applies. `groups` shows a many's
// options under small headings. `scale` marks a one that averages 1–4.

export const TEXT_MAX = 2000;

const subjectStep = s => ({
  id: s.key,
  title: s.name,
  short: s.short,
  items: [
    { kind: 'many', id: `topics_${s.key}`, q: 'Tick what came out', options: s.topics, groups: s.groups, subject: s.key },
    { kind: 'one', id: `prep_${s.key}`, q: 'How well did PATTS prepare you for it?', options: PREP, scale: 'PREP', subject: s.key },
    { kind: 'text', id: `recall_${s.key}`, q: 'What do you remember?', optional: true, subject: s.key,
      placeholder: `Questions, values or keywords. Fragments are fine, ${s.example}` },
    ...(s.key === 'asd' ? [{ kind: 'text', id: 'figures', q: 'Remember a statics figure? Describe it', optional: true, subject: s.key,
      placeholder: 'Truss, beam or frame; the supports; the loads and angles; what was asked' }] : []),
  ],
});

const tookMocks = a => a.one.mocks_taken !== 'none';

export const STEPS = [
  {
    id: 'you', title: 'About you', sub: 'About 5 minutes. Skip anything you don’t remember.',
    items: [
      { kind: 'one', id: 'result', q: 'Your result', optional: true, options: opts(
        ['passed', 'Passed'], ['not_passed', 'Did not pass'], ['waiting', 'Still waiting'], ['private', 'Prefer not to say']) },
      { kind: 'one', id: 'take', q: 'Was this your first take?', options: opts(['first', 'First take'], ['retake', 'Retake']) },
      { kind: 'one', id: 'graduated', q: 'Year you graduated from PATTS', options: opts(
        ['2026', '2026'], ['2025', '2025'], ['2024', '2024'], ['earlier', '2023 or earlier']) },
      { kind: 'one', id: 'review_len', q: 'How long did you review full-time?', options: opts(
        ['lt1', 'Under 1 month'], ['1to2', '1–2 months'], ['3to4', '3–4 months'], ['5plus', '5+ months']) },
      { kind: 'one', id: 'ready', q: 'How ready did you feel on exam day?', options: READY, scale: 'READY' },
      { kind: 'one', id: 'hardest', q: 'Which subject felt hardest?', options: SUBJECTS.map(s => ({ id: s.key, label: s.short })) },
    ],
  },
  ...SUBJECTS.map(subjectStep),
  {
    id: 'mocks', title: 'PATTS mock exams',
    items: [
      { kind: 'one', id: 'mocks_taken', q: 'How many did you take?', options: opts(
        ['none', 'None'], ['few', 'A few'], ['most', 'Most'], ['all', 'All of them']) },
      { kind: 'one', id: 'mocks_helpful', q: 'How helpful were they?', options: HELPFUL, scale: 'HELPFUL', when: tookMocks },
      { kind: 'one', id: 'mocks_prepared', q: 'Did they add to your preparedness for the boards?', when: tookMocks,
        options: opts(['a_lot', 'Yes, a lot'], ['somewhat', 'Somewhat'], ['not_really', 'Not really']) },
      { kind: 'one', id: 'mocks_level', q: 'Compared with the real exam, they were…', when: tookMocks,
        options: opts(['much_easier', 'Much easier'], ['easier', 'A bit easier'], ['same', 'About the same'], ['harder', 'Harder']) },
      { kind: 'one', id: 'mocks_match', q: 'Did their topics match what came out?', when: tookMocks,
        options: opts(['mostly', 'Mostly'], ['partly', 'Partly'], ['hardly', 'Hardly']) },
      { kind: 'many', id: 'mocks_best', q: 'Which subjects’ mock exams helped most?', when: tookMocks,
        options: SUBJECTS.map(s => ({ id: s.key, label: s.short })) },
      { kind: 'many', id: 'mocks_better', q: 'What would make them better?', options: opts(
        ['more', 'More mock exams'], ['full_length', 'Full-length and timed like the boards'],
        ['every_subject', 'One for every subject'], ['solutions', 'Worked solutions after'],
        ['earlier', 'Start them earlier'], ['harder', 'Harder, board-level problems'],
        ['figures', 'More problems with figures'], ['by_topic', 'Score breakdown by topic'],
        ['recent', 'Topics from recent boards']) },
      { kind: 'text', id: 'mocks_note', q: 'Anything else about the mock exams?', optional: true,
        placeholder: 'What worked, what didn’t' },
    ],
  },
  {
    id: 'faculty', title: 'Aero faculty',
    items: [
      { kind: 'many', id: 'used', q: 'What did you use to review?', options: opts(
        ['notes', 'PATTS notes and handouts'], ['mocks', 'PATTS mock exams'], ['center', 'Review center'],
        ['aerohub', 'AeroHub'], ['books', 'Review books'], ['videos', 'Online videos'], ['group', 'Group study']) },
      { kind: 'many', id: 'wished', q: 'What do you wish the aero faculty had done?', options: opts(
        ['review_class', 'A board review class in 4th year'], ['refresher', 'Refresher sessions after graduation'],
        ['board_problems', 'Board-type problems in regular classes'], ['coverage', 'Teach every board topic'],
        ['reviewers', 'Reviewers and formula sheets'], ['consult', 'Consultation hours'],
        ['study_plan', 'Help with a study plan'], ['passers', 'Talks from board passers'],
        ['prc', 'Guidance on the PRC application'], ['checkins', 'Check-ins and encouragement']) },
      { kind: 'text', id: 'faculty_wish', q: 'In your own words, what could we have done better?', optional: true,
        placeholder: 'A class, a topic, a habit, anything' },
      { kind: 'text', id: 'helped_most', q: 'What did PATTS do that helped you most?', optional: true,
        placeholder: 'A subject, an instructor’s method, a resource' },
      { kind: 'one', id: 'start_when', q: 'When should board preparation start?', options: opts(
        ['y3', '3rd year'], ['y4s1', '4th year, 1st sem'], ['y4s2', '4th year, 2nd sem'], ['after', 'After graduation']) },
    ],
  },
  {
    id: 'last', title: 'Last step',
    items: [
      { kind: 'one', id: 'recommend', q: 'Would you recommend PATTS BSAE to someone aiming for the boards?',
        options: opts(['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']) },
      { kind: 'one', id: 'mentor', q: 'Would you share tips with the next batch?', options: YES_NO },
      { kind: 'text', id: 'message', q: 'A message for the next batch', optional: true,
        placeholder: 'What you’d tell yourself a year ago' },
      { kind: 'one', id: 'share', q: 'May we share it with them?', when: a => !!(a.text.message || '').trim(),
        options: opts(['name', 'Yes, with my name'], ['anon', 'Yes, without my name'], ['no', 'No']) },
      { kind: 'one', id: 'show_name', q: 'Show your name to the faculty with these answers?',
        options: opts(['yes', 'Yes'], ['no', 'No, hide my name']) },
    ],
  },
];

export const ITEMS = STEPS.flatMap(s => s.items.map(it => ({ ...it, step: s.id })));
const BY_ID = new Map(ITEMS.map(it => [it.id, it]));
export const itemById = id => BY_ID.get(id);

// ── Answers ─────────────────────────────────────────────────────────────────
export const emptyAnswers = () => ({ one: {}, many: {}, text: {} });

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Keep only known questions, known options and bounded text, whatever was sent or stored. */
export function cleanAnswers(raw) {
  const a = obj(raw), one = obj(a.one), many = obj(a.many), text = obj(a.text);
  const out = emptyAnswers();
  for (const it of ITEMS) {
    if (it.kind === 'one' && has(one, it.id)) {
      if (it.options.some(o => o.id === one[it.id])) out.one[it.id] = one[it.id];
    } else if (it.kind === 'many' && Array.isArray(many[it.id])) {
      const ok = new Set(it.options.map(o => o.id));
      const ids = [...new Set(many[it.id].filter(x => typeof x === 'string' && ok.has(x)))];
      const capped = it.max ? ids.slice(0, it.max) : ids;
      if (capped.length) out.many[it.id] = capped;
    } else if (it.kind === 'text' && typeof text[it.id] === 'string') {
      const t = text[it.id].trim().slice(0, TEXT_MAX);
      if (t) out.text[it.id] = t;
    }
  }
  // An answer to a question that no longer shows (mock exams answered, then
  // "None" picked) is not counted.
  for (const it of ITEMS) {
    if (!isShown(it, out)) delete out[it.kind][it.id];
  }
  return out;
}

/** Is the question showing for these answers? */
export const isShown = (it, a) => !it.when || it.when(a);

/** Does any question on the step have an answer? */
export function stepAnswered(step, a) {
  return step.items.some(it => (it.kind === 'one' ? !!a.one[it.id]
    : it.kind === 'many' ? (a.many[it.id] || []).length > 0
      : !!(a.text[it.id] || '').trim()));
}

/** The name a faculty member sees: the student's only if they said yes. */
export const nameShown = a => a?.one?.show_name === 'yes';

// ── Tallies for the instructor's page ───────────────────────────────────────

/** Counts per option, in the question's own order. */
export function tally(item, list) {
  const n = new Map(item.options.map(o => [o.id, 0]));
  let answered = 0;
  for (const a of list) {
    const picks = item.kind === 'many' ? (a.many[item.id] || []) : (a.one[item.id] ? [a.one[item.id]] : []);
    if (picks.length) answered++;
    for (const p of picks) if (n.has(p)) n.set(p, n.get(p) + 1);
  }
  return { answered, rows: item.options.map(o => ({ id: o.id, label: o.label, n: n.get(o.id) })) };
}

/** A four-point scale's average, 1 (lowest) to 4 (highest); null when no one answered. */
export function scaleAverage(item, list) {
  const scale = SCALES[item.scale];
  if (!scale) return null;
  let sum = 0, count = 0;
  for (const a of list) {
    const i = scale.findIndex(o => o.id === a.one[item.id]);
    if (i >= 0) { sum += i + 1; count++; }
  }
  return count ? sum / count : null;
}

/** Share of answers that landed on the given options, 0–100; null when no one answered. */
export function shareOf(item, list, ids) {
  const { answered, rows } = tally(item, list);
  if (!answered) return null;
  const hit = rows.filter(r => ids.includes(r.id)).reduce((s, r) => s + r.n, 0);
  return Math.round((hit / answered) * 100);
}

/** The label(s) of an answer, for a table or a CSV cell. */
export function answerText(item, a) {
  if (item.kind === 'text') return a.text[item.id] || '';
  const label = id => item.options.find(o => o.id === id)?.label || '';
  if (item.kind === 'many') return (a.many[item.id] || []).map(label).filter(Boolean).join('; ');
  return label(a.one[item.id]);
}
