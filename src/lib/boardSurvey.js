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

// Grouped the way the PRC syllabus runs, with the problem types examinees
// recalled after the November 2026 exam named as they described them.
export const SUBJECTS = [
  subject({
    key: 'math', name: 'Mathematics', short: 'Math',
    example: 'e.g. two ships, N 30° E, find the distance',
    groups: [
      { label: 'Algebra', topics: opts(
        ['algebra', 'Algebra'], ['quadratic', 'Quadratic equations and roots'], ['logs', 'Logarithms'],
        ['remainder', 'Remainder and binomial theorems'], ['progressions', 'Arithmetic and geometric progressions'],
        ['variation', 'Variation and proportion'], ['complex', 'Complex numbers'],
        ['matrices', 'Matrices and determinants'], ['vectors', 'Vectors (dot and cross product)'],
      ) },
      { label: 'Word problems', topics: opts(
        ['work', 'Work problems'], ['units', 'Unit conversion'], ['age', 'Age problems'],
        ['mixture', 'Mixture problems'], ['motion', 'Motion and rate problems'], ['clock', 'Clock problems'],
        ['digits', 'Number and digit problems'],
      ) },
      { label: 'Trigonometry and navigation', topics: opts(
        ['bearing', 'Bearing and azimuth'], ['crab', 'Heading, drift angle and ground speed'],
        ['wind_triangle', 'Wind speed and direction from the wind triangle'],
        ['two_movers', 'Two ships or planes: distance apart after a time'],
        ['trig', 'Trigonometry (sine and cosine laws)'], ['elevation', 'Angles of elevation and depression'],
        ['identities', 'Trig identities and equations'], ['spherical', 'Spherical triangles'],
      ) },
      { label: 'Analytic and solid geometry', topics: opts(
        ['lines', 'Lines, slope and distance between points'], ['conics', 'Conic sections'],
        ['polar', 'Polar coordinates'], ['plane_geo', 'Plane geometry'], ['solid_geo', 'Solid geometry'],
      ) },
      { label: 'Differential calculus', topics: opts(
        ['limits', 'Limits and L’Hôpital’s rule'], ['deriv_quotient', 'Derivative of a fraction (quotient rule)'],
        ['derivatives', 'Derivatives (second, implicit, parametric)'], ['tangent_normal', 'Tangent and normal lines'],
        ['curvature', 'Radius of curvature'], ['maxmin', 'Maxima and minima'], ['related_rates', 'Related rates'],
        ['kinematics', 'Kinematics using derivatives'], ['partial', 'Partial derivatives'],
      ) },
      { label: 'Integral calculus', topics: opts(
        ['integration', 'Integration'], ['area_curve', 'Area under the curve'],
        ['solids_rev', 'Volume of solids of revolution'], ['arc_length', 'Length of an arc'],
        ['surface_rev', 'Surface area of revolution'], ['moments', 'First moment and moment of inertia'],
        ['work_calc', 'Work by a variable force (pumping, springs)'],
      ) },
      { label: 'Differential equations and motion', topics: opts(
        ['diffeq', 'Differential equations'], ['growth', 'Exponential growth and decay'],
        ['cooling', 'Newton’s law of cooling'], ['free_fall', 'Free fall'], ['projectile', 'Projectile motion'],
        ['rotation', 'Angular velocity and tip speed'],
      ) },
      { label: 'Probability and statistics', topics: opts(
        ['probstat', 'Probability and statistics'], ['counting', 'Permutations and combinations'],
        ['mean_sd', 'Mean, median and standard deviation'], ['distributions', 'Binomial and normal distributions'],
      ) },
    ],
  }),
  subject({
    key: 'aero', name: 'Aerodynamics', short: 'Aero',
    example: 'e.g. wind tunnel, 1:10 model, test speed',
    groups: [
      { label: 'Atmosphere and fluid flow', topics: opts(
        ['hydrostatic', 'Hydrostatic equation and standard atmosphere'],
        ['density_alt', 'Pressure and density altitude'], ['viscosity', 'Viscosity and fluid properties'],
        ['bernoulli', 'Bernoulli and continuity'], ['mass_flow', 'Mass flow rate and area–velocity relation'],
        ['dynamic_pressure', 'Dynamic and stagnation pressure'], ['pitot', 'Pitot-static tube and airspeed'],
        ['airspeeds', 'True, equivalent and calibrated airspeed'], ['cd_re', 'Drag coefficient and Reynolds number'],
        ['wind_tunnel', 'Wind tunnel problems'],
      ) },
      { label: 'Airfoils and wings', topics: opts(
        ['lift_eq', 'Lift equation (CL, area, speed)'], ['cp', 'Pressure coefficient'],
        ['circulation', 'Circulation and Kutta–Joukowski lift'], ['thin_airfoil', 'Thin airfoil and flat plate'],
        ['induced_drag', 'Induced drag, span efficiency and aspect ratio'], ['polar', 'Drag polar and maximum L/D'],
        ['skin_friction', 'Skin friction and boundary layer'], ['cm', 'Moment coefficient of wing-body'],
        ['naca', 'NACA airfoil numbers'],
      ) },
      { label: 'Performance', topics: opts(
        ['v_min_thrust', 'Velocity at minimum thrust required'], ['power_req', 'Power required and available'],
        ['climb_glide', 'Climb and glide'], ['time_climb', 'Time to climb and ceiling'],
        ['range', 'Range and endurance'], ['takeoff_landing', 'Takeoff and landing distance'],
        ['stall', 'Stall and maneuvering speed'], ['ground_effect', 'Ground effect'],
      ) },
      { label: 'Maneuvers', topics: opts(
        ['turning', 'Turning flight'], ['rate_turn', 'Rate and radius of turn'], ['bank', 'Bank angle'],
        ['load_factor', 'Load factor'], ['pull_up', 'Pull-up and pull-out'],
      ) },
      { label: 'High-speed flow', topics: opts(
        ['sound', 'Speed of sound and Mach number'], ['glauert', 'Prandtl–Glauert correction'],
        ['isentropic', 'Isentropic flow relations'], ['mach_angle', 'Mach angle and Mach waves'],
        ['shocks', 'Shock waves and nozzles'], ['mcrit', 'Critical Mach, drag divergence and transonic flow'],
        ['supersonic', 'Supersonic airfoils and area rule'],
      ) },
      { label: 'Stability, control and concepts', topics: opts(
        ['axes', 'Axes of rotation and the primary controls'], ['stability', 'Static and dynamic stability'],
        ['longitudinal', 'Neutral point and static margin'], ['lateral', 'Dihedral, Dutch roll and spiral'],
        ['adverse_yaw', 'Adverse yaw'], ['controls', 'Control surfaces, tabs and V-tail'],
        ['wing_geom', 'Aspect ratio, taper, sweep and winglets'], ['high_lift', 'Slats and flaps'],
        ['vortices', 'Wingtip vortices and wake turbulence'], ['icing', 'Icing and stall'],
        ['props', 'Propellers and slipstream'], ['helicopter', 'Helicopter aerodynamics'],
      ) },
    ],
  }),
  subject({
    key: 'asd', name: 'Aircraft Structures and Design', short: 'Structures',
    example: 'e.g. truss, force in member AB, 60°, 5 kN',
    groups: [
      { label: 'Statics', topics: opts(
        ['truss', 'Statics: force in a truss member'], ['forces', 'Concurrent and parallel forces'],
        ['rope_tension', 'Rope and cable tension with angles'], ['reactions', 'Support reactions'],
        ['moments_couples', 'Moments and couples'], ['frames', 'Frames and machines'], ['friction', 'Friction'],
        ['section', 'Centroid and moment of inertia'],
      ) },
      { label: 'Strength of materials', topics: opts(
        ['stress_strain', 'Stress and strain'], ['thermal_stress', 'Thermal stress'],
        ['pressure_vessel', 'Thin-walled pressure vessels (sphere, cylinder)'], ['torsion', 'Torsion'],
        ['shaft_key', 'Shafts and keys'], ['shear_moment', 'Shear and bending moment'],
        ['beams_mixed', 'Beams with uniform and concentrated loads'], ['bending_stress', 'Bending and shear stress in beams'],
        ['deflection', 'Beam deflection'], ['combined_stress', 'Combined stresses and Mohr’s circle'],
        ['columns', 'Columns and buckling'], ['safety', 'Margin / factor of safety'],
      ) },
      { label: 'Joints and aircraft structures', topics: opts(
        ['joints', 'Rivets, bolts and joints'], ['welds', 'Welded joints'],
        ['shear_center', 'Shear center and shear flow'], ['fuselage', 'Monocoque and semi-monocoque'],
        ['pressurization', 'Cabin pressurization loads'], ['landing_gear', 'Landing gear'],
        ['fatigue', 'Fatigue, corrosion and damage'], ['fail_safe', 'Fail-safe, safe-life and damage tolerance'],
      ) },
      { label: 'Weight, balance and loads', topics: opts(
        ['lemac', 'LEMAC / %MAC'], ['cg', 'CG location'], ['cg_shift', 'CG shift after adding or moving weight'],
        ['vn', 'V-n diagram and flight envelope'], ['load_categories', 'Load factors by category (normal, utility, acrobatic)'],
        ['gust', 'Gust loads and gust factor'], ['tail', 'Tail loads and stabilizers'],
      ) },
      { label: 'Design concepts', topics: opts(
        ['design_phase', 'Conceptual and preliminary design'], ['weight_est', 'Weight estimation and sizing'],
        ['wing_loading', 'Wing loading and power loading'], ['wing_design', 'Wing design'],
        ['stability_design', 'Static and dynamic stability'], ['controls', 'Flight controls, tabs and ruddervators'],
        ['high_lift', 'Slats and flaps'], ['aero_design', 'Aero concepts (L/D, drag polar, Mcrit)'],
        ['materials_asd', 'Material properties (yield, ultimate, modulus)'],
      ) },
    ],
  }),
  subject({
    key: 'pp', name: 'Powerplant', short: 'Powerplant',
    example: 'e.g. ideal gas, 2 m³ at 100 kPa to 500 kPa',
    groups: [
      { label: 'Thermodynamics', topics: opts(
        ['ideal_gas', 'Ideal and combined gas laws (PV = mRT)'], ['temp', 'Temperature conversion'],
        ['cp_cv', 'cp, cv, R and specific heat ratio'], ['processes', 'Gas processes and nonflow work'],
        ['first_law', 'First law and steady-flow energy'], ['entropy', 'Entropy and the second law'],
        ['std_atm', 'Standard atmosphere'], ['mechanics', 'Springs, kinematics and kinetics'],
      ) },
      { label: 'Cycles', topics: opts(
        ['air_standard', 'Air-standard efficiency from compression ratio'], ['otto_diesel', 'Otto and Diesel cycles'],
        ['brayton', 'Brayton cycle'], ['stirling', 'Carnot, Stirling and Ericsson cycles'],
        ['thermal_eff', 'Thermal efficiency'],
      ) },
      { label: 'Reciprocating engines', topics: opts(
        ['displacement', 'Displacement, clearance and compression ratio'], ['engine_power', 'Engine power (IHP, BHP, MEP)'],
        ['torque_power', 'Torque, RPM and power'], ['mech_eff', 'Mechanical efficiency and friction power'],
        ['vol_eff', 'Volumetric efficiency'], ['sfc', 'Specific fuel consumption'],
        ['fuel_air', 'Fuel–air ratio and heating value'], ['compressor', 'Compressor displacement'],
      ) },
      { label: 'Propellers', topics: opts(
        ['prop_eff', 'Propeller efficiency'], ['advance_ratio', 'Advance ratio'],
        ['prop_rpm', 'Propeller RPM, diameter and tip speed'], ['propellers', 'Propeller pitch and feathering'],
      ) },
      { label: 'Jets and rockets', topics: opts(
        ['jet_thrust', 'Jet thrust and exit velocity'], ['thrust_power', 'Thrust power and propulsive efficiency'],
        ['bypass', 'Bypass ratio'], ['turbine_work', 'Compressor and turbine work'],
        ['rocket', 'Rocket thrust and nozzle area'], ['turbofan', 'Turbojet, turbofan, turboprop and ramjet'],
      ) },
      { label: 'Systems and operation', topics: opts(
        ['engine_parts', 'Engine parts and firing order'], ['fuel_grades', 'Fuel grades, colors and weights (AVGAS, Jet A-1)'],
        ['carburetion', 'Carburetors, fuel injection and carb ice'], ['fuel_ignition', 'Fuel and ignition systems'],
        ['supercharging', 'Supercharging and critical altitude'], ['detonation', 'Detonation and preignition'],
        ['lube_cooling', 'Lubrication and cooling'], ['engine_instruments', 'Engine instruments (EGT, manifold pressure)'],
        ['starting', 'Starting systems and flameout'], ['thrust_rev', 'Thrust reversers'], ['apu', 'APU'],
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
        ['load_limits', 'Load factor limits (acrobatic, negative)'],
      ) },
      { label: 'Materials and processes', topics: opts(
        ['materials', 'Aircraft materials and alloys'], ['heat_treat', 'Metal identification and heat treatment'],
        ['welding', 'Forming, joining and welding'], ['composites', 'Composite materials'],
        ['plastics', 'Plastics'], ['wood_fabric', 'Wood, fabric and dope'], ['sealants', 'Sealants and adhesives'],
        ['finishes', 'Anodizing, plating and painting'], ['corrosion', 'Corrosion'], ['ndt', 'Hardness tests and NDT'],
      ) },
      { label: 'Hardware and sheet metal', topics: opts(
        ['hardware', 'Bolts, nuts, rivets and hardware'], ['rivet_layout', 'Rivet spacing, edge distance and pitch'],
        ['safety_wire', 'Safety wire, cotter pins and torque'], ['sheet_metal', 'Sheet metal structures'],
        ['bend', 'Bend allowance and joggling'], ['joints', 'Types of joints and seams'],
        ['oil_canning', 'Oil canning and skin buckling'],
      ) },
      { label: 'Systems', topics: opts(
        ['cables', 'Control cables'], ['tubing', 'Fluid lines, flaring and fittings'], ['hydraulics', 'Hydraulic systems'],
        ['gear_brakes', 'Tires, wheels and brakes'], ['electrical', 'Wiring and bonding'], ['oxygen', 'Oxygen systems'],
      ) },
      { label: 'Repair and maintenance', topics: opts(
        ['repairs', 'Major and minor repairs'], ['inspection', 'Inspections and maintenance records'],
        ['drawings', 'Aircraft drawings and blueprints'], ['tools', 'Shop tools'],
        ['ground_handling', 'Ground handling, jacking and mooring'], ['gust_locks', 'Gust locks'],
      ) },
      { label: 'Flight and operations', topics: opts(
        ['stability_axes', 'Stability and axes of the airplane'], ['flight_levels', 'Flight levels and altimeter settings'],
        ['charts', 'Jeppesen charts'],
      ) },
    ],
  }),
  subject({
    key: 'eemle', name: 'Engineering Economics and Management, Laws and Ethics', short: 'EEMLE',
    example: 'e.g. signing off work you did not check',
    groups: [
      { label: 'Engineering economics', topics: opts(
        ['econ', 'Interest, depreciation, break-even'], ['effective_rate', 'Nominal and effective rates'],
        ['annuity', 'Annuities'], ['depreciation', 'Depreciation methods (straight line, SYD, declining)'],
        ['worth', 'Present, annual and future worth'], ['irr', 'IRR and rate of return'],
        ['payback', 'Payback period'], ['bonds_loans', 'Bonds and loan amortization'],
        ['capitalized', 'Capitalized and annual cost'], ['inflation', 'Inflation'],
        ['econ_terms', 'Economics terms (supply, demand, market)'],
        ['capital', 'Authorized capital and shares'], ['costs', 'Production and development costs'],
      ) },
      { label: 'Airline economics', topics: opts(
        ['rask', 'RASK'], ['cask', 'CASK'], ['ask_rpk', 'ASK, RPK and passenger load factor'],
        ['airline_finance', 'Financial stability of airlines'], ['airline_perf', 'Airline performance'],
      ) },
      { label: 'Management', topics: opts(
        ['mgmt_functions', 'Management functions and organization'], ['project_mgmt', 'Project scheduling (CPM, PERT)'],
        ['contracts', 'Contracts and specifications'],
      ) },
      { label: 'Laws and regulations', topics: opts(
        ['pd1570', 'PD 1570 penalties'], ['practice', 'Professional practice and the AE board'],
        ['ra9497', 'RA 9497 (CAAP charter)'], ['caap_dg', 'Functions of the CAAP Director General'],
        ['pcar1', 'PCAR Part 1'], ['pcar2', 'PCAR Part 2 (personnel licensing)'],
        ['pcar4', 'PCAR Part 4 (registration and marking)'], ['pcar5', 'PCAR Part 5 (airworthiness)'],
        ['pcar6', 'PCAR Part 6 (maintenance organizations)'], ['pcar_parts', 'Which PCAR Part covers what'],
        ['air_law', 'Chicago Convention and ICAO Annexes'], ['freedoms', 'Freedoms of the air'],
        ['far', 'FAR Part 23 and 25'], ['dangerous_goods', 'Dangerous goods'],
      ) },
      { label: 'Airworthiness and operations', topics: opts(
        ['definitions', 'Overhaul, rebuild, major repair definitions'], ['rts', 'Return to service and records'],
        ['ad_sb', 'Airworthiness directives and service bulletins'], ['categories', 'Aircraft category and class'],
        ['vspeeds', 'V-speeds (Vref) and rough air speed'], ['vmin', 'Vmin'], ['crew', 'Flight crew duty time'],
        ['emergency', 'Emergency landing loads'], ['ditching', 'Ditching'], ['seaplanes', 'Amphibians and seaplanes'],
        ['alternate', 'Alternate aerodrome'], ['aerodromes', 'Runways, PCN and aerodromes'],
        ['lightning', 'Lightning arrester'],
      ) },
      { label: 'Ethics', topics: opts(
        ['ethics', 'Code of ethics'], ['situational', 'Situational questions (e.g. illegal acts)'],
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
        ['passed', 'Passed'], ['not_passed', 'Did not pass'], ['private', 'Prefer not to say']) },
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
        ['books', 'Review books'], ['videos', 'Online videos'], ['group', 'Group study']) },
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
