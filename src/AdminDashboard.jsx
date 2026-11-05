import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import Icon from './components/Icon';
import SectionPicker from './components/SectionPicker';
import { supabase } from './supabase';
import { splitSections, mySectionsOf as sliceMine, mergeSections } from './lib/sectionScope';
import { makeRosterIndex, resolveStudent } from './lib/studentIdentity';
import { choicesOf, letterFor, choicesPatch, keyIsValid } from './lib/choices';
import { QUESTION_TYPES, isMultiSelect, indexSet, acceptedSetOf, toggleIndex,
         isSelected, keySetIsValid, isAnswerCorrect, answersPayload } from './lib/answers';
import { assessmentsTableAvailable, selectAssessments, INSTRUCTOR_COLUMNS,
         updateAssessment, setAssessmentArchived,
         isMissingFunctionError, isMissingTableError } from './lib/assessments';
import { removalPrompt, removalSummary, purgeLabel, TRASH_DAYS } from './lib/removeStudents';
import { violationFeed, hasSavedWork as sessionHasWork, canDismissSession } from './lib/proctoring';
import { COURSES } from './lib/courses';
import { paperNoun } from './lib/paperNoun';
import { parseStudentCSV } from './lib/studentCsv';
import { combinedScore, gradeBaseOf, gradeVerdict, isWorkedSolution, withGradeBases, workedKeyOf, workedItemStats } from './lib/workedShape';
import { compareByScore, compareBySubmitted, resultStatistics, scoreFraction, PASS_MARK } from './lib/resultsStats';
import { rowsMissingWork, workPatchFrom } from './lib/workRecovery';
import { submittedDateTime, shortDateTime } from './lib/examDates';
import { RESULTS_CSV_HEADERS, resultsCsvRow } from './lib/resultsExport';
import { firstAttempts } from './lib/retakes';
import { managedCounts, managedPapers, paperOptions, resultInView } from './lib/paperFilter';
import { formatName, nameInitials, instructorName as displayInstructor } from './lib/personName';
import { quantityParts } from './lib/quantityAnswer.js';
import { sittingSection, sectionOptions, filterLive, compareLive, compareWaiting } from './lib/liveMonitor';
import { isWaitingNow, waitedFor } from './lib/admission';
import { normaliseSetLabel, questionsForSet, setOfAnswers, inSet, setsOf, setsLabel } from './lib/paperSets';
// Extracted from this file so it can be tested against the format's own
// regression cases; the behaviour of a positional file is unchanged.
import { parseQuestionCSV } from './lib/questionCsv';
import CsvGuide, { CsvErrors } from './components/CsvGuide';
import { csvImportSummary } from './lib/csvGuide';
// Lazy: pulls in react-markdown + KaTeX, ~600kB that the exam flow never needs.
// Students load this same bundle to sit exams, often on poor connections, so the
// markdown stack stays out of the initial download and arrives only when an
// instructor actually opens Lessons.
const LessonsManager = lazy(() => import('./dashboard/LessonsManager'));
// Pure presentation over data the dashboard already holds — no queries of its
// own — but split out because it is a large view most sessions never open.
const ClassReview = lazy(() => import('./dashboard/ClassReview'));
const RescoreModal = lazy(() => import('./dashboard/RescoreModal'));
// Both pull in MathLive and Compute Engine — well over three megabytes of
// maths editor and computer algebra. Split out hard, so an instructor who
// never writes a worked item never downloads any of it.
const WorkedRubricEditor = lazy(() => import('./dashboard/WorkedRubricEditor'));
// Rendering stored LaTeX in the question list. Lazy with the rest of the
// maths chunk, so a paper of plain multiple choice never fetches KaTeX.
const MathStatic = lazy(() => import('./components/MathField.jsx')
  .then(m => ({ default: m.MathStatic })));
// A typed answer as it was meant: a word for a text item (sql/046), set in
// upright type, and maths for everything else.
const TypedShown = ({ q, value }) => (q?.work_rubric?.mode === 'text'
  ? <span className="ws-text-shown">{value}</span>
  : <MathStatic latex={value} />);
// A problem answered as quantities (sql/105), for the instructor: each part
// with the value and unit the key holds.
const QuantityKey = ({ q }) => (
  <ol className="ws-qty-parts" style={{ margin: '4px 0 8px', width: '100%' }}>
    {quantityParts(q.work_given).map(p => {
      const part = (q.work_rubric?.parts || []).find(x => x.key === p.key);
      return (
        <li key={p.key} className="ws-qty-part" style={{ gap: 2 }}>
          <span className="ws-qty-label" style={{ fontSize: 13 }}><span className="ws-qty-key">{p.key})</span> {p.label}</span>
          <span style={{ fontSize: 13, color: part ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
            {part ? `${part.value} ${part.units?.[0] || ''}` : 'No key for this part'}
            {part?.units?.length > 1 && (
              <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · +{part.units.length - 1} other spelling{part.units.length === 2 ? '' : 's'}</span>
            )}
          </span>
        </li>
      );
    })}
  </ol>
);
const WorkedMarking = lazy(() => import('./dashboard/WorkedMarking'));
const ReviewSettings = lazy(() => import('./dashboard/ReviewSettings'));
const PracticeResults = lazy(() => import('./dashboard/PracticeResults'));
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

// PostgREST caps every response at 1000 rows (Supabase's db-max-rows default).
// A query that can exceed that silently drops the overflow, and with no ORDER BY
// the rows that survive are whatever order the heap hands back — so entire exams
// disappear from the dashboard at random. Page through instead, ordered by the
// primary key so paging is stable across requests.
//
// PAGE_SIZE must stay BELOW the server cap: we treat a short page as "last page",
// so asking for more than the server will ever return would end the loop after
// one page and silently truncate again.
const PAGE_SIZE = 500;
async function fetchAllRows(buildQuery) {
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(all.length, all.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

export default function AdminDashboard({ instructorId, instructorName, onLogout }) {
  // Navigation State
  const [activeView, setActiveView] = useState('results');
  // A new view opens at its top. Moving on from a long scrolled list opened
  // the next one part-way down, with its heading and filters out of sight.
  const dashPanelRef = useRef(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    dashPanelRef.current?.scrollTo?.({ top: 0 });
  }, [activeView]);
  // On a phone the sidebar is a drawer behind a menu button (index.css,
  // .dash-side); on anything wider it is always there and this does nothing.
  const [sideOpen, setSideOpen] = useState(false);
  useEffect(() => {
    if (!sideOpen) return;
    const onKey = e => { if (e.key === 'Escape') setSideOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sideOpen]);

  // Data States
  const [results, setResults] = useState([]);
  // Retakeable papers write to review_attempts, never results (results carries
  // UNIQUE(student_id, exam_id) and must stay the graded record). Class Review
  // has to see both or a whole cohort of mock exams reads as "nothing submitted".
  const [practiceAttempts, setPracticeAttempts] = useState([]);
  const [examsList, setExamsList] = useState([]); // Holds full exam data for the Manage tab
  const [examsDict, setExamsDict] = useState({}); // Holds just titles for the Results tab
  const [students, setStudents] = useState({});
  const [studentsList, setStudentsList] = useState([]); // Holds the array for the table
  const [liveSessions, setLiveSessions] = useState([]); // NEW: Live Monitor Data
const [editingStudentSections, setEditingStudentSections] = useState({});
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [batchSection, setBatchSection] = useState('');
  const [batchCourse, setBatchCourse] = useState('');
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [liveSort, setLiveSort] = useState('name');
  const [waitingSort, setWaitingSort] = useState('name');   // check-in list: name | section | arrival
  // Students waiting to be let in to a paper (sql/115), and the monitor's filters.
  const [admissions, setAdmissions] = useState([]);
  const [deciding, setDeciding] = useState({});
  const [admissionClock, setAdmissionClock] = useState(() => Date.now());
  const [liveFilter, setLiveFilter] = useState({ section: '', paper: '', status: '', query: '' });
  const [liveViolationTooltip, setLiveViolationTooltip] = useState(null); // { session, rect }
  const [resultSort, setResultSort] = useState('section');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter States
  const [selectedSection, setSelectedSection] = useState('All');
  const [selectedExam, setSelectedExam] = useState('All');
  // The paper picker (src/lib/paperFilter.js): a course first, and archived
  // papers only on request — in the picker and in the rows alike.
  const [selectedCourse, setSelectedCourse] = useState('All');
  const [showArchivedResults, setShowArchivedResults] = useState(false);
  const [resultQuery, setResultQuery] = useState('');
  // On a phone the Results filters fold away behind one button (index.css).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [studentSectionFilter, setStudentSectionFilter] = useState('All');

  // Edit Time State
  const [editingTimes, setEditingTimes] = useState({});
  const [editingSections, setEditingSections] = useState({});
  const [editingPasswords, setEditingPasswords] = useState({});
  const [qShowArchived, setQShowArchived] = useState(false);
  // The Trash (sql/104): deleted papers and students wait here 30 days.
  const [trashRows, setTrashRows] = useState([]);
  const [restoringTrash, setRestoringTrash] = useState(null);
  const purgedRef = useRef(false);
  // Passwords are masked until asked for: the dashboard is often on a
  // projector or a screen the class can see.
  const [shownPasswords, setShownPasswords] = useState(() => new Set());
  const [copiedPassword, setCopiedPassword] = useState(null);
  const [editingTitles, setEditingTitles] = useState({});
  // --- NEW: Create Exam States ---
const [newTitle, setNewTitle] = useState('');
const [targetSection, setTargetSection] = useState('');
  const [reviewSettingsFor, setReviewSettingsFor] = useState(null);
  const [newKind, setNewKind] = useState('exam');          // 'exam' | 'seatwork'
  const [newOpensAt, setNewOpensAt] = useState('');        // datetime-local
  const [newClosesAt, setNewClosesAt] = useState('');
  const [newDuration, setNewDuration] = useState(60);
  const [newGradeBase, setNewGradeBase] = useState(50);       // other courses, 0 | 50 (sql/138)
  // BSAE and Pre-Eng'g (sql/145). Follows the paper's type until it is chosen.
  const [newGradeBaseAe, setNewGradeBaseAe] = useState(null);
  const shownNewBaseAe = newGradeBaseAe ?? (paperNoun({ kind: newKind, title: newTitle }) === 'Exam' ? 0 : 50);

  // --- NEW ANALYTICS STATES ---
  const [viewingStudent, setViewingStudent] = useState(null);
  const [viewingStatsExam, setViewingStatsExam] = useState(null);
  const [examQuestionsCache, setExamQuestionsCache] = useState({});
  const [statsSet, setStatsSet] = useState(null);   // the set Item Analysis shows
  const [answersJsonCache, setAnswersJsonCache] = useState({}); // keyed by `studentId_examId`
  // Item analysis on a practice paper: each student's first attempt's
  // answers_json, keyed by paper. Refetched on every open — practice keeps
  // coming in, and a cached copy would quietly go stale.
  const [practiceStatsCache, setPracticeStatsCache] = useState({});
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  // --- ATTENDANCE STATES ---
  // Attendance opens on the newest open paper rather than an empty page —
  // that is almost always the one being taken. null until the instructor
  // picks, so a deliberate "Choose an exam" is not overridden.
  const [attendanceChoice, setAttendanceExam] = useState(null);
  const attendanceExam = attendanceChoice ?? (examsList
    .filter(e => e.is_open && !e.archived_at)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]?.id || '');
  const [attendanceSection, setAttendanceSection] = useState('All');

  // --- QUESTION MANAGEMENT STATES ---
  const [qExamId, setQExamId] = useState('');
  const [qList, setQList] = useState([]);
  const [qLoading, setQLoading] = useState(false);
  const [qSaving, setQSaving] = useState(false);
  const [editingQ, setEditingQ] = useState(null); // null = add mode, object = edit mode
  // An item carries any number of choices (sql/016), so the form holds a list.
  // Four is the starting point because that is what most papers use.
  //
  // Both keys are held at once and only the one the type uses is saved
  // (sql/018 keeps them mutually exclusive in the database). That way
  // switching between Multiple Choice and Multiple Answers and back does not
  // throw away what was already ticked.
  // Scripts whose worked items nobody has marked yet. combinedScore() is the
  // single definition of "pending" — a row is waiting when it carries marks
  // available and no marks awarded.
  const scriptsToMark = results.filter(r => combinedScore(r).pending > 0).length;

  const emptyQ = {
    question_text: '', choice_list: ['', '', '', ''], correct_answer: 0,
    correct_answers: [], question_type: 'multiple_choice', image_url: null,
    // Other choices that also earn a one-answer item (sql/130).
    also_correct: [],
    // What the item is worth (sql/025). One unless the instructor says
    // otherwise, which is what every item was worth before points existed.
    marks: 1,
    // A worked item (sql/024). `work` is the rubric as the editor holds it;
    // it is written to questions.work_rubric, and to the three public columns
    // beside it, only when the type says worked_solution.
    work: { given: '', variable: 'x', marks: 3,
            steps: [{ latex: '', marks: 1, label: '' }], accept: [] },
    // A text answer (sql/046): the word, and the other words accepted, one
    // per line. Written as a worked_solution rubric with mode 'text'.
    text: { answer: '', accept: '' },
    // Which set the item is in (sql/116); '' is every set.
    set_label: '',
  };
  const instructorExamIdsRef = useRef(new Set());
  const [qForm, setQForm] = useState(emptyQ);
  // The question list, one set at a time (sql/116); '' shows every item.
  const [qSetFilter, setQSetFilter] = useState('');
  const [qImageFile, setQImageFile] = useState(null);
  const [qImageUploading, setQImageUploading] = useState(false);
  const [qImagePreview, setQImagePreview] = useState(null);

  // --- CSV IMPORT STATES ---
  const [csvParsed, setCsvParsed] = useState(null);       // { questions, errors } for Questions tab
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvReplaceMode, setCsvReplaceMode] = useState(false);
  const [csvExamParsed, setCsvExamParsed] = useState(null); // { questions, errors } attached to Create Exam form
  // Archived papers are hidden from Manage Exams by default. They are still
  // in examsList, so results and class review keep working on them.
  const [showArchived, setShowArchived] = useState(false);
  // Manage Exams: find a paper (src/lib/paperFilter.js).
  const [manageQuery, setManageQuery] = useState('');
  const [manageStatus, setManageStatus] = useState('all');
  const [studentCsvParsed, setStudentCsvParsed] = useState(null); // { students, errors, warnings } for Students tab
  const [studentCsvImporting, setStudentCsvImporting] = useState(false);
  // Every section this instructor teaches: their exams' targets, the sections
  // they have explicitly claimed (see claimSections), and the ones another
  // instructor co-assigned them. Exams are no longer the only thing keeping a
  // section — and therefore its roster — alive.
  const [instructorSections, setInstructorSections] = useState(new Set());
  // Sections claimed in section_instructors as (me, added_by = me). These are
  // what survive when the last exam for a section is deleted.
  const [claimedSections, setClaimedSections] = useState(new Set());

  // A student's `section` column lists EVERY section they belong to, including
  // ones run by other instructors — a student can sit in Esci 316 here and in
  // AENG 223L with a colleague. This instructor may only see and edit their own
  // slice of that list:
  //   * showing the whole list leaks colleagues' section names into the roster,
  //     the filters and the section pickers;
  //   * saving the whole list back after editing only their own slice would
  //     quietly un-enrol the student from the colleague's class.
  // So split the list in two everywhere, and rejoin on save. The rules live in
  // src/lib/sectionScope.js and are tested there — npm run test:sections-scope.
  const mySectionsOf = (str) => sliceMine(str, instructorSections);

  // --- ADD STUDENT STATES ---
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentSection, setNewStudentSection] = useState('');
  const [newStudentCourse, setNewStudentCourse] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // --- DUPLICATE STATES ---
  const [dupModal, setDupModal] = useState(null); // source exam object | null
  const [dupTitle, setDupTitle] = useState('');
  const [dupSection, setDupSection] = useState('');
  const [dupAssignTo, setDupAssignTo] = useState('self');
  const [isDuplicating, setIsDuplicating] = useState(false);

  // --- TRANSFER STATES ---
  const [instructorsList, setInstructorsList] = useState([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferExamIds, setTransferExamIds] = useState(new Set());
  const [isTransferring, setIsTransferring] = useState(false);

  // --- SHARING STATES ---
  const [shareModal, setShareModal] = useState(null); // exam object | null
  const [rescoreFor, setRescoreFor] = useState(null); // exam object | null — sql/131
  const [shareTarget, setShareTarget] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [sharesMap, setSharesMap] = useState({}); // { [examId]: [{ id, shared_with }] }
  const [sharedExamsList, setSharedExamsList] = useState([]); // exams shared WITH me
  // Every score on this dashboard is read through these, so each row's
  // percentage and verdict are on its own paper's grade base (sql/138). The
  // raw rows stay in state: realtime and the marking screens write to those.
  const gradedResults = useMemo(
    () => withGradeBases(results, [...examsList, ...sharedExamsList], id => students[id]?.course),
    [results, examsList, sharedExamsList, students]);
  const gradedAttempts = useMemo(
    () => withGradeBases(practiceAttempts, [...examsList, ...sharedExamsList], id => students[id]?.course),
    [practiceAttempts, examsList, sharedExamsList, students]);

  // --- SECTION CO-INSTRUCTOR STATES ---
  const [sectionCoModal, setSectionCoModal] = useState(null); // section name string | null
  const [sectionCoTarget, setSectionCoTarget] = useState('');
  const [isSectionCoSaving, setIsSectionCoSaving] = useState(false);
  // { [sectionName]: [{ id, instructor_id, added_by }] } for sections I own
  const [sectionCoMap, setSectionCoMap] = useState({});

  // Helper to load questions — uses a separate loading state so the dashboard never disappears
  const loadExamQuestions = async (examId) => {
    if (examQuestionsCache[examId]) return examQuestionsCache[examId];
    setIsLoadingQuestions(true);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId)
      .order('id', { ascending: true });
    setIsLoadingQuestions(false);
    if (error) {
      alert('Failed to load questions: ' + error.message);
      return [];
    }
    setExamQuestionsCache(prev => ({ ...prev, [examId]: data || [] }));
    return data || [];
  };

  const openStudentDetails = async (row) => {
    const cacheKey = `${row.student_id}_${row.exam_id}`;
    setIsLoadingQuestions(true);
    const [, answersJson] = await Promise.all([
      loadExamQuestions(row.exam_id),
      (async () => {
        if (answersJsonCache[cacheKey] !== undefined) return answersJsonCache[cacheKey];
        const { data } = await supabase
          .from('results')
          .select('answers_json')
          .eq('student_id', row.student_id)
          .eq('exam_id', row.exam_id)
          .single();
        const json = data?.answers_json || {};
        setAnswersJsonCache(prev => ({ ...prev, [cacheKey]: json }));
        return json;
      })(),
    ]);
    setIsLoadingQuestions(false);
    setViewingStudent({ ...row, answers_json: answersJson });
  };

  // The answers the item analysis counts, one answers_json per student. The
  // graded sittings when there are any — a paper later opened for retakes
  // keeps its real exam as the thing analysed — otherwise, on a practice
  // paper, each student's first attempt (see firstAttempts).
  // The items a filed paper was sat with: on a paper in sets (sql/116), the
  // student's set — read from their answers — and the items in every set.
  const sittingQuestions = (examId, answers) => {
    const qs = examQuestionsCache[examId] || [];
    return questionsForSet(qs, setOfAnswers(qs, answers));
  };

  const statsSourceFor = (examId) => {
    const graded = results.filter(r => r.exam_id === examId);
    if (graded.length === 0 && practiceStatsCache[examId]) {
      return { practice: true, answers: practiceStatsCache[examId] };
    }
    return {
      practice: false,
      answers: graded.map(r => answersJsonCache[`${r.student_id}_${examId}`] || {}),
    };
  };

  const openExamStats = async (examId) => {
    setIsLoadingQuestions(true);
    const examResults = results.filter(r => r.exam_id === examId);
    try {
      await Promise.all([
        loadExamQuestions(examId),
        (async () => {
          const uncached = examResults.filter(r => answersJsonCache[`${r.student_id}_${examId}`] === undefined);
          if (uncached.length === 0) return;
          const data = await fetchAllRows(() => supabase
            .from('results')
            .select('student_id, answers_json')
            .eq('exam_id', examId));
          setAnswersJsonCache(prev => {
            const next = { ...prev };
            data.forEach(r => { next[`${r.student_id}_${examId}`] = r.answers_json || {}; });
            return next;
          });
        })(),
        // A practice paper files every sitting in review_attempts and nothing
        // in results, so the analysis read an empty list and drew every option
        // at 0%. Only fetched when there is no graded sitting to show instead.
        (async () => {
          if (!examAllowsRetakes(examId) || examResults.length > 0) return;
          const data = await fetchAllRows(() => supabase
            .from('review_attempts')
            .select('student_id, attempt_no, answers_json')
            .eq('assessment_id', examId));
          setPracticeStatsCache(prev => ({
            ...prev,
            [examId]: firstAttempts(data).map(r => r.answers_json || {}),
          }));
        })(),
      ]);
    } catch (err) {
      console.error('Failed to load exam stats:', err);
    }
    setIsLoadingQuestions(false);
    setStatsSet(null);
    setViewingStatsExam(examId);
  };

  useEffect(() => {
    // fetchDashboardData first — it populates instructorExamIdsRef which fetchLiveSessions depends on
    fetchDashboardData().then(() => { fetchLiveSessions(); fetchAdmissions(); });
    fetchInstructors();

    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions' }, payload => {
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
        if (payload.new.status === 'finished') {
          setLiveSessions(prev => prev.filter(s => s.id !== payload.new.id));
          return;
        }
        setLiveSessions(prev => {
          const exists = prev.some(s => s.id === payload.new.id);
          if (exists) {
            return prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
          }
          // Session dismissed but student still active — restore only for our exams
          return [...prev, payload.new];
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_sessions' }, payload => {
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
        if (payload.new.status !== 'finished') {
          setLiveSessions(prev => {
            // Skip if we already have a session for this student+exam
            const isDuplicate = prev.some(s =>
              s.student_id === payload.new.student_id && s.exam_id === payload.new.exam_id
            );
            if (isDuplicate) return prev;
            return [...prev, payload.new];
          });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_sessions' }, payload => {
        setLiveSessions(prev => prev.filter(s => s.id !== payload.old.id));
      })
      // Students asking to be let in (sql/115). Only waiting requests are
      // kept; one decided or withdrawn leaves the list.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_admissions' }, payload => {
        const row = payload.new && payload.new.id ? payload.new : null;
        if (!row) { setAdmissions(prev => prev.filter(r => r.id !== payload.old?.id)); return; }
        if (!instructorExamIdsRef.current.has(row.assessment_id)) return;
        setAdmissions(prev => {
          const rest = prev.filter(r => r.id !== row.id);
          return row.status === 'waiting' ? [...rest, row] : rest;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'results' }, payload => {
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
        setResults(prev => [...prev, payload.new]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'results' }, payload => {
        setResults(prev => prev.map(r =>
          r.student_id === payload.new.student_id && r.exam_id === payload.new.exam_id
            ? { ...r, ...payload.new }
            : r
        ));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'results' }, payload => {
        setResults(prev => prev.filter(r =>
          !(r.student_id === payload.old.student_id && r.exam_id === payload.old.exam_id)
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Students waiting to be let in: the realtime feed above carries each
  // change; this catches a dropped connection while any paper has check-in
  // on, and the clock ages out a tab that was closed (lib/admission.js).
  const anyCheckIn = examsList.some(e => e.requires_admission);
  useEffect(() => {
    if (!anyCheckIn) return undefined;
    const t = setInterval(() => { fetchAdmissions(); setAdmissionClock(Date.now()); }, 15000);
    return () => clearInterval(t);
    // fetchAdmissions reads a ref, so the latest papers are always used.
  }, [anyCheckIn]);
  useEffect(() => {
    if (admissions.length === 0) return undefined;
    const t = setInterval(() => setAdmissionClock(Date.now()), 5000);
    return () => clearInterval(t);
  }, [admissions.length]);

  // Who is waiting to be let in (sql/115). A table that is not there yet
  // (115 not run) is simply nobody waiting.
  const fetchAdmissions = async () => {
    const examIds = [...instructorExamIdsRef.current];
    if (examIds.length === 0) { setAdmissions([]); return; }
    const { data, error } = await supabase.from('exam_admissions')
      .select('id, assessment_id, student_id, student_name, status, requested_at, seen_at')
      .eq('status', 'waiting').in('assessment_id', examIds);
    if (error) {
      if (!isMissingTableError(error)) console.error('Failed to load students waiting to enter:', error);
      return;
    }
    setAdmissions(data || []);
  };

  const decideAdmission = async (request, allow) => {
    setDeciding(d => ({ ...d, [request.id]: true }));
    const { error } = await supabase.rpc('decide_admission', { p_request_id: request.id, p_allow: allow });
    setDeciding(d => { const next = { ...d }; delete next[request.id]; return next; });
    if (error) {
      console.error('Could not decide admission:', error);
      alert(`Could not ${allow ? 'let in' : 'turn away'} ${formatName(request.student_name) || 'this student'}. Please try again.`);
      return;
    }
    // Decided, or already decided elsewhere: either way it leaves the list.
    setAdmissions(prev => prev.filter(r => r.id !== request.id));
  };

  const fetchLiveSessions = async () => {
    const examIds = [...instructorExamIdsRef.current];
    if (examIds.length === 0) { setLiveSessions([]); return; }
    let data;
    try {
      data = await fetchAllRows(() => supabase.from('live_sessions').select('*').neq('status', 'finished').in('exam_id', examIds));
    } catch (err) {
      console.error('Failed to load live sessions:', err);
      return; // keep the last good snapshot rather than blanking the monitor
    }
    if (data) {
      // Deduplicate by student+exam: prefer locked status, then most recently updated
      const sessionMap = new Map();
      data.forEach(s => {
        const key = `${s.student_id}_${s.exam_id}`;
        const existing = sessionMap.get(key);
        if (!existing) {
          sessionMap.set(key, s);
        } else if (s.status === 'locked' && existing.status !== 'locked') {
          sessionMap.set(key, s);
        } else if (existing.status !== 'locked') {
          const existTime = new Date(existing.updated_at || 0).getTime();
          const newTime = new Date(s.updated_at || 0).getTime();
          if (newTime > existTime) sessionMap.set(key, s);
        }
      });
      const deduped = [...sessionMap.values()];
      setLiveSessions(deduped.sort((a, b) => (a.student_name || '').localeCompare(b.student_name || '')));
    }
  };

  const toggleStudentLock = async (sessionId, currentStatus) => {
    const newStatus = currentStatus === 'locked' ? 'active' : 'locked';
    // Optimistic update — realtime doesn't echo back the instructor's own writes
    setLiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: newStatus } : s));
    const { error } = await supabase.from('live_sessions').update({ status: newStatus, updated_at: new Date() }).eq('id', sessionId);
    if (error) {
      // Roll back optimistic update on failure
      setLiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: currentStatus } : s));
      alert('Failed to update lock status: ' + error.message);
    }
  };

  // The section a student is sitting a paper under: their sections the
  // paper is for — never a colleague's (see lib/liveMonitor.js).
  const sittingSectionOf = (studentId, paperId) =>
    sittingSection(students[studentId]?.section, examsList.find(e => e.id === paperId)?.target_section);

  // A paper in sets is analysed one set at a time, as a student sat it: that
  // set's items and the shared ones, numbered from 1. Listing every set at
  // once read as one paper with every version's problems in it.
  const statsQuestions = examQuestionsCache[viewingStatsExam] || [];
  const statsSets = setsOf(statsQuestions);
  const statsShownSet = statsSets.includes(statsSet) ? statsSet : (statsSets[0] || null);
  const statsShownQuestions = questionsForSet(statsQuestions, statsShownSet);

  const printAnalysis = () => {
    const zone = document.querySelector('.print-zone');
    if (!zone) { window.print(); return; }
    const printRoot = document.createElement('div');
    printRoot.id = 'analysis-print-root';
    printRoot.innerHTML = zone.innerHTML;
    document.body.appendChild(printRoot);
    document.body.classList.add('analysis-printing');
    const cleanup = () => {
      document.body.removeChild(printRoot);
      document.body.classList.remove('analysis-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  // Dismiss takes a row off the monitor and files NOTHING. It was written back
  // when a locked or timed-out sitting had no other way out; force submit and
  // the auto-sweep do that job now, so the only thing left for it is a ghost —
  // a row whose paper is already on file, or one a student opened and walked
  // away from without answering anything. canDismissSession() is what keeps it
  // off a student who is mid-paper, where clicking it used to make them vanish
  // from the monitor with their answers unsubmitted.
  const dismissSession = async (session) => {
    // sittingAlreadyFiled(), not a bare results lookup: on a paper with retakes
    // on, the graded row is history and the sitting in front of you is live
    // work that must not be dismissible.
    const hasResult = sittingAlreadyFiled(session);

    if (!canDismissSession(session, { hasResult })) {
      return alert(
        `${session.student_name || 'This student'} has answers saved on this paper.\n\n` +
        'Dismissing would take them off the monitor without submitting anything, so their ' +
        'work would never be marked. Use Force Submit instead — it files what they have ' +
        'answered so far.'
      );
    }

    if (!window.confirm(
      hasResult
        ? `Clear ${session.student_name || 'this student'} from the monitor?\n\n` +
          'Their paper is already submitted and marked — this only removes the leftover row.'
        : `Dismiss ${session.student_name || 'this student'}?\n\n` +
          'Nothing has been answered, so nothing is lost and nothing is submitted. ' +
          'If their tab is still open they will reappear here within a few seconds — ' +
          'a dismiss only clears a row nobody is sitting behind.'
    )) return;

    const { error } = await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', session.id);
    if (error) { alert('Failed to dismiss session: ' + error.message); return; }
    setLiveSessions(prev => prev.filter(s => s.id !== session.id));
  };

  // --- SECTION CO-INSTRUCTOR FUNCTIONS ---
  const addSectionCoInstructor = async () => {
    if (!sectionCoModal || !sectionCoTarget) return;
    if (sectionCoTarget === instructorId) return alert('You cannot add yourself as a co-instructor.');
    setIsSectionCoSaving(true);
    const { error } = await supabase.from('section_instructors').insert([{
      section_name: sectionCoModal,
      instructor_id: sectionCoTarget,
      added_by: instructorId,
    }]);
    setIsSectionCoSaving(false);
    if (error) {
      if (error.code === '23505') return alert('That instructor already has access to this section.');
      return alert('Error adding co-instructor: ' + error.message);
    }
    setSectionCoMap(prev => {
      const updated = { ...prev };
      if (!updated[sectionCoModal]) updated[sectionCoModal] = [];
      updated[sectionCoModal] = [...updated[sectionCoModal], { instructor_id: sectionCoTarget, added_by: instructorId, section_name: sectionCoModal }];
      return updated;
    });
    setSectionCoTarget('');
  };

  const removeSectionCoInstructor = async (row) => {
    const { error } = await supabase.from('section_instructors').delete()
      .eq('section_name', row.section_name)
      .eq('instructor_id', row.instructor_id)
      .eq('added_by', instructorId);
    if (error) return alert('Error removing co-instructor: ' + error.message);
    setSectionCoMap(prev => {
      const updated = { ...prev };
      updated[row.section_name] = (updated[row.section_name] || []).filter(r => r.instructor_id !== row.instructor_id);
      return updated;
    });
  };

  // --- SECTION OWNERSHIP ---
  // A section used to exist only for as long as an exam pointed at it, so a
  // student added to a section with no exam was invisible, and deleting the
  // last exam of a section took its whole roster out of the dashboard — while
  // the students stayed in the database, still able to log in, with no way for
  // anyone to reach them. Claiming writes the instructor-section link down as
  // its own row, so the roster no longer depends on an exam existing.
  const claimSections = async (raw) => {
    const names = [...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .flatMap(v => (v || '').split(',').map(x => x.trim()))
        .filter(Boolean)
    )];
    const fresh = names.filter(n => !claimedSections.has(n));
    if (fresh.length === 0) return;

    setClaimedSections(prev => new Set([...prev, ...fresh]));
    setInstructorSections(prev => new Set([...prev, ...fresh]));

    // ignoreDuplicates keeps this ON CONFLICT DO NOTHING: the row may already
    // exist from an earlier session, and the table has no UPDATE policy for an
    // upsert to fall back on.
    const { error } = await supabase.from('section_instructors').upsert(
      fresh.map(section_name => ({ section_name, instructor_id: instructorId, added_by: instructorId })),
      { onConflict: 'section_name,instructor_id,added_by', ignoreDuplicates: true },
    );
    if (error) {
      // Put it back, or a failed claim would look claimed and never retry.
      setClaimedSections(prev => { const n = new Set(prev); fresh.forEach(x => n.delete(x)); return n; });
      console.error('Could not record section ownership:', error);
    }
  };

  // The way back out, so a typo'd section is not permanent. Only ever offered
  // for a section that has nothing left in it.
  const releaseSection = async (sec) => {
    const inList = (str) => (str || '').split(',').map(x => x.trim()).includes(sec);
    const studentCount = studentsList.filter(s => inList(s.section)).length;
    const examCount = [...examsList, ...sharedExamsList].filter(e => inList(e.target_section)).length;
    if (studentCount > 0 || examCount > 0) {
      return alert(
        `"${sec}" still has ${studentCount} student${studentCount !== 1 ? 's' : ''} and ` +
        `${examCount} exam${examCount !== 1 ? 's' : ''}.\n\n` +
        'Move or delete them first — releasing a section that still has students would hide them from everyone.'
      );
    }
    const coCount = (sectionCoMap[sec] || []).length;
    if (!window.confirm(
      `Remove "${sec}" from your sections?\n\nIt is empty — no students, no exams.` +
      (coCount > 0 ? `\n\nThis also ends the co-instructor access you granted for it (${coCount}).` : '')
    )) return;

    const { error } = await supabase.from('section_instructors').delete()
      .eq('section_name', sec).eq('added_by', instructorId);
    if (error) return alert('Error removing section: ' + error.message);

    setClaimedSections(prev => { const n = new Set(prev); n.delete(sec); return n; });
    setInstructorSections(prev => { const n = new Set(prev); n.delete(sec); return n; });
    setSectionCoMap(prev => { const n = { ...prev }; delete n[sec]; return n; });
    if (studentSectionFilter === sec) setStudentSectionFilter('All');
  };

  const clearStuckSessions = async () => {
    // Same carve-out as the monitor's own filter: on a paper with retakes on, a
    // graded row is history, not a sign that the sitting in front of you has
    // already been submitted. Sweeping those would end live retakes.
    const stuckIds = liveSessions.filter(sittingAlreadyFiled).map(s => s.id);
    if (stuckIds.length === 0) return alert("No stuck sessions found.");
    await supabase.from('live_sessions').update({ status: 'finished' }).in('id', stuckIds);
    setLiveSessions(prev => prev.filter(s => !stuckIds.includes(s.id)));
  };

  // --- FORCE SUBMIT ---
  // One place to resolve an exam, so a duration or a retake flag is never read
  // from only half the papers this instructor can see (own + shared/co-taught).
  const findExamById = (examId) =>
    examsList.find(e => e.id === examId) || sharedExamsList.find(e => e.id === examId) || null;

  const examDurationFor = (examId) =>
    Number(editingTimes[examId]) || Number(findExamById(examId)?.duration_minutes) || 0;

  const examAllowsRetakes = (examId) => !!findExamById(examId)?.allow_retakes;

  // Is the paper behind this live row already settled?
  //
  // A graded row in `results` only settles a sitting on a paper that does NOT
  // allow retakes. Once retakes are on, that row is history — the sitting in
  // front of you is a new attempt, which submit_assessment() files in
  // review_attempts and which never touches `results` at all. Reading a graded
  // row as "already submitted" is what made a re-opened paper invisible in the
  // monitor, unforce-submittable, and liable to be swept as a stuck session.
  const sittingAlreadyFiled = (session) =>
    !examAllowsRetakes(session.exam_id) &&
    results.some(r => r.student_id === session.student_id && r.exam_id === session.exam_id);

  // Returns true if a live session has run past the exam's time limit.
  // extraGraceMs is for the automatic sweep: the student's own tab submits at
  // 0:00, so waiting a little longer keeps the two from racing into two attempts.
  const isSessionTimedOut = (session, extraGraceMs = 0) => {
    const duration = examDurationFor(session.exam_id);
    if (!duration || !session.created_at) return false;
    const deadline = new Date(session.created_at).getTime() + duration * 60 * 1000 + 30000 + extraGraceMs;
    return Date.now() > deadline;
  };

  // Whole minutes still on a student's clock, or null when the paper has no
  // duration to measure against. Used to say plainly how much time an early
  // force-submit is taking off each student.
  const minutesLeftFor = (session) => {
    const duration = examDurationFor(session.exam_id);
    if (!duration || !session.created_at) return null;
    const deadline = new Date(session.created_at).getTime() + duration * 60 * 1000;
    return Math.max(0, Math.round((deadline - Date.now()) / 60000));
  };

  // Returns true if a session should be force-submittable:
  // either timed out OR the exam was closed by the instructor.
  const isSessionForceSubmittable = (session) => {
    if (sittingAlreadyFiled(session)) return false;
    const examClosed = [...examsList, ...sharedExamsList].find(e => e.id === session.exam_id)?.is_open === false;
    return isSessionTimedOut(session) || examClosed;
  };

  const [isForceSubmitting, setIsForceSubmitting] = useState(false);
  const [forceSubmitConfirmList, setForceSubmitConfirmList] = useState(null); // sessions[] | null

  // `silent` is the automatic sweep below: no modal, no spinner, no alert.
  const doForceSubmit = async (sessions, { silent = false } = {}) => {
    if (!silent) setIsForceSubmitting(true);

    const errors = [];
    const submitted = [];

    for (const session of sessions) {
      try {
        // One step, in the database (sql/120): the paper is filed from what
        // the sitting saved and the sitting closed in the same transaction,
        // with the row locked so two dashboards cannot both file it. If the
        // filing fails nothing has changed — the sitting is still open and
        // on the monitor. Done in three round trips from here, a reopen that
        // never arrived left a sitting closed with nothing on file.
        let outcome, timeTaken;
        const { data: one, error: oneErr } = await supabase.rpc('force_submit_sitting', { p_session_id: session.id });
        if (!oneErr) {
          if (one?.outcome !== 'filed') {
            // Already filed by another dashboard, or the row is gone.
            setLiveSessions(prev => prev.filter(s => s.id !== session.id));
            continue;
          }
          outcome = one;
          timeTaken = one.time_taken_seconds;
        } else if (!isMissingFunctionError(oneErr)) {
          errors.push(`${session.student_name}: ${oneErr.message}`);
          continue;
        } else {
          // Claim the session before submitting it. Co-instructors share a live
          // monitor and the auto-sweep runs in every open dashboard; without an
          // atomic claim the same student is submitted twice, which on a
          // retakeable paper writes two attempts instead of one.
          const { data: claimed, error: claimErr } = await supabase
            .from('live_sessions')
            .update({ status: 'finished', updated_at: new Date() })
            .eq('id', session.id).neq('status', 'finished').select('id');

          if (claimErr) { errors.push(`${session.student_name}: ${claimErr.message}`); continue; }
          if (!claimed || claimed.length === 0) {
            // Another dashboard got there first — nothing left to submit.
            setLiveSessions(prev => prev.filter(s => s.id !== session.id));
            continue;
          }

          // A multi-answer item's saved progress is an array of indices, so the
          // shape is taken from the value rather than coerced to a number.
          const mcAnswers = answersPayload(session.answers_json);

          const duration = examDurationFor(session.exam_id);
          const elapsed = Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000);
          timeTaken = duration ? Math.min(elapsed, duration * 60) : elapsed;

          // Marked in Postgres, exactly like the student's own submission.
          // submit_assessment() routes a retakeable paper to review_attempts and
          // a graded one to results. The old direct INSERT into results filed
          // practice sittings in the graded table, and marked in the browser off
          // correct_answer — which sql/003 has since revoked from the client.
          const { data: legacyOutcome, error: rpcErr } = await supabase.rpc('submit_assessment', {
            p_student_id: session.student_id,
            p_assessment_id: session.exam_id,
            p_answers: mcAnswers,
            p_time_taken_seconds: timeTaken,
            p_tab_switches: session.violation_count || 0,
            p_violation_logs: session.violation_log || [],
          });

          if (rpcErr) {
            // Hand the session back so it stays visible and force-submittable
            // instead of vanishing from the monitor unsubmitted.
            await supabase.from('live_sessions')
              .update({ status: session.status === 'locked' ? 'locked' : 'active' })
              .eq('id', session.id);
            errors.push(`${session.student_name}: ${rpcErr.message}`);
            continue;
          }
          outcome = legacyOutcome;
        }

        const isRetake = examAllowsRetakes(session.exam_id);
        const score = outcome?.score ?? 0;
        const mcTotal = outcome?.total_items ?? 0;
        // What the paper is worth beyond the picked items. submit_assessment()
        // files and marks the working from the live session since sql/039;
        // before it, Force Submit filed none. Absent on a plain paper.
        const filedMarks = {
          points_earned: outcome?.points_earned ?? null,
          points_total: outcome?.points_total ?? null,
          work_marks: outcome?.work_marks ?? null,
          work_total: outcome?.work_total ?? null,
        };

        // Essays are not marked server-side (there is nothing to mark against),
        // so they are attached to the stored graded row separately. A
        // retakeable paper has no results row to attach them to.
        const essayPayload = {};
        Object.entries(session.essay_answers_json || {}).forEach(([qId, text]) => {
          if (typeof text === 'string' && text.trim()) {
            essayPayload[String(qId)] = { type: 'essay', text: text.trim() };
          }
        });
        if (!isRetake && Object.keys(essayPayload).length > 0) {
          const { data: existing } = await supabase.from('results')
            .select('id, answers_json')
            .eq('student_id', session.student_id).eq('exam_id', session.exam_id).limit(1);
          if (existing?.[0]) {
            await supabase.from('results')
              .update({ answers_json: { ...(existing[0].answers_json || {}), ...essayPayload } })
              .eq('id', existing[0].id);
          }
        }

        setLiveSessions(prev => prev.filter(s => s.id !== session.id));
        submitted.push(session.student_name || 'a student');

        // Keep the dashboard in step without a refetch — and file the row where
        // it actually landed, so a practice sitting never shows up as a grade.
        if (isRetake) {
          setPracticeAttempts(prev => [...prev, {
            student_id: session.student_id,
            assessment_id: session.exam_id,
            attempt_no: outcome?.attempt_no ?? 1,
            score,
            total_items: mcTotal,
            ...filedMarks,
            time_taken_seconds: timeTaken,
            submitted_at: new Date().toISOString(),
          }]);
        } else {
          setResults(prev => (
            prev.some(r => r.student_id === session.student_id && r.exam_id === session.exam_id)
              ? prev
              : [...prev, {
                  student_id: session.student_id,
                  exam_id: session.exam_id,
                  score,
                  total_items: mcTotal,
                  ...filedMarks,
                  time_taken_seconds: timeTaken,
                  tab_switches: session.violation_count || 0,
                  violation_logs: session.violation_log || [],
                  submitted_at: new Date().toISOString(),
                }]
          ));
        }
      } catch (err) {
        errors.push(`${session.student_name}: ${err.message}`);
      }
    }

    if (!silent) {
      setIsForceSubmitting(false);
      setForceSubmitConfirmList(null);
      if (errors.length > 0) alert(`Force submit completed with errors:\n${errors.join('\n')}`);
    } else if (errors.length > 0) {
      console.error('Auto force-submit errors:', errors.join(' | '));
    }
  };

  // --- AUTO FORCE-SUBMIT: TIMED-OUT PRACTICE SITTINGS ---
  // A paper with unlimited retakes is revision, not a grade, so there is nothing
  // for an instructor to decide when the clock runs out: submit what the student
  // had. Their own tab does this at 0:00, but a closed laptop or a dead
  // connection leaves the sitting stranded with answers already saved to
  // live_sessions and no attempt recorded. This sweeps those up.
  //
  // Graded papers are deliberately NOT swept — those stay a manual, confirmed
  // decision on the instructor's part.
  const AUTO_SUBMIT_GRACE_MS = 90000;

  // Nothing answered is nothing to submit: a student who opened a practice
  // paper and walked away should not be handed a 0 that then sits in their
  // attempt history. The instructor can still force one through by hand.
  // (Shared with the dismiss rule — src/lib/proctoring.js.)
  const hasSavedWork = sessionHasWork;

  const isAutoSubmittable = (session) =>
    examAllowsRetakes(session.exam_id) &&
    isSessionTimedOut(session, AUTO_SUBMIT_GRACE_MS) &&
    hasSavedWork(session);

  const autoSubmitSweepRef = useRef({ liveSessions: [] });
  autoSubmitSweepRef.current = { liveSessions, isAutoSubmittable, doForceSubmit };
  const autoSubmittedIdsRef = useRef(new Set());
  const autoSweepBusyRef = useRef(false);

  // Keyed by sitting, not by row: a retake reuses the same live_sessions row
  // (it is unique on student+exam) and only its created_at moves, so keying on
  // the id alone would mark a student as swept for good and quietly skip every
  // attempt they make after the first.
  const sweepKey = (s) => `${s.id}:${s.created_at || ''}`;

  useEffect(() => {
    const sweep = async () => {
      if (autoSweepBusyRef.current) return;
      const snap = autoSubmitSweepRef.current;
      const due = (snap.liveSessions || []).filter(s =>
        s.status !== 'finished' &&
        !autoSubmittedIdsRef.current.has(sweepKey(s)) &&
        snap.isAutoSubmittable(s));
      if (due.length === 0) return;

      autoSweepBusyRef.current = true;
      due.forEach(s => autoSubmittedIdsRef.current.add(sweepKey(s)));
      try {
        await snap.doForceSubmit(due, { silent: true });
      } finally {
        autoSweepBusyRef.current = false;
      }
    };
    sweep();
    const t = setInterval(sweep, 20000);
    return () => clearInterval(t);
  }, []);

  // --- RESCORE / REPAIR ZERO RESULTS ---
  const [isRescoring, setIsRescoring] = useState(false);
  // The papers among this instructor's 0/0 results that have a picked item —
  // the only ones rescoreZeroResults() can repair. A paper of typed or essay
  // items is 0/0 by design, so it must not raise the banner.
  // undefined = still looking (no banner); null = the lookup failed (banner).
  const zeroExamKey = [...new Set(results
    .filter(r => r.total_items === 0 && instructorExamIdsRef.current.has(r.exam_id))
    .map(r => r.exam_id))].sort().join(',');
  const [repairable, setRepairable] = useState({ key: '', ids: undefined });
  const repairableExamIds = repairable.key === zeroExamKey ? repairable.ids : undefined;
  useEffect(() => {
    if (!zeroExamKey) return;
    let live = true;
    fetchAllRows(() => supabase.from('questions').select('id, exam_id')
      .in('exam_id', zeroExamKey.split(','))
      .or('question_type.is.null,question_type.not.in.(essay,worked_solution)'))
      .then(rows => { if (live) setRepairable({ key: zeroExamKey, ids: new Set(rows.map(r => r.exam_id)) }); })
      .catch(() => { if (live) setRepairable({ key: zeroExamKey, ids: null }); });
    return () => { live = false; };
  }, [zeroExamKey]);
  const [isRecoveringWork, setIsRecoveringWork] = useState(false);
  const [manualScoreModal, setManualScoreModal] = useState(null); // { student_id, exam_id, student_name, exam_title, total_items, weighted }
  const [manualScoreValue, setManualScoreValue] = useState('');

  // A score can be typed in only where one number means the same thing in
  // both columns: a row from before points existed, or one where every item
  // is worth a point. Where items carry different points, a count typed here
  // would not be what the table shows.
  const manualScoreFits = (row) => row.points_total === null || row.points_total === undefined
    || Number(row.points_total) === Number(row.total_items);

  const saveManualScore = async () => {
    if (!manualScoreModal) return;
    const score = parseInt(manualScoreValue, 10);
    if (isNaN(score) || score < 0 || score > manualScoreModal.total_items) {
      return alert(`Score must be between 0 and ${manualScoreModal.total_items}.`);
    }
    // The table reads points_earned when the row has points (combinedScore),
    // so writing only the count would change nothing anyone can see.
    const patch = manualScoreModal.weighted ? { score, points_earned: score } : { score };
    const { error } = await supabase.from('results')
      .update(patch)
      .eq('student_id', manualScoreModal.student_id)
      .eq('exam_id', manualScoreModal.exam_id);
    if (error) return alert('Save failed: ' + error.message);
    const isRow = (r) => r.student_id === manualScoreModal.student_id && r.exam_id === manualScoreModal.exam_id;
    setResults(prev => prev.map(r => (isRow(r) ? { ...r, ...patch } : r)));
    setViewingStudent(prev => (prev && isRow(prev) ? { ...prev, ...patch } : prev));
    setManualScoreModal(null);
    setManualScoreValue('');
  };

  // ── Change password (own instructor account) ──
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [isChangingPw, setIsChangingPw] = useState(false);

  const closePwModal = () => {
    setShowPwModal(false);
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwError(''); setIsChangingPw(false);
  };

  const changePassword = async () => {
    setPwError('');
    if (!pwCurrent) return setPwError('Enter your current password.');
    if (pwNew.length < 8) return setPwError('New password must be at least 8 characters.');
    if (pwNew !== pwConfirm) return setPwError('New passwords do not match.');
    if (pwNew === pwCurrent) return setPwError('New password must be different from the current one.');

    setIsChangingPw(true);
    try {
      // Get the signed-in instructor's email to re-verify the current password
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user?.email) {
        setIsChangingPw(false);
        return setPwError('Could not verify your session. Please sign out and back in.');
      }
      // Re-authenticate to confirm the current password is correct
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: pwCurrent,
      });
      if (signInErr) {
        setIsChangingPw(false);
        return setPwError('Current password is incorrect.');
      }
      // Update to the new password
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updateErr) {
        setIsChangingPw(false);
        return setPwError(updateErr.message || 'Could not update password.');
      }
      closePwModal();
      alert('Password updated successfully.');
    } catch {
      setIsChangingPw(false);
      setPwError('Something went wrong. Please try again.');
    }
  };

  const rescoreZeroResults = async () => {
    const allExamIds = [...instructorExamIdsRef.current];
    const zeroResults = results.filter(r =>
      r.total_items === 0 && allExamIds.includes(r.exam_id)
    );
    if (zeroResults.length === 0) return alert('No 0/0 results found.');

    setIsRescoring(true);

    const examIds = [...new Set(zeroResults.map(r => r.exam_id))];
    const questionsByExam = {};
    await Promise.all(examIds.map(async id => { questionsByExam[id] = await loadExamQuestions(id); }));

    // Only a paper with picked items can be 0/0 by mistake. On a paper of
    // essays or typed (worked) items 0/0 is right — typed marks live in
    // work_marks/work_total — and "repairing" it set total_items to the
    // number of typed items and the time taken to the whole limit (sql/055).
    const isPicked = q => !['essay', 'worked_solution'].includes(q.question_type || 'multiple_choice');
    const mcExamIds = new Set(
      examIds.filter(id => (questionsByExam[id] || []).some(isPicked))
    );
    const toFix = zeroResults.filter(r => mcExamIds.has(r.exam_id));
    if (toFix.length === 0) { setIsRescoring(false); return alert('No 0/0 results to fix: the papers involved have no multiple-choice items, so 0/0 is correct for them.'); }

    // Fetch finished live_sessions to get answers + created_at for time calculation
    const sessionFetches = await Promise.all(
      toFix.map(r =>
        supabase.from('live_sessions')
          .select('student_id, exam_id, answers_json, essay_answers_json, created_at')
          .eq('student_id', r.student_id).eq('exam_id', r.exam_id)
          .order('updated_at', { ascending: false }).limit(1)
      )
    );

    // Diagnose whether answers_json data actually exists on the server
    const hasAnswerData = sessionFetches.some(f => {
      const s = f?.data?.[0];
      return s?.answers_json && Object.keys(s.answers_json).length > 0;
    });

    let timeFixed = 0, scoreFixed = 0, failed = 0;

    for (let i = 0; i < toFix.length; i++) {
      const result = toFix[i];
      const session = sessionFetches[i]?.data?.[0];
      const questions = questionsByExam[result.exam_id] || [];

      // Always fix time_taken_seconds from created_at + exam duration
      const duration = [...examsList, ...sharedExamsList].find(e => e.id === result.exam_id)?.duration_minutes || 0;
      const elapsed = session?.created_at
        ? Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000)
        : 0;
      const timeTaken = duration > 0 ? Math.min(elapsed, duration * 60) : elapsed;

      const rawAnswers = session?.answers_json || {};
      const rawEssays = session?.essay_answers_json || {};
      const answersAvailable = Object.keys(rawAnswers).length > 0 || Object.keys(rawEssays).length > 0;

      let correctCount = 0, mcTotal = 0;
      const formattedAnswers = {};

      questions.forEach(q => {
        const qId = String(q.id);
        if ((q.question_type || 'multiple_choice') === 'essay') {
          const text = rawEssays[qId];
          if (text?.trim()) formattedAnswers[qId] = { type: 'essay', text: text.trim() };
        } else if (isPicked(q)) {
          mcTotal++;
          if (rawAnswers[qId] !== undefined) {
            // A multi-answer item is all or nothing (sql/018); a single-answer
            // one compares one index, as it always has. isAnswerCorrect()
            // applies the same rule score_answers() does in Postgres.
            const multi = isMultiSelect(q);
            const set = indexSet(rawAnswers[qId]);
            if (set !== null) {
              const chosen = multi ? set : set[0];
              const isCorrect = isAnswerCorrect(q, rawAnswers[qId]) === true;
              if (isCorrect) correctCount++;
              formattedAnswers[qId] = { chosen, is_correct: isCorrect };
            }
          }
        }
      });

      const updatePayload = answersAvailable
        ? { score: correctCount, total_items: mcTotal, answers_json: formattedAnswers, time_taken_seconds: timeTaken }
        : { total_items: mcTotal, time_taken_seconds: timeTaken };

      const { error } = await supabase.from('results')
        .update(updatePayload)
        .eq('student_id', result.student_id).eq('exam_id', result.exam_id);

      if (error) { failed++; continue; }
      if (answersAvailable) scoreFixed++;
      timeFixed++;
      setResults(prev => prev.map(r =>
        r.student_id === result.student_id && r.exam_id === result.exam_id
          ? { ...r, ...updatePayload }
          : r
      ));
    }

    setIsRescoring(false);

    if (!hasAnswerData) {
      alert(
        `Time fixed for ${timeFixed} student${timeFixed !== 1 ? 's' : ''}.\n\n` +
        `Scores could NOT be recovered automatically.\n\n` +
        `The students' answers were never saved to the server — only the answer COUNT was stored. ` +
        `This is because the live_sessions table is missing the answers_json column.\n\n` +
        `Run this SQL in Supabase to fix it for future exams:\n\n` +
        `ALTER TABLE live_sessions\n` +
        `  ADD COLUMN IF NOT EXISTS answers_json jsonb,\n` +
        `  ADD COLUMN IF NOT EXISTS essay_answers_json jsonb,\n` +
        `  ADD COLUMN IF NOT EXISTS exam_set text;\n\n` +
        `For these ${timeFixed} students, open the paper (the eye icon) and use Enter score.`
      );
    } else {
      alert(`Done: ${scoreFixed} re-scored, ${timeFixed} time fixed${failed > 0 ? `, ${failed} failed` : ''}.`);
    }
  };

  // Working refused at submit — save_worked_answers() checks the session
  // token and submit_assessment() does not, so a second sign-in mid-paper
  // leaves the picked items marked and the working behind in the live
  // session (src/lib/workRecovery.js). Written into the result from there and
  // marked by score_worked_answers(), as the student's own call would have.
  const recoverMissingWork = async () => {
    if (missingWork.length === 0) return;
    setIsRecoveringWork(true);
    let recovered = 0, blank = 0, failed = 0;
    for (const row of missingWork) {
      try {
        const questions = await loadExamQuestions(row.exam_id);
        const [{ data: sessions, error: liveErr }, { data: current, error: rowErr }] = await Promise.all([
          supabase.from('live_sessions').select('work_answers_json')
            .eq('student_id', row.student_id).eq('exam_id', row.exam_id)
            .order('updated_at', { ascending: false }).limit(1),
          supabase.from('results').select('answers_json')
            .eq('student_id', row.student_id).eq('exam_id', row.exam_id).single(),
        ]);
        if (liveErr || rowErr) throw liveErr || rowErr;
        const patch = workPatchFrom(sessions?.[0]?.work_answers_json, questions);
        if (Object.keys(patch).length > 0) {
          const { error } = await supabase.from('results')
            .update({ answers_json: { ...(current?.answers_json || {}), ...patch } })
            .eq('student_id', row.student_id).eq('exam_id', row.exam_id);
          if (error) throw error;
        }
        // Run even with nothing written: a blank item is a real 0, and this is
        // what records the marks available, so the row reads out of the full
        // paper instead of the picked items alone.
        const { data: scored, error: scoreErr } = await supabase.rpc('score_worked_answers', {
          p_student_id: row.student_id, p_assessment_id: row.exam_id,
        });
        if (scoreErr) throw scoreErr;
        const isRow = (r) => r.student_id === row.student_id && r.exam_id === row.exam_id;
        const marks = { work_marks: Number(scored?.work_marks) || 0, work_total: Number(scored?.work_total) || 0, work_marked_at: new Date().toISOString() };
        setResults(prev => prev.map(r => (isRow(r) ? { ...r, ...marks } : r)));
        setAnswersJsonCache(prev => { const next = { ...prev }; delete next[`${row.student_id}_${row.exam_id}`]; return next; });
        if (Object.keys(patch).length > 0) recovered++; else blank++;
      } catch (err) {
        console.error('Could not recover working:', err?.message || err);
        failed++;
      }
    }
    setIsRecoveringWork(false);
    alert(`Working recovered and marked for ${recovered} paper${recovered === 1 ? '' : 's'}`
      + (blank ? `; ${blank} had nothing written and ${blank === 1 ? 'is' : 'are'} now scored out of the full paper` : '')
      + (failed ? `; ${failed} could not be recovered — try again, or mark ${failed === 1 ? 'it' : 'them'} by hand.` : '.'));
  };

  // --- QUESTION MANAGEMENT FUNCTIONS ---
  const loadQuestionList = async (examId) => {
    if (!examId) { setQList([]); return; }
    setQLoading(true);
    // In the order students get them (get_exam_questions, sql/042): by
    // question number, unnumbered last, then id. By id alone, a paper loaded
    // from SQL listed its items in random order.
    const { data } = await supabase.from('questions').select('*').eq('exam_id', examId)
      .order('question_number', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    setQList(data || []);
    setQLoading(false);
  };

  const handleQExamChange = (examId) => {
    setQExamId(examId);
    setEditingQ(null);
    setQForm(emptyQ);
    setQImageFile(null);
    setQImagePreview(null);
    setCsvParsed(null);
    loadQuestionList(examId);
  };

  const uploadQuestionImage = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `${qExamId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('question-images').upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('question-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const removeQuestionImageFromStorage = async (imageUrl) => {
    if (!imageUrl) return;
    try {
      const marker = '/question-images/';
      const idx = imageUrl.indexOf(marker);
      if (idx === -1) return;
      const path = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
      await supabase.storage.from('question-images').remove([path]);
    } catch { /* best-effort — orphaned file is non-critical */ }
  };

  const saveQuestion = async () => {
    if (!qExamId) return;
    if (!qForm.question_text.trim()) return alert('Question text is required.');
    if (qForm.question_type === 'text_answer' && !String(qForm.text?.answer || '').trim()) {
      return alert('Type the answer students must give. Capital letters and spaces are ignored when it is compared.');
    }
    // A problem answered as quantities (sql/105) keeps its parts, keys,
    // units and points exactly as its loader wrote them; only the wording
    // is edited here.
    const keepsQuantity = qForm.question_type === 'worked_solution' && editingQ?.work_rubric?.mode === 'quantity';
    if (qForm.question_type === 'worked_solution' && !keepsQuantity) {
      const steps = (qForm.work?.steps || []).filter(s => String(s?.latex || '').trim());
      if (steps.length === 0) {
        return alert('A worked solution needs at least one expected step, with the marks it carries. The last step is the final answer.');
      }
      if (!(Number(qForm.marks) >= 1)) {
        return alert('Say what this worked question is worth — at least 1 point.');
      }
    }
    const isEssay = qForm.question_type === 'essay';
    const isMulti = qForm.question_type === 'multi_select';
    const isText = qForm.question_type === 'text_answer';
    const isWorked = qForm.question_type === 'worked_solution' || isText;
    const keySet = indexSet(qForm.correct_answers) || [];

    // Typed items have no choices to check — a worked item used to be refused
    // here for having fewer than two.
    if (!isEssay && !isWorked) {
      const filled = choicesPatch(qForm.choice_list).choices;
      if (filled.length < 2)
        return alert('A multiple choice question needs at least two choices.');
      // Keying a choice that has been left blank would mark every student
      // wrong, and the database CHECK would reject the row anyway — say so in
      // words first.
      if (isMulti) {
        if (keySet.length === 0)
          return alert('Tick at least one correct answer. A multiple-answer question is marked all or nothing, so it needs a key to compare against.');
        if (!keySetIsValid(keySet, filled.length))
          return alert(`Choice ${keySet.filter(i => i >= filled.length).map(letterFor).join(', ')} is marked correct but is blank or missing. Fill it in, or untick it.`);
      } else if (!keyIsValid(Number(qForm.correct_answer), filled.length)) {
        return alert(`Choice ${letterFor(Number(qForm.correct_answer))} is marked correct but is blank or missing. Fill it in, or pick another correct answer.`);
      }
    }

    setQSaving(true);

    let imageUrl = qForm.image_url;

    if (qImageFile) {
      setQImageUploading(true);
      try {
        if (editingQ?.image_url && editingQ.image_url !== imageUrl) {
          await removeQuestionImageFromStorage(editingQ.image_url);
        }
        imageUrl = await uploadQuestionImage(qImageFile);
      } catch (err) {
        alert('Image upload failed: ' + err.message + '\n\nMake sure the "question-images" Storage bucket exists and is public in Supabase.');
        setQSaving(false);
        setQImageUploading(false);
        return;
      }
      setQImageUploading(false);
    } else if (editingQ?.image_url && qForm.image_url === null) {
      await removeQuestionImageFromStorage(editingQ.image_url);
    }

    const payload = {
      exam_id: qExamId,
      question_text: qForm.question_text.trim(),
      question_type: QUESTION_TYPES.find(t => t.value === qForm.question_type)?.stores ?? qForm.question_type,
      // Only `choices` is written; the trigger in sql/016 mirrors the first
      // five into choice_a..choice_e for clients still on the old build.
      ...((isEssay || isWorked) ? { choices: [] } : choicesPatch(qForm.choice_list)),
      // Exactly one of the two keys, never both: sql/018 constrains them to
      // match the type, so sending the unused one would be rejected. A worked
      // item keys on neither (sql/024).
      correct_answer: (isEssay || isMulti || isWorked) ? null : Number(qForm.correct_answer),
      correct_answers: isMulti ? keySet : null,
      // Other choices that also count (sql/130), on a one-answer item only.
      // Sent only when there are some, or to clear ones the item had, so a
      // save does not name the column on a database without sql/130.
      ...(() => {
        const also = (isEssay || isMulti || isWorked) ? []
          : (indexSet(qForm.also_correct) || []).filter(i => i !== Number(qForm.correct_answer) && i < choicesPatch(qForm.choice_list).choices.length);
        return also.length || editingQ?.accepted_answers ? { accepted_answers: also.length ? also : null } : {};
      })(),
      image_url: imageUrl || null,
      // Which set it is in (sql/116); null is every set.
      set_label: normaliseSetLabel(qForm.set_label) || null,
      // What the item is worth. Everything that is not a worked solution stays
      // at 1, which is what keeps a sum of marks equal to the old count of
      // items for every paper that already exists.
      marks: keepsQuantity ? editingQ.marks : Math.max(1, Math.min(100, Number(qForm.marks) || 1)),
      work_given: keepsQuantity ? editingQ.work_given : isWorked && !isText ? (qForm.work?.given || null) : null,
      work_variable: keepsQuantity ? editingQ.work_variable : isWorked && !isText ? (qForm.work?.variable || 'x') : null,
      // A full solution marked line by line (sql/042) carries a scheme this
      // editor cannot show — per-step accept lists and the marks for the
      // answer alone — so it is written back exactly as it was loaded. The
      // text, the problem and the marks stay editable.
      work_rubric: isText ? {
        mode: 'text',
        steps: [{ latex: String(qForm.text.answer).trim(), marks: Math.max(1, Math.min(100, Number(qForm.marks) || 1)) }],
        accept: String(qForm.text?.accept || '').split('\n').map(v => v.trim()).filter(Boolean),
      } : isWorked && ['lines', 'proof', 'simplify', 'logic', 'quantity'].includes(editingQ?.work_rubric?.mode) ? editingQ.work_rubric
        : isWorked ? {
        steps: (qForm.work?.steps || [])
          .filter(st => String(st?.latex || '').trim())
          .map(st => ({
            latex: String(st.latex).trim(),
            marks: Number(st.marks) || 0,
            label: String(st.label || '').trim(),
          })),
        // Other spellings of the answer that the database will accept
        // (sql/027). Normalisation covers the cosmetic ones; this is for
        // anything needing algebra.
        accept: (qForm.work?.accept || [])
          .map(v => String(v || '').trim()).filter(Boolean),
        penaltyPerBrokenStep: 1,
      } : null,
    };

    let error;
    if (editingQ) {
      ({ error } = await supabase.from('questions').update(payload).eq('id', editingQ.id));
    } else {
      ({ error } = await supabase.from('questions').insert([payload]));
    }

    if (error) {
      alert('Error saving question: ' + error.message);
    } else {
      setEditingQ(null);
      setQForm(emptyQ);
      setQImageFile(null);
      setQImagePreview(null);
      setExamQuestionsCache(prev => { const n = { ...prev }; delete n[qExamId]; return n; });
      loadQuestionList(qExamId);
    }
    setQSaving(false);
  };

  const deleteQuestion = async (questionId) => {
    if (!window.confirm(`Move this question to the Trash?\n\nYou can restore it for ${TRASH_DAYS} days, and it comes back with students' answers still attached.`)) return;
    // Its image stays in storage: Restore brings the question back with it.
    const { data, error } = await supabase.rpc('trash_questions', { p_paper: qExamId, p_ids: [questionId] });
    if (error) {
      console.error('Could not move question to the Trash:', error);
      alert(isMissingFunctionError(error)
        ? 'Deleting questions needs a database update (sql/139) that has not been run yet. Nothing was changed.'
        : 'Could not delete this question. Nothing was changed — please try again.');
      return;
    }
    if (data === 'not_yours') { alert('Only an instructor of this paper can delete its questions.'); return; }
    refreshTrash();
    if (editingQ?.id === questionId) { setEditingQ(null); setQForm(emptyQ); setQImageFile(null); setQImagePreview(null); }
    setExamQuestionsCache(prev => { const n = { ...prev }; delete n[qExamId]; return n; });
    loadQuestionList(qExamId);
  };

  // Points can be changed from the list without opening the whole editor —
  // reweighting a paper is usually a pass over every item, and opening,
  // scrolling and saving a form thirty times to change one number each is
  // not a reasonable way to spend an evening.
  const [savingPointsFor, setSavingPointsFor] = useState(null);
  const saveQuestionPoints = async (q, pts) => {
    const marks = Math.max(1, Math.min(100, Math.round(Number(pts) || 1)));
    if (marks === (Number(q.marks) || 1)) return;
    setSavingPointsFor(q.id);
    const { error } = await supabase.from('questions').update({ marks }).eq('id', q.id);
    setSavingPointsFor(null);
    if (error) { alert('Could not change the points: ' + error.message); return; }
    // Patched in place rather than refetched, so the list does not jump and
    // a run of edits stays responsive.
    setQList(prev => prev.map(x => (x.id === q.id ? { ...x, marks } : x)));
    setExamQuestionsCache(prev => {
      const list = prev[qExamId];
      if (!list) return prev;
      return { ...prev, [qExamId]: list.map(x => (x.id === q.id ? { ...x, marks } : x)) };
    });
  };

  const startEditQuestion = (q) => {
    setEditingQ(q);
    setQForm({
      question_text: q.question_text,
      choice_list: (() => { const c = choicesOf(q); return c.length ? c : ['', '', '', '']; })(),
      correct_answer: Number(q.correct_answer || 0),
      correct_answers: indexSet(q.correct_answers) || [],
      also_correct: indexSet(q.accepted_answers) || [],
      question_type: q.work_rubric?.mode === 'text' ? 'text_answer' : (q.question_type || 'multiple_choice'),
      image_url: q.image_url || null,
      marks: Number(q.marks) || 1,
      set_label: q.set_label || '',
      // A worked item's rubric comes back as stored; anything else gets a
      // blank one so switching an existing question to worked_solution has
      // something to edit rather than crashing on an undefined.
      work: {
        given: q.work_given || '',
        variable: q.work_variable || 'x',
        marks: Number(q.marks) || 3,
        steps: Array.isArray(q.work_rubric?.steps) && q.work_rubric.steps.length
          ? q.work_rubric.steps
          : [{ latex: '', marks: 1, label: '' }],
        accept: Array.isArray(q.work_rubric?.accept) ? q.work_rubric.accept : [],
      },
      text: q.work_rubric?.mode === 'text'
        ? { answer: q.work_rubric.steps?.at(-1)?.latex || '',
            accept: (Array.isArray(q.work_rubric.accept) ? q.work_rubric.accept : []).join('\n') }
        : { answer: '', accept: '' },
    });
    setQImageFile(null);
    setQImagePreview(q.image_url || null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- CSV HELPERS ---
  const downloadCSVTemplate = () => {
    // Plain, ordinary questions. The rows deliberately carry NO instructions of
    // their own: everything in question_text is a question, so a row that
    // explained the format would be imported as one. The explaining happens on
    // screen, beside the button. What the rows do show, silently, is the range
    // of shapes — 4, 5, 7 and 2 choices, a key given as a number, a key naming
    // three answers at once, and an essay.
    const csv = [
      'question_text,choice_a,choice_b,choice_c,choice_d,choice_e,choice_f,choice_g,correct_answer',
      '"What is lift?","Pressure difference","Gravity","Drag","Thrust",,,,A',
      '"Which of these is a primary flight control?","Flap","Slat","Spoiler","Trim tab","Aileron",,,E',
      '"Which of these are control surfaces?","Aileron","Elevator","Rudder","Flap","Slat","Spoiler","Trim tab",A;B;C',
      '"An aerofoil generates lift by accelerating air over its upper surface.","True","False",,,,,,A',
      '"Which force opposes thrust in level flight?","Lift","Drag","Weight","Normal force",,,,1',
      '"Explain Bernoulli\'s principle in your own words.","","","","","","","",""',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'question_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // The weighted template: a named header, so points, a maths question and its
  // accepted answers have somewhere to live. Offered alongside the plain one
  // rather than replacing it, because a file with no header is still the
  // shortest way to type fifty multiple-choice items.
  const downloadWeightedCSVTemplate = () => {
    const csv = [
      'question_text,type,points,given,answer,accept,choice_a,choice_b,choice_c,choice_d',
      '"Which of these is a primary flight control?",mc,2,,D,,"Flap","Slat","Spoiler","Aileron"',
      '"Which of these are control surfaces?",multi,4,,A;B,,"Aileron","Elevator","Flap","Slat"',
      '"Evaluate the limit.",math,1,"\\lim_{x\\to 2}(x+3)",5,,,,,',
      '"Differentiate with respect to x.",math,2,y=5x,y\'=5,,,,,',
      '"Differentiate with respect to x.",math,3,"y=\\ln(x)","y\'=\\frac{1}{x}","y\'=x^{-1}",,,,',
      '"Evaluate the integral.",math,5,"y=\\int 2x\\,dx",y=x^2+C,"y=x^2+K;y=x^2",,,,',
      '"Explain Bernoulli\'s principle in your own words.",essay,10,,,,,,,',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'question_template_with_points.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileSelect = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setter(parseQuestionCSV(ev.target.result));
    reader.readAsText(file);
    e.target.value = '';
  };

  const importQuestionsFromCSV = async (examId, questions, replace) => {
    setCsvImporting(true);
    try {
      // The old questions go to the Trash as one entry. If that fails, nothing
      // is imported: adding to a paper meant to be replaced would double it.
      if (replace) {
        const { data, error } = await supabase.rpc('trash_questions', { p_paper: examId, p_ids: null });
        if (error) {
          console.error('Could not move questions to the Trash:', error);
          throw new Error(isMissingFunctionError(error)
            ? 'Replacing questions needs a database update (sql/139) that has not been run yet. Nothing was changed.'
            : 'The existing questions could not be moved to the Trash. Nothing was changed.');
        }
        if (data === 'not_yours') throw new Error('Only an instructor of this paper can replace its questions.');
        refreshTrash();
      }
      const payload = questions.map(q => ({ ...q, exam_id: examId }));
      for (let i = 0; i < payload.length; i += 50) {
        const { error } = await supabase.from('questions').insert(payload.slice(i, i + 50));
        if (error) throw error;
      }
      setCsvParsed(null);
      setExamQuestionsCache(prev => { const n = { ...prev }; delete n[examId]; return n; });
      loadQuestionList(examId);
      alert(`${questions.length} question${questions.length !== 1 ? 's' : ''} imported!`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    setCsvImporting(false);
  };

  // --- STUDENT CSV HELPERS ---
  const downloadStudentCSVTemplate = () => {
    const csv = [
      'full_name,student_email,student_id,section,course',
      '"Juan dela Cruz","juan.delacruz@patts.edu.ph","2021-1-1234","Aero 101","BSAE"',
      '"Maria Santos","maria.santos@patts.edu.ph","2021-1-5678","Aero 101","BSAMT"',
      '"Pedro Reyes","pedro.reyes@patts.edu.ph","2022-2-9012","Aero 102","PRE-ENG\'G"',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'student_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // A student is a person, not a seat. The same person sits in AENG 223L and
  // in Esci 316 -1, and their roster row carries every section they are in as
  // a comma-separated list. This used to skip any row whose email or Student
  // ID was already on file, so importing a section made up of students who
  // already existed added nobody: the new section was never written down, and
  // the roster came back holding only the handful of genuinely new names.
  // Match an existing person and merge the section into their list instead.
  const importStudentsFromCSV = async () => {
    if (!studentCsvParsed || studentCsvParsed.students.length === 0) return;
    setStudentCsvImporting(true);
    try {
      const existing = await fetchAllRows(() => supabase.from('users').select('id, student_email, student_code, section, course'));
      // student_code is NOT unique any more (sql/014), so a Map of
      // code -> student would silently keep whichever row came back last and
      // hide the other. The rules live in src/lib/studentIdentity.js and are
      // tested there — npm run test:student-identity.
      const rosterIndex = makeRosterIndex(existing);

      const sectionsOf = (str) => (str || '').split(',').map(x => x.trim()).filter(Boolean);

      const toInsert = [], toMerge = [], alreadyIn = [], conflicts = [];
      // Two CSV rows can name the same person, so merges accumulate per user id
      // rather than each overwriting the row the previous one just built.
      const mergeById = new Map();
      // ...and a student who is new to the system can also appear twice, for
      // the two sections they are in. They must still become one row, or the
      // second section would create a second person with the same email.
      const newByEmail = new Map();
      // A course in the file is the newest word on it. Blank leaves theirs alone.
      const courseById = new Map();

      studentCsvParsed.students.forEach(s => {
        // Email is the identity; a Student ID identifies only when exactly one
        // student holds it. A row whose email is unknown and whose ID is shared
        // therefore becomes a NEW student rather than being merged into
        // whichever of the sharers happened to come back first.
        const { match, conflict } = resolveStudent(s, rosterIndex);
        if (conflict) {
          // Email points at one student and the Student ID at another: a typo
          // in the CSV, not a student in two sections. Writing either would
          // corrupt a roster row, so leave it for a human.
          conflicts.push(`${s.full_name} — email belongs to one student, Student ID to another`);
          return;
        }
        if (!match) {
          const pending = newByEmail.get(s.student_email);
          // A copy, so a failed import leaves the parsed file untouched and a
          // retry does not double up the sections it appended last time.
          if (!pending) { const row = { ...s }; newByEmail.set(s.student_email, row); toInsert.push(row); }
          else {
            if (!sectionsOf(pending.section).includes(s.section)) pending.section = `${pending.section}, ${s.section}`;
            pending.course = pending.course || s.course;
          }
          return;
        }

        if (s.course && s.course !== match.course) courseById.set(match.id, s.course);
        const current = mergeById.get(match.id) || sectionsOf(match.section);
        if (current.includes(s.section)) { alreadyIn.push(s.full_name); return; }
        const next = [...current, s.section];
        mergeById.set(match.id, next);
        toMerge.push({ id: match.id, full_name: s.full_name, section: next.join(', ') });
      });

      // Keep only the final state per student, so one UPDATE per person even
      // when the CSV puts them in two new sections at once.
      const finalMerges = [...mergeById.entries()].map(([id, secs]) => ({ id, section: secs.join(', ') }));

      let inserted = [];
      for (let i = 0; i < toInsert.length; i += 50) {
        const { data, error } = await supabase.from('users').insert(toInsert.slice(i, i + 50)).select();
        if (error) throw error;
        if (data) inserted = [...inserted, ...data];
      }

      const mergeFailures = [];
      for (const m of finalMerges) {
        const { error } = await supabase.from('users').update({ section: m.section }).eq('id', m.id);
        if (error) mergeFailures.push(m.id);
      }

      const courseFailures = [];
      for (const [id, course] of courseById) {
        const { error } = await supabase.from('users').update({ course }).eq('id', id);
        if (error) courseFailures.push(id);
      }

      // Claim every section the file touched — including one whose students all
      // already existed, which would otherwise stay invisible on the dashboard.
      const touchedSections = [...new Set(studentCsvParsed.students.map(s => s.section))];
      if (touchedSections.length > 0) await claimSections(touchedSections);

      // A merge can pull in a student who was not on this instructor's roster a
      // moment ago, so rebuild from the server rather than patching local state.
      if (inserted.length > 0 || finalMerges.length > mergeFailures.length || courseById.size > courseFailures.length) {
        await fetchDashboardData();
      }

      setStudentCsvParsed(null);

      const mergedCount = finalMerges.length - mergeFailures.length;
      const lines = [];
      if (inserted.length > 0) lines.push(`${inserted.length} new student${inserted.length !== 1 ? 's' : ''} added.`);
      if (mergedCount > 0) lines.push(`${mergedCount} existing student${mergedCount !== 1 ? 's' : ''} added to their new section.`);
      if (alreadyIn.length > 0) lines.push(`${alreadyIn.length} already in that section — no change.`);
      const coursesSet = courseById.size - courseFailures.length;
      if (coursesSet > 0) lines.push(`${coursesSet} existing student${coursesSet !== 1 ? 's' : ''} had their course updated.`);
      if (courseFailures.length > 0) lines.push(`${courseFailures.length} course${courseFailures.length !== 1 ? 's' : ''} could not be saved. Please import the file again.`);
      if (lines.length === 0) lines.push('Nothing to import.');
      let msg = lines.join('\n');
      const problems = [
        ...conflicts,
        ...mergeFailures.map(id => {
          const m = toMerge.find(x => x.id === id);
          return `${m ? m.full_name : id} — could not be updated`;
        }),
      ];
      if (problems.length > 0) {
        const preview = problems.slice(0, 8).join('\n');
        const more = problems.length > 8 ? `\n…and ${problems.length - 8} more` : '';
        msg += `\n\n${problems.length} row${problems.length !== 1 ? 's' : ''} need${problems.length === 1 ? 's' : ''} attention:\n${preview}${more}`;
      }
      alert(msg);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    setStudentCsvImporting(false);
  };

  const openDupModal = (exam) => {
    setDupModal(exam);
    setDupTitle(`Copy of ${exam.title}`);
    setDupSection(exam.target_section || '');
    setDupAssignTo('self');
  };

  const duplicateExam = async () => {
    if (!dupTitle.trim()) return alert('New title is required.');
    if (!dupSection.trim()) return alert('Target section is required — students find the exam by section.');
    setIsDuplicating(true);
    const targetId = dupAssignTo === 'self' ? instructorId : dupAssignTo;
    // duplicate_paper() (sql/110) reads the paper from assessments and copies
    // every item as it is. The old duplicate_exam() looked only in the legacy
    // exams table, so a paper loaded from the SQL editor could not be copied,
    // and it dropped points, typed-answer keys and settings.
    const { error } = await supabase.rpc('duplicate_paper', {
      p_source_id: dupModal.id,
      p_new_title: dupTitle.trim(),
      p_target_section: dupSection.trim(),
      p_target_instructor_id: targetId,
    });
    if (error) {
      console.error('Duplicate failed:', error);
      alert(isMissingFunctionError(error)
        ? 'Duplicating needs a database update (sql/110) that has not been run yet. Nothing was copied.'
        : error.code === '42501' || error.code === '22023'
          ? `Duplicate failed: ${error.message}`
          : 'Could not duplicate this paper. Nothing was copied — please try again.');
    } else {
      const dest = dupAssignTo === 'self'
        ? 'your account'
        : (instructorsList.find(i => i.id === dupAssignTo)?.full_name || 'the instructor');
      setDupModal(null);
      await fetchDashboardData();
      alert(`Exam duplicated and assigned to ${dest}.`);
    }
    setIsDuplicating(false);
  };

  const fetchInstructors = async () => {
    const { data } = await supabase.from('instructors').select('*').neq('id', instructorId).order('full_name');
    setInstructorsList(data || []);
  };

  // --- SHARING FUNCTIONS ---
  const openShareModal = (exam) => {
    setShareModal(exam);
    setShareTarget('');
  };

  // Targeted share-only refresh — does NOT set isLoading so the dashboard never disappears.
  const refreshShares = async () => {
    const [outSharesRes, inSharesRes] = await Promise.all([
      supabase.from('exam_shares').select('id, exam_id, shared_with').eq('shared_by', instructorId),
      supabase.from('exam_shares').select('id, exam_id, shared_by').eq('shared_with', instructorId),
    ]);

    const newSharesMap = {};
    (outSharesRes.data || []).forEach(s => {
      if (!newSharesMap[s.exam_id]) newSharesMap[s.exam_id] = [];
      newSharesMap[s.exam_id].push({ id: s.id, shared_with: s.shared_with });
    });
    setSharesMap(newSharesMap);

    const inShares = inSharesRes.data || [];
    if (inShares.length > 0) {
      const sharedIds = [...new Set(inShares.map(s => s.exam_id))];
      const { data: sharedExamsData } = await supabase
        .from('exams')
        .select('id, title, is_open, duration_minutes, target_section, exam_password')
        .in('id', sharedIds);
      const sharedList = inShares.map(s => {
        const exam = (sharedExamsData || []).find(e => e.id === s.exam_id);
        if (!exam) return null;
        return { ...exam, share_id: s.id, shared_by: s.shared_by };
      }).filter(Boolean);
      setSharedExamsList(sharedList);
      (sharedExamsData || []).forEach(e => instructorExamIdsRef.current.add(e.id));
      setExamsDict(prev => {
        const next = { ...prev };
        (sharedExamsData || []).forEach(e => { next[e.id] = e.title; });
        return next;
      });
    } else {
      setSharedExamsList([]);
    }
  };

  const shareExam = async () => {
    if (!shareModal || !shareTarget) return;
    setIsSharing(true);
    const { error } = await supabase.from('exam_shares').insert([{
      exam_id: shareModal.id,
      shared_by: instructorId,
      shared_with: shareTarget,
    }]);
    if (error) {
      alert('Share failed: ' + (error.code === '23505' ? 'This instructor already has access.' : error.message));
      setIsSharing(false);
      return;
    }
    setShareTarget('');
    await refreshShares();
    setIsSharing(false);
  };

  const revokeShare = async (shareId, examId) => {
    const { error } = await supabase.from('exam_shares').delete().eq('id', shareId);
    if (error) { alert('Error revoking access: ' + error.message); return; }
    setSharesMap(prev => {
      const updated = (prev[examId] || []).filter(s => s.id !== shareId);
      const next = { ...prev };
      if (updated.length === 0) delete next[examId];
      else next[examId] = updated;
      return next;
    });
  };

  const removeSharedAccess = async (shareId) => {
    const { error } = await supabase.from('exam_shares').delete().eq('id', shareId);
    if (error) { alert('Error removing shared exam: ' + error.message); return; }
    setSharedExamsList(prev => prev.filter(e => e.share_id !== shareId));
    instructorExamIdsRef.current = new Set(
      [...instructorExamIdsRef.current].filter(id =>
        sharedExamsList.some(e => e.share_id !== shareId && e.id === id) ||
        examsList.some(e => e.id === id)
      )
    );
  };

  const transferExams = async () => {
    if (!transferTarget || transferExamIds.size === 0) return;
    const dest = instructorsList.find(i => i.id === transferTarget);
    const movingResults = results.filter(r => transferExamIds.has(r.exam_id)).length;
    if (!window.confirm(`Move ${transferExamIds.size} exam${transferExamIds.size !== 1 ? 's' : ''} and ${movingResults} result${movingResults !== 1 ? 's' : ''} to ${dest?.full_name || dest?.email}?\n\nStudents will automatically appear under their dashboard. This cannot be undone from the UI.`)) return;
    setIsTransferring(true);
    const { error } = await supabase.rpc('transfer_exams', {
      p_exam_ids: [...transferExamIds],
      p_target_instructor_id: transferTarget,
    });
    if (error) {
      alert('Transfer failed: ' + error.message);
    } else {
      const count = transferExamIds.size;
      setTransferExamIds(new Set());
      setTransferTarget('');
      await fetchDashboardData();
      alert(`${count} exam${count !== 1 ? 's' : ''} transferred to ${dest?.full_name || dest?.email}.`);
    }
    setIsTransferring(false);
  };

async function fetchDashboardData() {
    setIsLoading(true);
    try {
      // What has waited its 30 days in the Trash is deleted for good, once
      // per visit, before anything is read. Before sql/104 has run there is
      // no such function, and nothing to purge.
      if (!purgedRef.current) {
        purgedRef.current = true;
        const { error: purgeError } = await supabase.rpc('purge_expired_trash');
        if (purgeError && !isMissingFunctionError(purgeError)) console.error('Could not empty the Trash:', purgeError);
      }
      // Read first: a paper in the Trash is hidden everywhere on this
      // dashboard. Before sql/104 there is no table — an empty Trash.
      const trashRes = await supabase.from('trash')
        .select('id, kind, item_id, label, detail, trashed_by, trashed_at, purge_after')
        .order('trashed_at', { ascending: false });
      if (trashRes.error && !isMissingTableError(trashRes.error)) console.error('Could not read the Trash:', trashRes.error);
      const trash = trashRes.error ? [] : (trashRes.data || []);
      const trashedPapers = new Set(trash.filter(t => t.kind === 'paper').map(t => t.item_id));
      setTrashRows(trash);

      // Fetch own exams, incoming exam-shares, and section co-instructor memberships in parallel
      const [examsRes, inSharesRes, coSectionsRes] = await Promise.all([
        // Through the transitional reader so seatworks and schedules appear
        // once the migration has run, and so the "does assessments exist" probe
        // happens on dashboard load — createExam depends on knowing.
        selectAssessments(
          q => q.eq('instructor_id', instructorId).order('created_at', { ascending: true }),
          INSTRUCTOR_COLUMNS,
        ).then(data => ({ data, error: null }), error => ({ data: null, error })),
        supabase.from('exam_shares')
          .select('id, exam_id, shared_by')
          .eq('shared_with', instructorId),
        supabase.from('section_instructors')
          .select('id, section_name, instructor_id, added_by')
          .or(`added_by.eq.${instructorId},instructor_id.eq.${instructorId}`),
      ]);

      const examsData = (examsRes.data || []).filter(e => !trashedPapers.has(e.id));
      const inShares = inSharesRes.data || [];
      const allSectionRows = coSectionsRes.data || [];

      // Build section co-instructor map for sections I own (added_by = me).
      // Self-claims (instructor_id = me) are ownership markers, not colleagues.
      const newSectionCoMap = {};
      allSectionRows
        .filter(r => r.added_by === instructorId && r.instructor_id !== instructorId)
        .forEach(r => {
          if (!newSectionCoMap[r.section_name]) newSectionCoMap[r.section_name] = [];
          newSectionCoMap[r.section_name].push(r);
        });
      setSectionCoMap(newSectionCoMap);

      // Sections I claimed for myself — these hold the roster up on their own,
      // with or without an exam pointing at them.
      const claimedSectionNames = new Set(
        allSectionRows
          .filter(r => r.instructor_id === instructorId && r.added_by === instructorId)
          .map(r => r.section_name)
      );
      setClaimedSections(claimedSectionNames);

      // Sections I co-manage (added by another instructor, I am the co-instructor)
      const coManagedSectionNames = [
        ...new Set(allSectionRows.filter(r => r.instructor_id === instructorId && r.added_by !== instructorId).map(r => r.section_name))
      ];

      // Fetch shared exam data + outgoing shares + students + co-section exams in parallel
      const sharedExamIdsFromShares = [...new Set(inShares.map(s => s.exam_id))];
      const [sharedExamsRes, outSharesRes, studentsData, ...coSectionExamResults] = await Promise.all([
        // Through the reader, so a shared or co-taught MOCK exam is found too —
        // those live only in assessments and the legacy query missed them.
        sharedExamIdsFromShares.length > 0
          ? selectAssessments(q => q.in('id', sharedExamIdsFromShares), INSTRUCTOR_COLUMNS)
              .then(data => ({ data, error: null }), error => ({ data: null, error }))
          : Promise.resolve({ data: [] }),
        supabase.from('exam_shares').select('id, exam_id, shared_with').eq('shared_by', instructorId),
        fetchAllRows(() => supabase.from('users').select('id, full_name, section, course')),
        // For each co-managed section, fetch other instructors' exams targeting it
        ...coManagedSectionNames.map(sec =>
          selectAssessments(
            q => q.ilike('target_section', `%${sec}%`).neq('instructor_id', instructorId),
            INSTRUCTOR_COLUMNS,
          ).then(data => ({ data, error: null }), error => ({ data: null, error }))
        ),
      ]);

      const sharedExamsData = (sharedExamsRes.data || []).filter(e => !trashedPapers.has(e.id));
      const outShares = outSharesRes.data || [];

      // Merge exams from co-managed sections (verify exact section match client-side)
      const ownExamIdSet = new Set(examsData.map(e => e.id));
      const coSectionExams = [];
      const seenCoIds = new Set(sharedExamsData.map(e => e.id));
      coSectionExamResults.forEach((res, i) => {
        const secName = coManagedSectionNames[i];
        (res.data || []).forEach(exam => {
          // Exact section match — ensures "BSME 3A" doesn't match "BSME 30"
          const sections = (exam.target_section || '').split(',').map(s => s.trim());
          if (!sections.includes(secName)) return;
          if (ownExamIdSet.has(exam.id) || seenCoIds.has(exam.id) || trashedPapers.has(exam.id)) return;
          seenCoIds.add(exam.id);
          coSectionExams.push({ ...exam, _coSection: secName });
        });
      });

      // Combine all exam IDs for live monitor and results
      const ownExamIds = examsData.map(e => e.id);
      const sharedExamIds = [...sharedExamsData.map(e => e.id), ...coSectionExams.map(e => e.id)];
      const allExamIds = [...ownExamIds, ...sharedExamIds];
      instructorExamIdsRef.current = new Set(allExamIds);

      // Fetch results for all exams (paged — this routinely exceeds 1000 rows)
      const resultsData = allExamIds.length > 0
        ? await fetchAllRows(() => supabase.from('results')
            .select('student_id, exam_id, score, total_items, points_earned, points_total, work_marks, work_total, work_marked_at, tab_switches, time_taken_seconds, violation_logs, submitted_at')
            .in('exam_id', allExamIds))
        : [];

      // Every attempt on a retakeable paper. Kept out of `results` state on
      // purpose: the Results tab edits and deletes rows in the results table,
      // and an attempt row has no home there. Class Review folds them in.
      const attemptsData = allExamIds.length > 0
        ? await fetchAllRows(() => supabase.from('review_attempts')
            .select('student_id, assessment_id, attempt_no, score, total_items, points_earned, points_total, work_marks, work_total, time_taken_seconds, submitted_at')
            .in('assessment_id', allExamIds))
            .catch(err => { console.error('Could not load practice attempts:', err); return []; })
        : [];

      // Process own exam metadata
      const dict = {}, times = {}, secs = {}, passwords = {}, titles = {};
      examsData.forEach(e => {
        dict[e.id] = e.title;
        times[e.id] = e.duration_minutes;
        secs[e.id] = e.target_section || '';
        passwords[e.id] = e.exam_password || '';
        titles[e.id] = e.title;
      });
      // Add shared exam titles to dict for result modals
      sharedExamsData.forEach(e => { dict[e.id] = e.title; });

      setExamsList(examsData);
      setExamsDict(dict);
      setEditingTimes(times);
      setEditingSections(secs);
      setEditingPasswords(passwords);
      setEditingTitles(titles);

      const examSections = examsData.flatMap(
        e => (e.target_section || '').split(',').map(s => s.trim()).filter(Boolean)
      );
      const mySections = new Set([...examSections, ...claimedSectionNames, ...coManagedSectionNames]);
      setInstructorSections(mySections);

      // Anchor any section that is currently only being held up by an exam.
      // Without this, an instructor who has never added a student since this
      // change would still lose their roster the day they delete that exam.
      const unclaimed = [...new Set(examSections)].filter(n => !claimedSectionNames.has(n));
      if (unclaimed.length > 0) claimSections(unclaimed);

      // Build sharesMap (outgoing) keyed by exam ID
      const newSharesMap = {};
      outShares.forEach(s => {
        if (!newSharesMap[s.exam_id]) newSharesMap[s.exam_id] = [];
        newSharesMap[s.exam_id].push({ id: s.id, shared_with: s.shared_with });
      });
      setSharesMap(newSharesMap);

      // Build sharedExamsList (incoming exam-shares + co-section exams)
      const sharedList = [
        ...inShares.map(s => {
          const exam = sharedExamsData.find(e => e.id === s.exam_id);
          if (!exam) return null;
          return { ...exam, share_id: s.id, shared_by: s.shared_by };
        }).filter(Boolean),
        ...coSectionExams.map(e => ({ ...e, shared_by: e.instructor_id, _isCoSection: true })),
      ];
      setSharedExamsList(sharedList);

      // Process students
      const safeStudentsCopy = [...studentsData].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
      const studentDict = {}, studentSecs = {};
      // Show and edit only this instructor's slice of each student's sections.
      // `mySections` is the state-bound instructorSections of this load; the
      // rest of the student's enrolments stay in the database untouched and are
      // rejoined by saveStudentSection / batchUpdateSection.
      const mineOf = (str) => (str || '').split(',').map(x => x.trim())
        .filter(Boolean).filter(sec => mySections.has(sec));
      safeStudentsCopy.forEach(s => {
        studentDict[s.id] = {
          name: s.full_name || 'Unknown',
          section: mineOf(s.section).join(', ') || 'Unknown',
          course: s.course || null,
        };
        studentSecs[s.id] = mineOf(s.section).join(', ');
      });

      const myStudents = safeStudentsCopy.filter(s =>
        s.section && s.section.split(',').map(x => x.trim()).some(sec => mySections.has(sec))
      );

      setStudentsList(myStudents);
      setEditingStudentSections(studentSecs);
      setStudents(studentDict);
      setResults(resultsData || []);
      setPracticeAttempts(attemptsData || []);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  }
// The Trash list on its own, after a delete that needs no full reload.
  const refreshTrash = async () => {
    const { data, error } = await supabase.from('trash')
      .select('id, kind, item_id, label, detail, trashed_by, trashed_at, purge_after')
      .order('trashed_at', { ascending: false });
    if (!error) setTrashRows(data || []);
  };

  // A result goes to the Trash (sql/139). It leaves `results`, so the student
  // can sit the paper again, and comes back from the Trash unless they have.
  const deleteResult = async (studentId, examId) => {
    if (!window.confirm(`Move this score to the Trash?\n\nThe student can sit the paper again. You can restore the score for ${TRASH_DAYS} days, unless they have sat it again by then.`)) return;
    const { data, error } = await supabase.rpc('trash_result', { p_student: studentId, p_paper: examId });
    if (error) {
      console.error('Could not move result to the Trash:', error);
      alert(isMissingFunctionError(error)
        ? 'Deleting scores needs a database update (sql/139) that has not been run yet. Nothing was changed.'
        : 'Could not delete this score. Nothing was changed — please try again.');
      return;
    }
    if (data === 'not_yours') { alert('Only an instructor of this paper can delete its scores.'); return; }
    setResults(prev => prev.filter(r => !(r.student_id === studentId && r.exam_id === examId)));
    refreshTrash();
  };

  // --- NEW: Create Exam Function ---
  const createExam = async () => {
    if (!newTitle || !targetSection) return alert("Title and Section are required!");
    if (newOpensAt && newClosesAt && new Date(newClosesAt) <= new Date(newOpensAt)) {
      return alert('The closing time must be after the opening time.');
    }
    if (newKind === 'seatwork' && !assessmentsTableAvailable()) {
      return alert('Seatworks need the assessments table.\n\nRun sql/001_assessments_and_lessons.sql in the Supabase SQL editor first.');
    }
    setIsLoading(true);

    // datetime-local yields wall-clock with no zone; the Date constructor reads
    // it as local time, which is what the instructor meant, and toISOString
    // hands Postgres proper UTC.
    const toIso = (v) => (v ? new Date(v).toISOString() : null);

    const base = {
      title: newTitle,
      target_section: targetSection,
      instructor_id: instructorId,
      is_open: false,
      duration_minutes: Number(newDuration) || 60,
    };

    // Write to whichever table this database actually has. Before the
    // migration only plain exams are creatable, and they behave as today.
    const useAssessments = assessmentsTableAvailable();
    const table = useAssessments ? 'assessments' : 'exams';
    const row = useAssessments
      ? { ...base, kind: newKind, opens_at: toIso(newOpensAt), closes_at: toIso(newClosesAt), grade_base: newGradeBase, grade_base_ae: shownNewBaseAe }
      : base;

    const { data: newExam, error } = await supabase.from(table).insert([row]).select().single();

    if (error) {
      console.error(error);
      alert('Error creating ' + (newKind === 'seatwork' ? 'seatwork' : 'exam') + ': ' + error.message);
      setIsLoading(false);
      return;
    }

    // Bulk-insert questions from CSV if provided
    const csvQs = csvExamParsed?.questions || [];
    if (csvQs.length > 0 && newExam?.id) {
      // exam_id is still the column questions hang off; the migration keeps
      // assessment_id in step via trigger until the cutover.
      const payload = csvQs.map(q => ({ ...q, exam_id: newExam.id }));
      for (let i = 0; i < payload.length; i += 50) {
        await supabase.from('questions').insert(payload.slice(i, i + 50));
      }
    }

    await claimSections(targetSection);

    setNewTitle('');
    setTargetSection('');
    setNewOpensAt('');
    setNewClosesAt('');
    setNewDuration(60);
    setNewGradeBase(50);
    setNewGradeBaseAe(null);
    setCsvExamParsed(null);
    await fetchDashboardData();
    const label = newKind === 'seatwork' ? 'Seatwork' : 'Exam';
    alert(`${label} created!${csvQs.length > 0 ? ` ${csvQs.length} questions imported.` : ' Add questions in the Questions tab.'}`);
  };

  // Archive rather than delete: deleteExam takes the questions and the results
  // with it, and a finished paper's scores are the record of a semester.
  const toggleArchive = async (exam) => {
    const archiving = !exam.archived_at;
    if (archiving && exam.is_open &&
        !window.confirm(`"${exam.title}" is OPEN. Archiving will close it and hide it from students.\n\nArchive it?`)) return;
    try {
      await setAssessmentArchived(exam.id, archiving);
    } catch (e) {
      alert('Could not ' + (archiving ? 'archive' : 'restore') + ' this exam: ' + (e.message || e));
      return;
    }
    setExamsList(prev => prev.map(x => x.id === exam.id
      ? { ...x, archived_at: archiving ? new Date().toISOString() : null,
               is_open: archiving ? false : x.is_open }
      : x));
  };

  // Deleting a paper moves it to the Trash (sql/104): closed and hidden at
  // once, with its questions and results kept, and deleted for good only
  // after 30 days unrestored. That replaces "archive first, then delete":
  // a slip is now one Restore away.
  const deleteExam = async (examId) => {
    const exam = examsList.find(e => e.id === examId);
    const sat = results.filter(r => r.exam_id === examId).length;
    const title = exam?.title || 'this paper';
    const warning = `Move "${title}" to the Trash?\n\n` +
      'It closes and disappears from students now. ' +
      (sat > 0 ? `Its ${sat} result${sat === 1 ? '' : 's'} and its questions are kept. ` : 'Its questions are kept. ') +
      `You can restore it from the Trash for ${TRASH_DAYS} days; after that it is deleted for good` +
      (sat > 0 ? ', results and all.' : '.');
    if (!window.confirm(warning)) return;
    const { data, error } = await supabase.rpc('trash_papers', { p_paper_ids: [examId] });
    if (error) {
      console.error('Could not move paper to the Trash:', error);
      alert(isMissingFunctionError(error)
        ? 'Deleting papers needs a database update (sql/104) that has not been run yet. Nothing was changed.'
        : 'Could not delete this paper. Nothing was changed — please try again.');
      return;
    }
    if (data?.[0]?.outcome === 'not_yours') {
      alert('Only the instructor who owns this paper can delete it.');
      return;
    }
    fetchDashboardData();
  };

  // Back out of the Trash, exactly as it went in: a student's sections are
  // put back, a paper returns closed (and archived only if it was before).
  const restoreFromTrash = async (row) => {
    setRestoringTrash(row.id);
    const { data, error } = await supabase.rpc('restore_from_trash', { p_trash_ids: [row.id] });
    setRestoringTrash(null);
    if (error) {
      console.error('Could not restore from the Trash:', error);
      alert('Could not restore this. Nothing was changed — please try again.');
      return;
    }
    const outcome = data?.[0]?.outcome;
    if (outcome === 'not_yours') { alert('Only the instructor who deleted this, or the paper\'s owner, can restore it.'); return; }
    if (outcome === 'taken') { alert('This student has sat the paper again since. Delete that newer score first if this one should stand.'); return; }
    if (outcome === 'gone') alert('This was already deleted for good, so there was nothing to restore.');
    setExamQuestionsCache({});
    if (qExamId) loadQuestionList(qExamId);
    await fetchDashboardData();
  };

  // Sets on or off (sql/107). Nothing marks by set, so this is safe while a
  // paper is open; a sitting already started keeps the set it began with.
  const toggleSets = async (exam) => {
    const next = exam.uses_sets === false;
    try {
      await updateAssessment(exam.id, { uses_sets: next });
    } catch (e) {
      console.error('Could not switch sets:', e);
      alert(/uses_sets/.test(e?.message || '')
        ? 'Switching sets needs a database update (sql/107) that has not been run yet. Nothing was changed.'
        : 'Could not switch sets. Nothing was changed — please try again.');
      return;
    }
    setExamsList(prev => prev.map(e => e.id === exam.id ? { ...e, uses_sets: next } : e));
  };

  // Check-in on or off (sql/115): on, each student waits on the live monitor
  // until let in, every time they open the paper. A student already sitting
  // keeps their paper on screen and can still hand it in.
  const toggleAdmission = async (exam) => {
    const next = !exam.requires_admission;
    try {
      await updateAssessment(exam.id, { requires_admission: next });
    } catch (e) {
      console.error('Could not switch check-in:', e);
      alert(/requires_admission/.test(e?.message || '')
        ? 'Check-in needs a database update (sql/115) that has not been run yet. Nothing was changed.'
        : 'Could not switch check-in. Nothing was changed — please try again.');
      return;
    }
    setExamsList(prev => prev.map(e => e.id === exam.id ? { ...e, requires_admission: next } : e));
  };

  // 0-base or 50-base, for one group of students on one paper (sql/138, 145).
  // Marks are untouched, so it can go back; but students see the new percentage
  // at once, so it asks first.
  const toggleGradeBase = async (exam, column) => {
    const who = column === 'grade_base_ae' ? "BSAE and Pre-Eng'g students" : 'students on other courses';
    const next = Number(exam[column]) === 50 ? 0 : 50;
    const example = next === 50 ? '30/60 will read 75%, Passed.' : '30/60 will read 50%, Failed.';
    if (!window.confirm(`Show "${exam.title}" on ${next}-base for ${who}?\n\n${example} They see this straight away. No marks change, and you can switch back.`)) return;
    try {
      await updateAssessment(exam.id, { [column]: next });
    } catch (e) {
      console.error('Could not switch the grade base:', e);
      alert(/grade_base/.test(e?.message || '')
        ? 'Choosing a grade base needs a database update (sql/145) that has not been run yet. Nothing was changed.'
        : 'Could not switch the grade base. Nothing was changed — please try again.');
      return;
    }
    setExamsList(prev => prev.map(e => e.id === exam.id ? { ...e, [column]: next } : e));
  };

  // --- NEW: Toggle Exam Open/Close ---
  const toggleExamStatus = async (examId, currentStatus) => {
    const newStatus = !currentStatus;
    // One tap on a pill used to open a paper to whole sections, so it asks.
    const exam = examsList.find(e => e.id === examId);
    const title = exam?.title || 'this exam';
    const sections = splitSections(exam?.target_section || '').join(', ');
    const question = newStatus
      ? `Open “${title}”${sections ? ` for ${sections}` : ''}?\n\nStudents in ${sections ? 'those sections' : 'its sections'} can start it straight away.`
      : `Close “${title}”?\n\nIt goes from students' lists. Sittings already under way are not submitted.`;
    if (!window.confirm(question)) return;

    // Update Supabase
    try {
      await updateAssessment(examId, { is_open: newStatus });
    } catch (error) {
      alert('Could not change the open/closed state: ' + error.message);
      console.error(error);
      return;
    }

    // Update local screen immediately
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, is_open: newStatus } : e));
  };

  // --- Rename Exam Title ---
  const saveTitle = async (examId) => {
    const newTitle = (editingTitles[examId] || '').trim();
    if (!newTitle) return alert('Exam title cannot be empty.');
    let error = null;
    try { await updateAssessment(examId, { title: newTitle }); } catch (e) { error = e; }
    if (error) { alert('Error saving title: ' + error.message); return; }
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, title: newTitle } : e));
    setExamsDict(prev => ({ ...prev, [examId]: newTitle }));
  };

  // --- NEW: Save New Time Limit ---
  const saveTimeLimit = async (examId) => {
    const newTime = editingTimes[examId];
    
    if (!newTime || newTime <= 0) {
      alert("Please enter a valid number of minutes.");
      return;
    }

    let error = null;
    try { await updateAssessment(examId, { duration_minutes: parseInt(newTime) }); } catch (e) { error = e; }
    
    if (error) {
      alert("Error saving time limit. Please try again.");
      console.error(error);
      return;
    }

    alert("Time limit updated successfully!");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, duration_minutes: parseInt(newTime) } : e));
  };

  // --- NEW: Save Section Changes ---
  const saveSection = async (examId) => {
    const newSection = editingSections[examId] || '';
    
    let error = null;
    try { await updateAssessment(examId, { target_section: newSection }); } catch (e) { error = e; }

    if (error) {
      alert("Error saving section. Please try again.");
      console.error(error);
      return;
    }

    await claimSections(newSection);
    alert("Section updated successfully!");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, target_section: newSection } : e));
  };

  const savePassword = async (examId) => {
    const newPassword = editingPasswords[examId] || '';
    try {
      await updateAssessment(examId, {
        exam_password: newPassword || null,
        has_password: !!newPassword,
      });
    } catch (error) {
      alert('Could not save the password: ' + error.message);
      console.error(error);
      return;
    }
    alert(newPassword ? "Exam password saved!" : "Password cleared — no password required.");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, exam_password: newPassword || null, has_password: !!newPassword } : e));
  };

  // --- NEW: Save Student Section ---
  const saveStudentSection = async (studentId) => {
    // Guard: only allow editing students visible in this instructor's filtered list
    if (!studentsList.some(s => s.id === studentId)) {
      alert('You can only manage students in your sections.');
      return;
    }
    const mineNow = editingStudentSections[studentId] || '';

    // The picker only ever showed this instructor's sections, so the edited
    // value is just their slice. Rejoin it with the sections the student holds
    // under other instructors, or saving here would un-enrol them from those.
    const current = studentsList.find(s => s.id === studentId);
    const merged = mergeSections(mineNow, current?.section, instructorSections);

    const { error } = await supabase.from('users').update({ section: merged }).eq('id', studentId);

    if (error) {
      alert("Error updating student. Please try again.");
      console.error(error);
      return;
    }

    await claimSections(mineNow);
    alert("Student section updated successfully!");
    setStudentsList(prev => prev.map(s => s.id === studentId ? { ...s, section: merged } : s));
    setStudents(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], section: splitSections(mineNow).join(', ') || 'Unknown' }
    }));
  };

  const batchUpdateSection = async () => {
    if (selectedStudentIds.size === 0) return alert("Please select at least one student.");
    if (!batchSection.trim()) return alert("Please enter a section name.");
    if (!window.confirm(`Set ${selectedStudentIds.size} student(s) to "${batchSection.trim()}"?\n\nThis replaces the sections you have them in. Sections they have with other instructors are kept.`)) return;

    setIsBatchSaving(true);
    // Strip any IDs not in the instructor's visible student list (belt-and-suspenders)
    const ownedStudentIds = new Set(studentsList.map(s => s.id));
    const ids = [...selectedStudentIds].filter(id => ownedStudentIds.has(id));
    if (ids.length === 0) { setIsBatchSaving(false); return alert('None of the selected students are in your sections.'); }
    // This sets THIS instructor's slice of each student's sections. Whatever
    // the student holds under other instructors is carried over untouched, so
    // a batch assignment here cannot un-enrol anyone from a colleague's class.
    // The keep-list differs per student, so this cannot be one bulk update.
    const mine = batchSection.trim();
    const mergedById = new Map(ids.map(id => [
      id,
      mergeSections(mine, studentsList.find(s => s.id === id)?.section, instructorSections),
    ]));

    let error = null, done = 0;
    for (let i = 0; i < ids.length && !error; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const res = await Promise.all(chunk.map(id =>
        supabase.from('users').update({ section: mergedById.get(id) }).eq('id', id)
      ));
      error = res.find(r => r.error)?.error || null;
      if (!error) done += chunk.length;
    }

    if (error) {
      // Per-student writes mean a failure part-way leaves some already saved.
      // Say so, and reload rather than leave the table showing a state that
      // does not match the database.
      alert(done > 0
        ? `Updated ${done} of ${ids.length} students, then failed: ${error.message}\n\nReloading so the list matches the database.`
        : `Error updating students: ${error.message}`);
      setSelectedStudentIds(new Set());
      if (done > 0) await fetchDashboardData();
    } else {
      await claimSections(mine);
      setStudentsList(prev => prev.map(s => mergedById.has(s.id) ? { ...s, section: mergedById.get(s.id) } : s));
      setStudents(prev => {
        const updated = { ...prev };
        ids.forEach(id => { if (updated[id]) updated[id] = { ...updated[id], section: mine }; });
        return updated;
      });
      setEditingStudentSections(prev => {
        const updated = { ...prev };
        ids.forEach(id => { updated[id] = mine; });
        return updated;
      });
      setSelectedStudentIds(new Set());
      setBatchSection('');
    }
    setIsBatchSaving(false);
  };

  // A student is one account shared by every instructor who teaches them, so
  // this takes them out of YOUR sections and nothing more. It used to delete
  // the account outright, and with it every result the student had under
  // every instructor — one colleague clearing a class list wiped another's
  // course. The database now decides what removing leaves, and since
  // sql/104 it goes to the Trash for 30 days first; the dashboard only
  // asks, and reports what it did.
  const removeStudents = async (ids) => {
    const { data, error } = await supabase.rpc('trash_students', { p_student_ids: ids });
    if (error) {
      console.error('Could not remove students:', error);
      alert(isMissingFunctionError(error)
        ? 'Removing students needs a database update (sql/104) that has not been run yet. Nothing was changed.'
        : 'Could not remove the student(s). Nothing was changed — please try again.');
      return false;
    }
    setSelectedStudentIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    // Some are gone, some only left your sections and keep their results here:
    // rebuild from the server rather than guess which.
    await fetchDashboardData();
    alert(removalSummary(data));
    return true;
  };

  const deleteStudent = async (studentId) => {
    const student = studentsList.find(s => s.id === studentId);
    if (!student) return;
    if (!window.confirm(removalPrompt(1, student.full_name))) return;
    await removeStudents([studentId]);
  };

  const batchDeleteStudents = async () => {
    if (selectedStudentIds.size === 0) return;
    const ownedIds = new Set(studentsList.map(s => s.id));
    const ids = [...selectedStudentIds].filter(id => ownedIds.has(id));
    if (ids.length === 0) return;
    if (!window.confirm(removalPrompt(ids.length))) return;

    setIsBatchSaving(true);
    await removeStudents(ids);
    setIsBatchSaving(false);
  };

  // A course belongs to the student, not to a section, so unlike sections it
  // is written straight. Students see the new percentage on their next load.
  const saveCourses = async (ids, course) => {
    const value = course || null;
    let error = null, done = 0;
    for (let i = 0; i < ids.length && !error; i += 100) {
      const chunk = ids.slice(i, i + 100);
      ({ error } = await supabase.from('users').update({ course: value }).in('id', chunk));
      if (!error) done += chunk.length;
    }
    if (error) {
      console.error('Could not save the course:', error);
      alert(done > 0
        ? `Saved the course for ${done} of ${ids.length} students, then it failed. Reloading so the list matches the database.`
        : 'Could not save the course. Nothing was changed. Please try again.');
      if (done > 0) await fetchDashboardData();
      return false;
    }
    const saved = new Set(ids);
    setStudentsList(prev => prev.map(s => saved.has(s.id) ? { ...s, course: value } : s));
    setStudents(prev => {
      const next = { ...prev };
      ids.forEach(id => { if (next[id]) next[id] = { ...next[id], course: value }; });
      return next;
    });
    return true;
  };

  const batchSetCourse = async () => {
    const owned = new Set(studentsList.map(s => s.id));
    const ids = [...selectedStudentIds].filter(id => owned.has(id));
    if (ids.length === 0 || !batchCourse) return;
    if (!window.confirm(`Set ${ids.length} student(s) to ${batchCourse}?\n\nThe percentages they see follow their course. No marks change.`)) return;
    setIsBatchSaving(true);
    if (await saveCourses(ids, batchCourse)) { setSelectedStudentIds(new Set()); setBatchCourse(''); }
    setIsBatchSaving(false);
  };

  const createStudent = async () => {
    if (!newStudentName.trim()) return alert('Full name is required.');
    if (!newStudentEmail.trim()) return alert('Student email is required.');
    if (!newStudentCode.trim()) return alert('Student ID is required.');
    if (!newStudentSection.trim()) return alert('Section is required.');

    setIsAddingStudent(true);

    // Email is the identity of a student row and is still UNIQUE in the
    // database. The Student ID is NOT (sql/014): two students really do share
    // one, so a duplicate ID is allowed here — it is only half of a login
    // credential, and the other half, the email, still tells them apart.
    const email = newStudentEmail.trim().toLowerCase();
    const code = newStudentCode.trim();
    const [{ data: byEmail }, { data: sameCode }] = await Promise.all([
      supabase.from('users').select('id, full_name, section').eq('student_email', email).limit(1),
      supabase.from('users').select('id, full_name').eq('student_code', code).limit(2),
    ]);

    // A student already on file is not an error. They are almost always
    // somebody else's student who is now also in one of yours — a shared
    // elective, a repeat, a transfer — and the thing to do is add your section
    // to them, not refuse. Refusing used to leave no way through at all: the
    // roster only lists students in your own sections, so the very student you
    // needed to edit was the one you could not see.
    if (byEmail?.length > 0) {
      const them = byEmail[0];
      const want = newStudentSection.trim();
      const already = splitSections(them.section);
      setIsAddingStudent(false);

      if (already.includes(want)) {
        alert(`${them.full_name} is already in ${want}.`);
        return;
      }
      const theirs = already.filter(x => !instructorSections.has(x));
      if (!window.confirm(
        `${them.full_name} is already on file with that email` +
        (already.length ? `, in ${already.join(', ')}` : '') + '.\n\n' +
        `Add them to ${want} as well?` +
        (theirs.length ? `\n\nThey stay in ${theirs.join(', ')} — nothing is taken away from ` +
                         'the instructor who has them.' : ''))) return;

      setIsAddingStudent(true);
      const merged = [...already, want].join(', ');
      const { error: mergeErr } = await supabase.from('users')
        .update({ section: merged }).eq('id', them.id);
      setIsAddingStudent(false);
      if (mergeErr) return alert('Could not add them to your section: ' + mergeErr.message);

      await claimSections(want);
      if (newStudentCourse) {
        const { error: courseErr } = await supabase.from('users').update({ course: newStudentCourse }).eq('id', them.id);
        if (courseErr) console.error('Could not save the course:', courseErr);
      }
      setNewStudentName(''); setNewStudentEmail(''); setNewStudentCode(''); setNewStudentSection(''); setNewStudentCourse('');
      // They may not have been on this instructor's roster a moment ago, so
      // rebuild from the server rather than patching local state.
      await fetchDashboardData();
      alert(`${them.full_name} added to ${want}.`);
      return;
    }
    // Not a blocker, but it is nearly always a typo, so make it deliberate.
    if (sameCode?.length > 0 &&
        !window.confirm(
          `Student ID "${code}" already belongs to ${sameCode[0].full_name}.\n\n` +
          'Two students can share an ID, and they will still sign in separately ' +
          'with their own email addresses.\n\nAdd this student anyway?')) {
      setIsAddingStudent(false);
      return;
    }

    const { data: created, error } = await supabase.from('users').insert([{
      full_name: newStudentName.trim(),
      student_email: email,
      student_code: code,
      section: newStudentSection.trim(),
      course: newStudentCourse || null,
    }]).select().single();

    if (error) {
      alert('Error creating student: ' + error.message);
    } else {
      // Claim first: without the section on record the student would vanish
      // from the roster on the next reload unless an exam happened to target it.
      await claimSections(created.section);
      setStudentsList(prev => [...prev, created]);
      setStudents(prev => ({ ...prev, [created.id]: { name: created.full_name, section: created.section, course: created.course || null } }));
      setEditingStudentSections(prev => ({ ...prev, [created.id]: created.section }));
      setNewStudentName('');
      setNewStudentEmail('');
      setNewStudentCode('');
      setNewStudentSection('');
      setNewStudentCourse('');
      alert(`Student "${created.full_name}" added successfully.`);
    }
    setIsAddingStudent(false);
  };

  const handleTimeChange = (examId, value) => {
    setEditingTimes(prev => ({ ...prev, [examId]: value }));
  };

  const formatTime = (totalSeconds) => {
    if (!totalSeconds && totalSeconds !== 0) return "N/A";
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
  };

  // Every section this instructor could reasonably pick — and ONLY those.
  // instructorSections already folds in the sections their own assessments
  // target, the ones they have claimed, and the ones a colleague co-assigned
  // them, so it is the whole of what they hold. Deliberately NOT widened with
  // the sections found on student rows or on exams shared with them: those
  // carry other instructors' section names, which have no business in this
  // instructor's picker.
  const allKnownSections = [...instructorSections].sort((a, b) => a.localeCompare(b));

  const managedList = managedPapers(examsList, { query: manageQuery, status: manageStatus, showArchived });
  const managedTally = managedCounts(examsList, showArchived);

  const paperMeta = Object.fromEntries(examsList.map(e => [e.id, e]));
  const paperView = { titles: examsDict, meta: paperMeta, course: selectedCourse, showArchived: showArchivedResults };
  const resultCounts = {};
  results.forEach(r => { resultCounts[r.exam_id] = (resultCounts[r.exam_id] || 0) + 1; });
  const paperPicker = paperOptions({ ...paperView, counts: resultCounts, keep: selectedExam === 'All' ? null : selectedExam });

  const filteredAndSortedResults = gradedResults
    .filter(row => {
      const studentInfo = students[row.student_id] || {};
      // section is a comma-separated list — match membership, not the whole string,
      // or a student in "AENG 223L-2, AENG 223L" is invisible under either section.
      const matchesSection = selectedSection === 'All' ||
        (studentInfo.section || '').split(',').map(x => x.trim()).includes(selectedSection);
      const matchesExam = selectedExam === 'All'
        ? resultInView(row.exam_id, paperView)
        : row.exam_id === selectedExam;
      const q = resultQuery.trim().toLowerCase();
      const matchesName = !q || (studentInfo.name || '').toLowerCase().includes(q);
      return matchesSection && matchesExam && matchesName;
    })
    .sort((a, b) => {
      // On the score the column shows (src/lib/resultsStats.js), not the
      // picked-item count under it; equal scores fall back to the name.
      if (resultSort === 'score_desc' || resultSort === 'score_asc') {
        return compareByScore(a, b, resultSort === 'score_desc' ? 'desc' : 'asc')
          || (students[a.student_id]?.name || '').localeCompare(students[b.student_id]?.name || '');
      }
      if (resultSort === 'submitted_asc' || resultSort === 'submitted_desc') {
        return compareBySubmitted(a, b, resultSort === 'submitted_asc' ? 'asc' : 'desc')
          || (students[a.student_id]?.name || '').localeCompare(students[b.student_id]?.name || '');
      }
      if (resultSort === 'name') {
        const nameA = students[a.student_id]?.name || '';
        const nameB = students[b.student_id]?.name || '';
        return nameA.localeCompare(nameB);
      }
      // default: section
      const secA = students[a.student_id]?.section || 'Z';
      const secB = students[b.student_id]?.section || 'Z';
      const cmp = secA.localeCompare(secB);
      if (cmp !== 0) return cmp;
      return (students[a.student_id]?.name || '').localeCompare(students[b.student_id]?.name || '');
    });

  // Derive from actual result rows so shared-exam sections are always included.
  // Split the comma list into individual sections — same as the Students tab.
  const uniqueSections = ['All', ...[...new Set(
    results.flatMap(r => (students[r.student_id]?.section || '').split(',').map(x => x.trim()).filter(Boolean))
  )].sort()];

  // --- RESULTS STATISTICS ---
  // Over the scores the table shows; papers still waiting on worked marks are
  // left out and counted separately.
  const resultStats = resultStatistics(filteredAndSortedResults);

  // Sittings whose working never reached the result (src/lib/workRecovery.js).
  const missingWork = rowsMissingWork(results.filter(r => instructorExamIdsRef.current.has(r.exam_id)));
  const missingWorkKeys = new Set(missingWork.map(r => `${r.student_id}_${r.exam_id}`));

  const exportCSV = () => {
    // Same score as the table, plus when it was handed in (src/lib/resultsExport.js).
    const rows = filteredAndSortedResults.map(row => resultsCsvRow(
      row,
      students[row.student_id] || { name: 'Unknown', section: 'Unknown' },
      examsDict[row.exam_id] || 'Unknown Exam',
    ).join(','));
    const csv = [RESULTS_CSV_HEADERS.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const examLabel = selectedExam !== 'All' ? (examsDict[selectedExam] || 'exam').replace(/\s+/g, '_') : 'all_exams';
    const sectionLabel = selectedSection !== 'All' ? selectedSection.replace(/\s+/g, '_') : 'all_sections';
    a.download = `results_${examLabel}_${sectionLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return (
    <div className="dash-shell" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '240px 1fr', background: 'var(--paper)' }}>
      <div className="dash-side-placeholder" style={{ background: 'var(--navy)', height: '100vh' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <Icon name="clipboard" size={36} color="var(--navy)" style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Loading Dashboard…</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dash-shell" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '240px 1fr', background: 'var(--paper)' }}>

      {/* On a phone, the page behind the open drawer; a tap closes it. */}
      {sideOpen && <div className="dash-backdrop" onClick={() => setSideOpen(false)} aria-hidden="true" />}

      {/* ── SIDEBAR ── */}
      <aside id="dash-side" className={`dash-side${sideOpen ? ' is-open' : ''}`} style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--navy)', borderRight: '1px solid rgba(255,255,255,.07)',
        height: '100vh', position: 'sticky', top: 0,
      }}>
        {/* Logo */}
        <div style={{ height: 'var(--bar-h)', padding: '0 19px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: 36, objectFit: 'contain', display: 'block' }} />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 8px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Grouped by the job, with the rare, far-reaching ones (moving
              papers to another instructor) at the bottom rather than among
              the pages used every day. */}
          {[
            { group: 'Teach', items: [
              { id: 'home',       label: 'Overview',     icon: 'home' },
              { id: 'lessons',    label: 'Lessons',       icon: 'book' },
            ] },
            { group: 'Assess', items: [
              { id: 'manage',     label: 'Manage Exams',  icon: 'exam' },
              { id: 'questions',  label: 'Questions',     icon: 'question-bank' },
              { id: 'live',       label: 'Live Monitor',  icon: 'activity', badge: liveSessions.length > 0 ? String(liveSessions.length) : null, live: true },
            ] },
            { group: 'Results', items: [
              { id: 'results',    label: 'Results',       icon: 'bar-chart' },
              { id: 'class',      label: 'Class Review',  icon: 'graduation' },
              { id: 'practice',   label: 'Practice Results', icon: 'practice' },
              { id: 'attendance', label: 'Attendance',    icon: 'calendar' },
            ] },
            { group: 'Admin', items: [
              { id: 'students',   label: 'Students',      icon: 'users' },
              { id: 'transfer',   label: 'Transfer',      icon: 'arrow-up-right' },
              { id: 'trash',      label: 'Trash',         icon: 'trash', badge: trashRows.length > 0 ? String(trashRows.length) : null },
            ] },
          ].map(({ group, items }) => (
            <div key={group} role="group" aria-label={group} style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
              <div style={{ padding: '6px 11px 2px', fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,.55)' }}>
                {group}
              </div>
              {items.map(item => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveView(item.id); setLiveViolationTooltip(null); setSideOpen(false); }}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '6px 11px', borderRadius: 'var(--r-sm)',
                  border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                  // Where you are: a white pill floating on the navy.
                  background: active ? 'white' : 'transparent',
                  boxShadow: active ? '0 6px 14px -6px rgba(0,0,0,.55)' : 'none',
                  color: active ? 'var(--navy)' : 'rgba(255,255,255,.84)',
                  fontWeight: active ? 600 : 500,
                  fontSize: 13.5, transition: 'background var(--t-1), color var(--t-1)',
                }}
              >
                <Icon name={item.icon} size={17} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && (
                  <span style={{
                    background: item.live ? 'var(--live)' : 'rgba(255,255,255,.2)',
                    color: 'white', fontSize: 10.5, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 99, lineHeight: 1.6,
                  }}>{item.badge}</span>
                )}
              </button>
            );
              })}
            </div>
          ))}
        </nav>

        {/* Who is signed in, and the two things to do about it. */}
        <div style={{ padding: '10px 8px 10px 19px', borderTop: '1px solid rgba(255,255,255,.07)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--gold)', color: 'var(--navy)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700,
          }}>
            {nameInitials(displayInstructor(instructorName))}
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={displayInstructor(instructorName)}>
            {displayInstructor(instructorName)}
          </div>
          <button className="dash-side-icon" onClick={() => setShowPwModal(true)} aria-label="Change password" title="Change password">
            <Icon name="lock" size={16} />
          </button>
          <button className="dash-side-icon" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      {/* ── WORKSPACE ── */}
      <main className="dash-main" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden', background: 'var(--paper)' }}>

        {/* Toolbar */}
        <div className="dash-toolbar" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          minHeight: 'var(--bar-h)', padding: '0 20px',
          boxShadow: '0 1px 0 var(--line-soft), 0 8px 18px -14px rgba(10,35,66,.4)',
          background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10,
        }}>
          {/* Phones only: opens the sidebar. It carries the live count, so a
              sitting in progress shows without opening the menu. */}
          <button
            type="button"
            className="dash-menu-btn"
            onClick={() => setSideOpen(true)}
            aria-label={liveSessions.length > 0 ? `Open menu — ${liveSessions.length} live` : 'Open menu'}
            aria-expanded={sideOpen}
            aria-controls="dash-side"
          >
            <span className="dash-menu-bars" aria-hidden="true"><span /><span /><span /></span>
            {liveSessions.length > 0 && <span className="dash-menu-live">{liveSessions.length}</span>}
          </button>
          <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--ink-1)', flex: 1, minWidth: 0 }}>
            {({
              home: 'Overview',
              class: 'Class Review',
              results: 'Results',
              practice: 'Practice Results',
              manage: 'Manage Exams',
              lessons: 'Lessons',
              students: 'Students',
              live: 'Live Monitor',
              attendance: 'Attendance',
              questions: 'Questions',
              transfer: 'Transfer Exams',
              trash: 'Trash',
            })[activeView] || 'Dashboard'}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lastRefreshed && (
              <span className="dash-updated" style={{ fontSize: 11, color: 'var(--ink-4)' }}>Updated {lastRefreshed}</span>
            )}
            <button
              disabled={isRefreshing}
              onClick={async () => {
                setIsRefreshing(true);
                await Promise.all([fetchDashboardData(), fetchLiveSessions()]);
                setLastRefreshed(new Date().toLocaleTimeString());
                setIsRefreshing(false);
              }}
              className="btn ghost sm dash-refresh"
              style={{ opacity: isRefreshing ? 0.6 : 1 }}
            >
              <Icon name="refresh" size={13} />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Panel content */}
        <div className="dash-panel" ref={dashPanelRef} style={{ flex: 1, padding: '14px 20px', overflowY: 'auto' }}>

          {/* --- OVERVIEW HOME PANEL --- */}
          {activeView === 'home' && (
            <div>
              <div className="stat-strip stat-strip-tight">
                {[
                  { label: 'Open exams', value: examsList.filter(e => e.is_open).length, icon: 'exam', chip: 'gold' },
                  { label: 'Live now', value: liveSessions.length, icon: 'activity', chip: liveSessions.length > 0 ? 'bad' : 'navy', tone: liveSessions.length > 0 ? 'var(--live)' : undefined },
                  { label: 'Students', value: studentsList.length, icon: 'users', chip: 'navy' },
                  { label: 'Results', value: results.length, icon: 'bar-chart', chip: 'blue' },
                  { label: 'Pass rate', value: (() => { const scored = gradedResults.map(scoreFraction).filter(f => f !== null); if (scored.length === 0) return '–'; const p = scored.filter(f => f * 100 >= PASS_MARK).length; return `${Math.round((p / scored.length) * 100)}%`; })(), icon: 'trend-up', chip: 'ok', title: `Scored ${PASS_MARK}% or more, on every paper, archived too` },
                  // Worked maths items can only be marked in this browser
                  // (sql/024), so scripts sit waiting until somebody opens
                  // them. This tile is the prompt; the Results table says which.
                  ...(scriptsToMark > 0
                    ? [{ label: 'To mark', value: scriptsToMark, icon: 'edit', chip: 'gold', tone: 'var(--warn)' }]
                    : []),
                ].map(card => (
                  <div key={card.label} className="stat-cell" title={card.title}>
                    <span className={`chip chip-${card.chip}`}><Icon name={card.icon} size={18} /></span>
                    <div>
                      <div className="stat-cell-label">{card.label}</div>
                      <div className="stat-cell-value" style={card.tone ? { color: card.tone } : undefined}>{card.value}</div>
                    </div>
                  </div>
                ))}
              </div>
              {examsList.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--ink-4)' }}>No exams yet. Create one in Manage Exams.</p>
              ) : (
                <div className="row-list">
                  {[...examsList].filter(e => !e.archived_at)
                    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10).map(e => (
                    <div key={e.id} className="row-list-item">
                      <span title={e.is_open ? 'Open' : 'Closed'} style={{ width: 8, height: 8, borderRadius: '50%', background: e.is_open ? 'var(--ok)' : 'var(--ink-5)', flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40%' }}>{e.target_section}</span>
                    </div>
                  ))}
                </div>
              )}
              {examsList.filter(e => !e.archived_at).length > 10 && (
                <button className="btn ghost sm" style={{ marginTop: 8, width: 'auto' }} onClick={() => setActiveView('manage')}>
                  +{examsList.filter(e => !e.archived_at).length - 10} more
                </button>
              )}
            </div>
          )}

          {/* --- RESULTS PANEL --- */}
        {reviewSettingsFor && (
          <Suspense fallback={null}>
            <ReviewSettings
              assessment={reviewSettingsFor}
              sections={[...instructorSections, 'Pre-Boards PATTS']}
              onClose={() => setReviewSettingsFor(null)}
              onSaved={() => fetchDashboardData()}
            />
          </Suspense>
        )}

        {activeView === 'class' && (
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--ink-3)' }}>Loading class review…</div>}>
            <ClassReview
              studentsList={studentsList}
              results={gradedResults}
              practiceAttempts={gradedAttempts}
              examsList={examsList}
            />
          </Suspense>
        )}

        {activeView === 'practice' && (
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--ink-3)' }}>Loading practice results…</div>}>
            <PracticeResults
              attempts={gradedAttempts}
              students={students}
              examsDict={examsDict}
              examsList={examsList}
            />
          </Suspense>
        )}

        {activeView === 'lessons' && (
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--ink-3)' }}>Loading lessons…</div>}>
            <LessonsManager
              instructorId={instructorId}
              instructorSections={[...instructorSections]}
              onTrashed={refreshTrash}
            />
          </Suspense>
        )}

        {activeView === 'results' && (
          <div>
            {/* Rescore banner — only for 0/0 rows on a paper with picked
                items, which is exactly what rescoreZeroResults() repairs. Do
                not widen this to 0/N: the dashboard query does not select
                answers_json, so any test on it is always true and the banner
                would never clear. */}
            {repairableExamIds !== undefined && results.some(r =>
              r.total_items === 0 && instructorExamIdsRef.current.has(r.exam_id)
              && (repairableExamIds === null || repairableExamIds.has(r.exam_id))
            ) && (
              <div style={{ background: 'var(--warn-bg, #FFF8E1)', border: '1.5px solid var(--warn-bd, #F9A825)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="alert" size={16} color="var(--warn)" />
                  <span style={{ fontWeight: 600, color: 'var(--warn)', fontSize: 14 }}>Some results show 0/0</span>
                  <span style={{ color: 'var(--warn)', fontSize: 13 }}>— answers are saved on the server and can be re-scored</span>
                </div>
                <button
                  className="btn sm"
                  onClick={rescoreZeroResults}
                  disabled={isRescoring}
                  style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy-900)', width: 'auto', fontWeight: 700 }}
                >
                  {isRescoring ? 'Re-scoring…' : 'Fix 0/0 Results'}
                </button>
              </div>
            )}

            {/* Working that never reached the result (src/lib/workRecovery.js).
                Without this the row just reads 3/9 on a paper worth 67. */}
            {missingWork.length > 0 && (() => {
              const missing = missingWork;
              return (
                <div style={{ background: 'var(--warn-bg, #FFF8E1)', border: '1.5px solid var(--warn-bd, #F9A825)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Icon name="alert" size={16} color="var(--warn)" />
                    <span style={{ fontWeight: 600, color: 'var(--warn)', fontSize: 14 }}>
                      {missing.length} paper{missing.length === 1 ? ' is' : 's are'} missing {missing.length === 1 ? 'its' : 'their'} worked answers
                    </span>
                    <span style={{ color: 'var(--warn)', fontSize: 13 }}>— the working was kept in the live session and can be recovered and marked</span>
                  </div>
                  <button
                    className="btn sm"
                    onClick={recoverMissingWork}
                    disabled={isRecoveringWork}
                    style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy-900)', width: 'auto', fontWeight: 700 }}
                  >
                    {isRecoveringWork ? 'Recovering…' : 'Recover working'}
                  </button>
                </div>
              );
            })()}

            {/* Filters — on a phone, folded behind one button that says what is picked */}
            <div className={`card dash-filters${filtersOpen ? '' : ' is-collapsed'}`}>
              <button type="button" className="btn ghost sm dash-filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)}>
                <Icon name="sliders" size={14} />
                <span className="dash-filters-summary">
                  {[selectedCourse === 'All' ? 'All courses' : selectedCourse,
                    selectedExam === 'All' ? 'All papers' : (examsDict[selectedExam] || 'Paper'),
                    selectedSection === 'All' ? 'All sections' : selectedSection,
                    resultQuery.trim() ? `“${resultQuery.trim()}”` : null].filter(Boolean).join(' · ')}
                </span>
                <Icon name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={14} style={{ marginLeft: 'auto' }} />
              </button>
              <div className="dash-filter-field">
                <select className="input" aria-label="Course" value={selectedCourse}
                  onChange={e => { setSelectedCourse(e.target.value); setSelectedExam('All'); }}>
                  <option value="All">All courses</option>
                  {paperPicker.courses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="dash-filter-field dash-filter-grow">
                <select className="input" aria-label="Paper" value={selectedExam} onChange={e => setSelectedExam(e.target.value)}>
                  <option value="All">All papers{selectedCourse !== 'All' ? ` in ${selectedCourse}` : ''}</option>
                  {paperPicker.groups.map(g => (
                    <optgroup key={g.course} label={g.course}>
                      {g.papers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.count}){p.archived ? ' — archived' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="dash-filter-field">
                <select className="input" aria-label="Section" value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
                  {uniqueSections.map(sec => <option key={sec} value={sec}>{sec === 'All' ? 'All sections' : sec}</option>)}
                </select>
              </div>
              <div className="dash-filter-field">
                <input className="input" aria-label="Student name"
                  placeholder="Student" value={resultQuery} onChange={e => setResultQuery(e.target.value)} />
              </div>
              <div className="dash-filter-field">
                <select className="input" aria-label="Sort by" value={resultSort} onChange={e => setResultSort(e.target.value)}>
                  <option value="section">By section</option>
                  <option value="name">By name</option>
                  <option value="score_desc">Highest first</option>
                  <option value="score_asc">Lowest first</option>
                  <option value="submitted_asc">First to submit</option>
                  <option value="submitted_desc">Last to submit</option>
                </select>
              </div>
              {(paperPicker.hiddenArchived > 0 || showArchivedResults) && (
                <label className="dash-filter-field dash-filter-check">
                  <input type="checkbox" checked={showArchivedResults} onChange={e => setShowArchivedResults(e.target.checked)} />
                  Archived{!showArchivedResults ? ` (${paperPicker.hiddenArchived})` : ''}
                </label>
              )}
              {/* One row per submission, so a student appears once per exam —
                  counting rows as "students" overstated it badly (AENG 426 shows
                  1025 rows, which is 122 students across 15 exams). Show both. */}
              <span className="res-tail">
                <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  {filteredAndSortedResults.length} result{filteredAndSortedResults.length !== 1 ? 's' : ''}
                  {' · '}
                  {(() => {
                    const n = new Set(filteredAndSortedResults.map(r => r.student_id)).size;
                    return `${n} student${n !== 1 ? 's' : ''}`;
                  })()}
                </span>
                <button className="btn ghost sm" onClick={exportCSV} style={{ width: 'auto' }}><Icon name="download" size={14} /> CSV</button>
              </span>
            </div>

            {/* Stats and the spread of scores, one short band. */}
            {resultStats && (
              <div className="card res-summary">
                <div className="res-stats">
                  {[
                    { label: 'Mean', value: resultStats.mean },
                    { label: 'Median', value: resultStats.median },
                    { label: 'Pass rate', value: resultStats.passRate, plain: true },
                    { label: 'Highest', value: resultStats.highest },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="res-stat-label">{s.label}</div>
                      <div className="res-stat-value" style={s.plain ? undefined : { color: s.value >= PASS_MARK ? 'var(--ok)' : 'var(--bad)' }}>{s.value.toFixed(1)}%</div>
                    </div>
                  ))}
                  {resultStats.pending > 0 && (
                    <div className="res-pending">{resultStats.pending} to mark, not counted</div>
                  )}
                </div>
                <div className="res-chart" role="img" aria-label="Number of students in each score band">
                  <ResponsiveContainer width="100%" height={92}>
                    <BarChart data={resultStats.distribution} margin={{ top: 14, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="label" interval={0} tickFormatter={(l) => String(l).replace('%', '')} tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} height={18} />
                      <Tooltip formatter={(value) => [`${value} student${value !== 1 ? 's' : ''}`, 'Count']} contentStyle={{ fontSize: '12px', borderRadius: '6px' }} cursor={{ fill: 'var(--navy-50)' }} />
                      <Bar dataKey="count" radius={[5, 5, 1, 1]} isAnimationActive={false}>
                        {resultStats.distribution.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        <LabelList dataKey="count" position="top" formatter={(v) => (v > 0 ? v : '')} style={{ fontSize: 11, fill: 'var(--ink-2)', fontWeight: 600 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
                <table className="tbl tbl-stack tbl-results">
                  <thead>
                    <tr>
                      <th><span className="row-no">#</span>Student</th>
                      <th>Section</th>
                      {selectedExam === 'All' && <th>Paper</th>}
                      <th>Score</th>
                      <th>Submitted</th>
                      <th>Time</th>
                      <th>Flags</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedResults.length === 0 ? (
                      <tr><td colSpan={selectedExam === 'All' ? 8 : 7} style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-4)' }}>No results found.</td></tr>
                    ) : (
                      filteredAndSortedResults.map((row, index) => {
                        const student = students[row.student_id] || { name: 'Unknown', section: 'Unknown' };
                        const examTitle = examsDict[row.exam_id] || 'Unknown Exam';
                        // Worked items are marked here, in this browser, after
                        // the fact (sql/024), so a row can be half-marked. The
                        // percentage falls back to the picked-item one while
                        // marks are outstanding rather than showing a figure
                        // that will move on its own.
                        const m = combinedScore(row);
                        const percentage = m.pct !== null
                          ? m.pct
                          : (row.total_items > 0 ? Math.round((row.score / row.total_items) * 100) : 0);
                        const essayCount = (examQuestionsCache[row.exam_id] || []).filter(q => q.question_type === 'essay').length;
                        return (
                          <tr key={index}>
                            <td className="tbl-stack-title res-name" style={{ fontWeight: 600 }}><span className="row-no">{index + 1}</span>{formatName(student.name)}</td>
                            <td className="res-section" data-label="Section" style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{student.section}{student.course ? ` · ${student.course}` : ''}</td>
                            {selectedExam === 'All' && (
                              <td className="res-paper" data-label="Paper" title={examTitle} style={{ color: 'var(--ink-3)', fontSize: 12.5, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{examTitle}</td>
                            )}
                            <td className="res-score" data-label="Score" style={{ whiteSpace: 'nowrap' }}>
                              {/* The percentage has a fixed width so every
                                  fraction lines up under the header, 9% or
                                  100%. The manual-score pencil used to sit
                                  here too, but its test read answers_json,
                                  which this query never loads, so it showed
                                  on every row and pushed the scores out of
                                  line. It lives in the paper view now, where
                                  the answers are actually fetched. */}
                              <span style={{ display: 'inline-block', minWidth: '7ch', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{m.score}/{m.total}</span>
                              <span style={{ display: 'inline-block', minWidth: '5ch', textAlign: 'right', marginLeft: 6, color: m.pending > 0 ? 'var(--ink-4)' : (m.passed ?? percentage >= PASS_MARK) ? 'var(--ok)' : 'var(--bad)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.pending > 0 ? '—' : `${percentage}%`}</span>
                              {m.passed !== null && (
                                <span style={{ display: 'inline-block', marginLeft: 8, fontSize: 12, fontWeight: 600, color: m.passed ? 'var(--ok)' : 'var(--bad)', textAlign: 'left' }}>
                                  {gradeVerdict(m)}
                                </span>
                              )}
                              {essayCount > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--info)', marginTop: 2 }}>+{essayCount} essay{essayCount !== 1 ? 's' : ''}</span>}
                              {/* The only thing that tells an instructor a
                                  script is waiting on them. Without it the
                                  pending-marks window is invisible from this
                                  side and nobody ever opens the paper. */}
                              {missingWorkKeys.has(`${row.student_id}_${row.exam_id}`) && (
                                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--bad)', marginTop: 2 }}>
                                  working not saved
                                </span>
                              )}
                              {m.pending > 0 && (
                                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--warn)', marginTop: 2 }}>
                                  {m.pending} mark{m.pending === 1 ? '' : 's'} to mark
                                </span>
                              )}
                            </td>
                            <td className="res-submitted" data-label="Submitted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{shortDateTime(row.submitted_at) || '–'}</td>
                            <td className="res-time" data-label="Time" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{row.time_taken_seconds > 0 ? formatTime(row.time_taken_seconds) : '–'}</td>
                            <td className="res-flags" data-label="Flags">
                              {row.tab_switches > 0
                                ? <span className="px-pill bad" title={`${row.tab_switches} flagged`}><Icon name="flag" size={11} /> {row.tab_switches}</span>
                                : <span title="No flags" aria-label="No flags" style={{ color: 'var(--ok)', display: 'inline-flex' }}><Icon name="check" size={15} /></span>
                              }
                            </td>
                            <td className="res-actions" data-label="">
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => openStudentDetails(row)} className="btn ghost sm icon-btn" aria-label={`Open ${formatName(student.name)}'s paper`} title="Open paper"><Icon name="eye" size={15} /></button>
                                <button onClick={() => deleteResult(row.student_id, row.exam_id)} className="btn ghost sm icon-btn" aria-label={`Delete ${formatName(student.name)}'s score`} title="Move to Trash" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}><Icon name="trash" size={15} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

{/* --- MANAGE EXAMS PANEL --- */}
        {activeView === 'manage' && (
          <div>
            {/* Find a paper: most instructors have a term's worth of them. */}
            {examsList.length > 0 && (
              <div className="mx-toolbar">
                <div className="mx-search">
                  <Icon name="search" size={15} color="var(--ink-4)" />
                  <input
                    type="search"
                    className="input"
                    value={manageQuery}
                    onChange={e => setManageQuery(e.target.value)}
                    placeholder="Search by title or section"
                    aria-label="Search papers by title or section"
                  />
                </div>
                <div className="mx-segments" role="group" aria-label="Show papers">
                  {[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={manageStatus === id ? 'is-on' : ''}
                      aria-pressed={manageStatus === id}
                      onClick={() => setManageStatus(id)}
                    >
                      {label} <span>{managedTally[id]}</span>
                    </button>
                  ))}
                </div>
                {examsList.some(e => e.archived_at) && (
                  <button
                    onClick={() => setShowArchived(v => !v)}
                    className={showArchived ? 'btn sm' : 'btn ghost sm'}
                    style={{ width: 'auto' }}
                  >
                    <Icon name="archive" size={14} />
                    {showArchived ? 'Hide archived' : `Archived (${examsList.filter(e => e.archived_at).length})`}
                  </button>
                )}
              </div>
            )}

            {managedList.length === 0 && (
              <div className="card" style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '26px 18px', textAlign: 'center', marginBottom: 20 }}>
                {examsList.length === 0
                  ? 'No exams yet.'
                  : examsList.every(e => e.archived_at) && !showArchived
                    ? 'Every exam is archived. Use “Show archived” to bring one back.'
                    : 'No papers match. Try another search or filter.'}
              </div>
            )}

            <div className="mx-list">
            {managedList.map((exam) => {
              const sat = resultCounts[exam.id] || 0;
              const titleChanged = (editingTitles[exam.id] ?? exam.title) !== exam.title;
              const sectionChanged = editingSections[exam.id] !== (exam.target_section ?? '');
              const timeChanged = editingTimes[exam.id] != (exam.duration_minutes ?? '');
              const passwordChanged = (editingPasswords[exam.id] ?? '') !== (exam.exam_password || '');
              const live = exam.is_open && !exam.archived_at;
              return (
              <article key={exam.id} className={`card mx-card${live ? ' is-open' : ''}${exam.archived_at ? ' is-archived' : ''}`}>

                {/* Title, and the one thing asked most: is it open? */}
                <div className="mx-head">
                  <div className="mx-title">
                    {/* A text area only so a long title wraps instead of being
                        cut off on a phone; it is still one line of text. */}
                    <textarea
                      rows={1}
                      value={editingTitles[exam.id] ?? exam.title}
                      onChange={e => { const v = e.target.value.replace(/\s*\n\s*/g, ' '); setEditingTitles(prev => ({ ...prev, [exam.id]: v })); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveTitle(exam.id); } }}
                      className="input"
                      aria-label="Paper title"
                      title={editingTitles[exam.id] ?? exam.title}
                    />
                    {titleChanged && <button onClick={() => saveTitle(exam.id)} className="btn sm">Save</button>}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExamStatus(exam.id, exam.is_open)}
                    className={`mx-status${live ? ' is-open' : ''}`}
                    title={live ? 'Open to students. Click to close it.' : 'Students cannot see it. Click to open it.'}
                  >
                    <Icon name={live ? 'unlock' : exam.archived_at ? 'archive' : 'lock'} size={14} />
                    {exam.archived_at ? 'Archived' : live ? 'Open' : 'Closed'}
                  </button>
                </div>

                {/* Settings at a glance, each one a switch. */}
                <div className="mx-chips">
                  <span className="mx-count"><Icon name="users" size={13} /> {sat} submitted</span>
                  {/* A paper whose questions are in sets (sql/116) offers one
                      Start button per set whatever uses_sets says, so it
                      shows its sets and is not a switch. Otherwise Set A /
                      Set B is a label only; off, one Start button (sql/107). */}
                  {exam.set_labels?.length > 0 ? (
                    <span className="mx-chip is-fixed" title="Students choose their set at the Start button. The sets come from the questions.">
                      <Icon name="layers" size={13} /> {setsLabel(exam.set_labels)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSets(exam)}
                      className="mx-chip"
                      title={exam.uses_sets === false
                        ? 'Students see one Start button. Click to offer Set A and Set B.'
                        : 'Students choose Set A or Set B. Click for one Start button instead.'}
                    >
                      <Icon name={exam.uses_sets === false ? 'minus' : 'layers'} size={13} />
                      {exam.uses_sets === false ? 'No sets' : 'Sets A/B'}
                    </button>
                  )}
                  {/* Check-in (sql/115): each student waits on the live
                      monitor until let in, every time they open the paper. */}
                  <button
                    type="button"
                    onClick={() => toggleAdmission(exam)}
                    className={`mx-chip${exam.requires_admission ? ' is-on' : ''}`}
                    aria-pressed={!!exam.requires_admission}
                    title={exam.requires_admission
                      ? 'Check-in on: after the password, each student waits on the Live Monitor until you let them in — every time they open the paper. Click to turn off.'
                      : 'Check-in off: the password is enough. Click so that each student waits on the Live Monitor until you let them in.'}
                  >
                    <Icon name={exam.requires_admission ? 'shield-check' : 'shield'} size={13} />
                    {exam.requires_admission ? 'Check-in on' : 'Check-in off'}
                  </button>
                  {/* The percentage each group of students sees (sql/138, 145). */}
                  {[
                    { column: 'grade_base_ae', label: 'BSAE & Pre-Eng', who: "BSAE and Pre-Eng'g students" },
                    { column: 'grade_base', label: 'Others', who: 'All other students, including any with no course set' },
                  ].map(({ column, label, who }) => {
                    const base = gradeBaseOf({ grade_base: exam[column] });
                    return (
                      <button
                        key={column}
                        type="button"
                        onClick={() => toggleGradeBase(exam, column)}
                        className={`mx-chip${base === 50 ? ' is-on' : ''}`}
                        aria-label={`${who}: ${base}-base. Switch to ${base === 50 ? 0 : 50}-base.`}
                        title={`${who}: half marks is ${base === 50 ? '75%' : '50%'}. Pass mark 75. Click for ${base === 50 ? 0 : 50}-base.`}
                      >
                        <Icon name="trend-up" size={13} />
                        {label}: {base}-base
                      </button>
                    );
                  })}
                </div>

                {/* Who sits it, for how long, with what password. */}
                <div className="mx-fields">
                  <div className="mx-field">
                    <span className="mx-label"><Icon name="graduation" size={13} /> Sections</span>
                    <div className="mx-row">
                      <SectionPicker
                        value={editingSections[exam.id] !== undefined ? editingSections[exam.id] : ''}
                        onChange={next => setEditingSections(prev => ({ ...prev, [exam.id]: next }))}
                        options={allKnownSections}
                        placeholder="No sections"
                        compact
                      />
                      {sectionChanged && <button onClick={() => saveSection(exam.id)} className="btn sm">Save</button>}
                    </div>
                    {/* Co-instructor buttons per unique section name on this exam */}
                    {(exam.target_section || '').split(',').map(x => x.trim()).filter(Boolean).length > 0 && (
                      <div className="mx-row mx-coteach">
                                                {(exam.target_section || '').split(',').map(x => x.trim()).filter(Boolean).map(sec => (
                          <button
                            key={sec}
                            className="btn ghost sm"
                            onClick={() => { setSectionCoModal(sec); setSectionCoTarget(''); }}
                            title={`Manage co-instructors for ${sec}`}
                          >
                            <Icon name="user-plus" size={12} />
                            {sec}
                            {(sectionCoMap[sec] || []).length > 0 && (
                              <span className="px-pill info" style={{ fontSize: 10, padding: '1px 5px' }}>{(sectionCoMap[sec] || []).length}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mx-field">
                    <span className="mx-label"><Icon name="clock" size={13} /> Time limit</span>
                    <div className="mx-row">
                      <input
                        type="number"
                        value={editingTimes[exam.id] || ''}
                        onChange={(e) => handleTimeChange(exam.id, e.target.value)}
                        className="input mx-time"
                        aria-label={`Time limit in minutes for ${exam.title}`}
                      />
                      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>min</span>
                      {timeChanged && <button onClick={() => saveTimeLimit(exam.id)} className="btn sm">Save</button>}
                    </div>
                  </div>

                  <div className="mx-field">
                    <span className="mx-label">
                      <Icon name={exam.exam_password ? 'lock' : 'unlock'} size={13} />
                      {exam.exam_password ? 'Password set' : 'No password'}
                    </span>
                    <div className="mx-row">
                      <input
                        type={shownPasswords.has(exam.id) ? 'text' : 'password'}
                        value={editingPasswords[exam.id] !== undefined ? editingPasswords[exam.id] : ''}
                        onChange={(e) => setEditingPasswords(prev => ({ ...prev, [exam.id]: e.target.value }))}
                        placeholder="No password"
                        autoComplete="new-password"
                        aria-label={`Password for ${exam.title}`}
                        className="input mx-password"
                      />
                      <button
                        type="button"
                        className="btn ghost sm mx-icon"
                        onClick={() => setShownPasswords(prev => {
                          const next = new Set(prev);
                          if (next.has(exam.id)) next.delete(exam.id); else next.add(exam.id);
                          return next;
                        })}
                        aria-label={shownPasswords.has(exam.id) ? 'Hide password' : 'Show password'}
                        title={shownPasswords.has(exam.id) ? 'Hide password' : 'Show password'}
                      >
                        <Icon name={shownPasswords.has(exam.id) ? 'eye-off' : 'eye'} size={13} />
                      </button>
                      {exam.exam_password && (
                        <button
                          type="button"
                          className="btn ghost sm mx-icon"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(exam.exam_password);
                              setCopiedPassword(exam.id);
                              setTimeout(() => setCopiedPassword(c => (c === exam.id ? null : c)), 1500);
                            } catch {
                              alert('Could not copy. Use the eye button to show the password instead.');
                            }
                          }}
                          aria-label="Copy password"
                          title="Copy password"
                        >
                          <Icon name={copiedPassword === exam.id ? 'check' : 'copy'} size={13} />
                        </button>
                      )}
                      {passwordChanged && <button onClick={() => savePassword(exam.id)} className="btn sm">Save</button>}
                    </div>
                  </div>
                </div>

                {/* Most-used first; the two that take a paper away apart. */}
                <div className="mx-actions">
                  <button
                    onClick={() => setReviewSettingsFor({ ...exam, _resultCount: sat })}
                    className="btn sm"
                    title="Grade base, retakes, answer review and shuffling"
                  >
                    <Icon name="settings" size={14} /> Settings
                  </button>
                  <button
                    onClick={() => { handleQExamChange(exam.id); setActiveView('questions'); }}
                    className="btn ghost sm"
                    title="Add or edit this paper's questions"
                  >
                    <Icon name="question-bank" size={14} /> Questions
                  </button>
                  <button
                    onClick={() => { setSelectedCourse('All'); setSelectedExam(exam.id); setActiveView('results'); }}
                    className="btn ghost sm"
                    title="See this paper's scores on the Results tab"
                  >
                    <Icon name="bar-chart" size={14} /> Results
                  </button>
                  <button onClick={() => openExamStats(exam.id)} className="btn ghost sm" title="How the class did on each question">
                    <Icon name="activity" size={14} /> Analysis
                  </button>
                  <button onClick={() => setRescoreFor(exam)} className="btn ghost sm"
                    title="Mark every submitted paper again after you change a key">
                    <Icon name="clipboard-check" size={14} /> Re-score
                  </button>
                  <button onClick={() => openDupModal(exam)} className="btn ghost sm" title="Make a copy of this paper">
                    <Icon name="copy" size={14} /> Duplicate
                  </button>
                  <button onClick={() => openShareModal(exam)} className="btn ghost sm" title="Give another instructor access">
                    <Icon name="user-plus" size={14} /> Share
                    {(sharesMap[exam.id] || []).length > 0 && (
                      <span className="px-pill info" style={{ fontSize: 10, padding: '1px 5px' }}>{(sharesMap[exam.id] || []).length}</span>
                    )}
                  </button>
                  <span className="mx-actions-end">
                    <button
                      onClick={() => toggleArchive(exam)}
                      className="btn ghost sm"
                      title={exam.archived_at
                        ? 'Bring this back into the list. It stays closed.'
                        : 'Hide it from this list and from students. Questions and results are kept.'}
                    >
                      <Icon name={exam.archived_at ? 'undo' : 'archive'} size={14} />
                      {exam.archived_at ? 'Restore' : 'Archive'}
                    </button>
                    <button onClick={() => deleteExam(exam.id)} className="btn ghost sm mx-delete"
                      title={`Move to the Trash for ${TRASH_DAYS} days`}>
                      <Icon name="trash" size={14} /> Delete
                    </button>
                  </span>
                </div>
              </article>
              );
            })}
            </div>{/* end mx-list */}

          {/* Shared With Me */}
          {sharedExamsList.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Icon name="users" size={16} color="var(--navy)" />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink-1)' }}>Shared With Me</h4>
                <span className="px-pill brand">{sharedExamsList.length}</span>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="table-scroll">
                  <table className="tbl tbl-stack">
                    <thead>
                      <tr>
                        <th>Exam Title</th>
                        <th>Section</th>
                        <th>Status</th>
                        <th>Shared By</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sharedExamsList.map(exam => {
                        const owner = instructorsList.find(i => i.id === exam.shared_by);
                        return (
                          <tr key={exam.share_id}>
                            <td className="tbl-stack-title"><span style={{ fontWeight: 500 }}>{exam.title}</span></td>
                            <td data-label="Section">{exam.target_section || '—'}</td>
                            <td data-label="Status">
                              <span className={`px-pill ${exam.is_open ? 'ok' : 'muted'}`}>
                                {exam.archived_at ? <>Archived</> : exam.is_open ? <><Icon name="dot" size={10} /> Open</> : <>Closed</>}
                              </span>
                            </td>
                            <td data-label="Shared by">
                              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                {owner?.full_name || owner?.email || 'Unknown Instructor'}
                              </span>
                            </td>
                            <td data-label="">
                              <button
                                onClick={() => { if (window.confirm('Remove this shared exam from your dashboard?')) removeSharedAccess(exam.share_id); }}
                                className="btn ghost sm"
                                style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}
                              >
                                <Icon name="x" size={13} /> Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Create New Exam */}
          <div style={{ background: 'var(--navy-50)', border: '2px dashed var(--navy-200)', borderRadius: 'var(--r-lg)', padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="plus" size={16} color="var(--navy)" /> Create New Exam or Seatwork</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={downloadCSVTemplate} className="btn ghost sm"><Icon name="download" size={13} /> Template</button>
                <button onClick={downloadWeightedCSVTemplate} className="btn ghost sm"><Icon name="download" size={13} /> Template with points</button>
              </div>
            </div>

            {/* What the template is, said before anyone downloads it. Folded
                away by default so it does not push the form down every visit. */}
            <details style={{ marginBottom: 14, background: 'var(--surface)', border: '1px solid var(--navy-200)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--navy)' }}>
                How to make the questions CSV — a guide for each kind of paper
              </summary>
              <div style={{ marginTop: 12 }}><CsvGuide /></div>
            </details>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: '200px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Exam Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Midterm – Air Navigation"
                  style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Target Section</label>
                <div style={{ padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 6, minHeight: 40, display: 'flex', alignItems: 'center' }}>
                  <SectionPicker
                    value={targetSection}
                    onChange={setTargetSection}
                    options={allKnownSections}
                    placeholder="Pick a section"
                  />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: '130px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Type</label>
                <select value={newKind} onChange={e => setNewKind(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}>
                  <option value="exam">Exam</option>
                  <option value="seatwork">Seatwork</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label htmlFor="new-grade-base-ae" style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>BSAE & Pre-Eng'g</label>
                <select id="new-grade-base-ae" value={shownNewBaseAe} onChange={e => setNewGradeBaseAe(Number(e.target.value))} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}>
                  <option value={0}>0-base (half marks = 50%)</option>
                  <option value={50}>50-base (half marks = 75%)</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label htmlFor="new-grade-base" style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Other courses</label>
                <select id="new-grade-base" value={newGradeBase} onChange={e => setNewGradeBase(Number(e.target.value))} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}>
                  <option value={0}>0-base (half marks = 50%)</option>
                  <option value={50}>50-base (half marks = 75%)</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '110px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Minutes</label>
                <input type="number" min="1" value={newDuration}
                  onChange={e => setNewDuration(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }} />
              </div>
            </div>

            {/* Scheduling — optional. Left blank, availability is governed by
                the Open/Closed switch alone, exactly as before. */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Opens at (optional)</label>
                <input type="datetime-local" value={newOpensAt}
                  onChange={e => setNewOpensAt(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }} />
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Closes at (optional)</label>
                <input type="datetime-local" value={newClosesAt}
                  onChange={e => setNewClosesAt(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }} />
              </div>
            </div>
            {!assessmentsTableAvailable() && (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="info" size={13} />
                Seatworks and scheduling need the assessments table — run sql/001_assessments_and_lessons.sql, then reload.
              </p>
            )}

            {/* CSV Upload row */}
            <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Green only when the whole file can be used: a file whose
                  every row failed read "✓ 0 questions loaded". */}
              <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', ...(csvExamParsed
                ? (csvExamParsed.errors.length === 0
                  ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' }
                  : { borderColor: 'var(--bad-bd)', color: 'var(--bad)', background: 'var(--bad-bg)' })
                : {}) }}>
                <Icon name={!csvExamParsed ? 'file-text' : csvExamParsed.errors.length === 0 ? 'check' : 'alert'} size={14} />
                {!csvExamParsed ? 'Upload Questions CSV (optional)'
                  : csvExamParsed.errors.length === 0 ? `${csvExamParsed.questions.length} questions loaded`
                  : `${csvExamParsed.questions.length} of ${csvExamParsed.questions.length + csvExamParsed.errors.length} rows usable — choose the fixed file`}
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleCsvFileSelect(e, setCsvExamParsed)} />
              </label>
              {csvExamParsed && (
                <button onClick={() => setCsvExamParsed(null)} aria-label="Remove this file" style={{ width: 'auto', padding: '2px 6px', background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
              )}
              {csvExamParsed && csvExamParsed.errors.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--text-4)' }}>
                  {csvImportSummary(csvExamParsed.questions)}
                </span>
              )}
            </div>
            <CsvErrors errors={csvExamParsed?.errors}
              heading={`${csvExamParsed?.errors?.length === 1 ? 'One row' : `${csvExamParsed?.errors?.length} rows`} cannot be used. Fix them in your CSV and upload it again:`} />

            <div style={{ marginTop: 14 }}>
              <button
                onClick={createExam}
                disabled={!newTitle.trim() || !targetSection.trim() || (csvExamParsed?.errors?.length > 0)}
                className="btn"
              >
                <Icon name="plus" size={15} />
                {csvExamParsed?.questions?.length > 0 ? `Create ${newKind === 'seatwork' ? 'Seatwork' : 'Exam'} + Import ${csvExamParsed.questions.length} Questions` : `Create ${newKind === 'seatwork' ? 'Seatwork' : 'Exam'}`}
              </button>
            </div>
          </div>
          </div>
        )}

      {/* --- TAB 3: MANAGE STUDENTS --- */}
        {activeView === 'students' && (() => {
          // Sort by section then name
          const sortedStudents = [...studentsList].sort((a, b) => {
            const secCmp = (a.section || '￿').localeCompare(b.section || '￿');
            if (secCmp !== 0) return secCmp;
            return (a.full_name || '').localeCompare(b.full_name || '');
          });

          const filteredStudents = studentSectionFilter === 'All'
            ? sortedStudents
            : sortedStudents.filter(s =>
                (s.section || '').split(',').map(x => x.trim()).includes(studentSectionFilter)
              );

          // Unique sections for the filter dropdown — every section this
          // instructor holds, including any with no students yet, and nothing
          // else. Expanding student rows wholesale used to pull in the other
          // sections those students sit in under different instructors.
          const studentSections = ['All', ...[...instructorSections].sort()];

          const inSection = (str, sec) => (str || '').split(',').map(x => x.trim()).includes(sec);
          const mySectionChips = [...instructorSections].sort((a, b) => a.localeCompare(b)).map(sec => ({
            name: sec,
            students: studentsList.filter(s => inSection(s.section, sec)).length,
            exams: [...examsList, ...sharedExamsList].filter(e => inSection(e.target_section, sec)).length,
            claimed: claimedSections.has(sec),
          }));

          // Group filtered students by section for section headers. Header by
          // this instructor's slice only, so a student who also sits in a
          // colleague's class does not get a header naming that class.
          const groups = [];
          let lastSection = null;
          filteredStudents.forEach(student => {
            const sec = mySectionsOf(student.section).join(', ');
            if (sec !== lastSection) {
              groups.push({ type: 'header', section: sec || 'No Section' });
              lastSection = sec;
            }
            groups.push({ type: 'student', student });
          });

          return (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {mySectionChips.length > 0 && (
                    <div className="student-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {mySectionChips.map(chip => (
                        <span
                          key={chip.name}
                          className={`px-pill ${chip.students > 0 ? 'brand' : 'muted'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          title={
                            chip.students === 0 && chip.exams === 0
                              ? `${chip.name} is empty — no students, no exams`
                              : `${chip.name}: ${chip.students} student${chip.students !== 1 ? 's' : ''}, ${chip.exams} exam${chip.exams !== 1 ? 's' : ''}`
                          }
                        >
                          {chip.name}
                          <span style={{ opacity: 0.7 }}>{chip.students}</span>
                          {chip.claimed && chip.students === 0 && chip.exams === 0 && (
                            <button
                              onClick={() => releaseSection(chip.name)}
                              title={`Remove ${chip.name} from your sections`}
                              style={{ background: 'none', border: 'none', padding: 0, marginLeft: 2, cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, fontWeight: 700 }}
                            >×</button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn ghost sm" style={{ width: 'auto', flexShrink: 0 }} onClick={downloadStudentCSVTemplate}>
                  <Icon name="download" size={13} /> Template
                </button>
              </div>

              {/* Which students, and what to do with the ones ticked. */}
              <div className="card filter-row" style={{ borderColor: selectedStudentIds.size > 0 ? 'var(--navy)' : undefined }}>
                <div className="dash-filter-field">
                  <select
                    value={studentSectionFilter}
                    onChange={e => { setStudentSectionFilter(e.target.value); setSelectedStudentIds(new Set()); }}
                    className="input"
                    aria-label="Section"
                  >
                    {studentSections.map(sec => (
                      <option key={sec} value={sec}>{sec === 'All' ? 'All sections' : sec}</option>
                    ))}
                  </select>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  {selectedStudentIds.size > 0
                    ? `${selectedStudentIds.size} selected`
                    : `${filteredStudents.length} student${filteredStudents.length !== 1 ? 's' : ''}`}
                </span>
                <input
                  type="text"
                  value={batchSection}
                  onChange={e => setBatchSection(e.target.value)}
                  placeholder="New section for ticked students"
                  aria-label="Section to set for the selected students (replaces your sections for them)"
                  title="Replaces the sections you have these students in. Other instructors' sections are kept."
                  className="input"
                  style={{ flex: '1 1 200px', width: 'auto', minWidth: 0 }}
                />
                <button onClick={batchUpdateSection} disabled={isBatchSaving || selectedStudentIds.size === 0 || !batchSection.trim()} className="btn sm">
                  {isBatchSaving ? 'Saving…' : 'Set section'}
                </button>
                <select className="input" aria-label="Course to set for the selected students" value={batchCourse} onChange={e => setBatchCourse(e.target.value)} style={{ flex: '0 1 170px', width: 'auto', minWidth: 0 }}>
                  <option value="">Course for ticked…</option>
                  {COURSES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </select>
                <button onClick={batchSetCourse} disabled={isBatchSaving || selectedStudentIds.size === 0 || !batchCourse} className="btn sm">Set course</button>
                {selectedStudentIds.size > 0 && (
                  <>
                    <button onClick={batchDeleteStudents} disabled={isBatchSaving} className="btn sm danger"><Icon name="trash" size={13} /> Remove</button>
                    <button onClick={() => setSelectedStudentIds(new Set())} className="btn ghost sm">Clear</button>
                  </>
                )}
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
              <table className="tbl tbl-stack tbl-stack-block">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                        checked={filteredStudents.length > 0 && filteredStudents.every(s => selectedStudentIds.has(s.id))}
                        onChange={e => {
                          if (e.target.checked) setSelectedStudentIds(prev => new Set([...prev, ...filteredStudents.map(s => s.id)]));
                          else setSelectedStudentIds(prev => { const next = new Set(prev); filteredStudents.forEach(s => next.delete(s.id)); return next; });
                        }}
                      />
                    </th>
                    <th>Student Name</th>
                    <th>Section</th>
                    <th>Course</th>
                    <th>Edit Section</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-4)' }}>
                      {studentsList.length === 0
                        ? 'No students yet. Add your roster with Import Students from CSV below.'
                        : 'No students match this filter.'}
                    </td></tr>
                  ) : (
                    groups.map((item, idx) => {
                      if (item.type === 'header') {
                        return (
                          <tr key={`sec-${item.section}-${idx}`}>
                            <td colSpan="6" style={{ padding: '8px 14px', background: 'var(--navy-50)', borderTop: idx > 0 ? '1px solid var(--line)' : 'none', fontWeight: 600, fontSize: 12.5, color: 'var(--navy)', }}>
                              {item.section}
                            </td>
                          </tr>
                        );
                      }
                      const { student } = item;
                      const isChecked = selectedStudentIds.has(student.id);
                      return (
                        <tr
                          key={student.id}
                          style={{ background: isChecked ? 'var(--navy-50)' : undefined, cursor: 'pointer' }}
                          onClick={() => {
                            setSelectedStudentIds(prev => {
                              const next = new Set(prev);
                              if (next.has(student.id)) next.delete(student.id);
                              else next.add(student.id);
                              return next;
                            });
                          }}
                        >
                          <td data-label="" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              style={{ width: 16, height: 16, cursor: 'pointer' }}
                              checked={isChecked}
                              onChange={() => {
                                setSelectedStudentIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(student.id)) next.delete(student.id);
                                  else next.add(student.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="tbl-stack-title" style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-100)', color: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                {nameInitials(student.full_name)}
                              </div>
                              {formatName(student.full_name) || 'Unknown'}
                            </div>
                          </td>
                          <td data-label="Section"><span className="px-pill brand">{mySectionsOf(student.section).join(', ') || '—'}</span></td>
                          <td data-label="Course" onClick={e => e.stopPropagation()}>
                            <select className="input" aria-label={`Course of ${formatName(student.full_name) || 'this student'}`} value={student.course || ''} onChange={e => saveCourses([student.id], e.target.value)} style={{ minWidth: 112 }}>
                              <option value="">No course</option>
                              {COURSES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                            </select>
                          </td>
                          <td data-label="Edit section" onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <SectionPicker
                                value={editingStudentSections[student.id] !== undefined ? editingStudentSections[student.id] : ''}
                                onChange={next => setEditingStudentSections(prev => ({ ...prev, [student.id]: next }))}
                                options={allKnownSections}
                                placeholder="No sections"
                                compact
                              />
                              <button onClick={() => saveStudentSection(student.id)} className="btn sm" style={{ opacity: editingStudentSections[student.id] !== mySectionsOf(student.section).join(', ') ? 1 : 0.4 }}>Save</button>
                            </div>
                          </td>
                          <td data-label="" onClick={e => e.stopPropagation()}>
                            <button onClick={() => deleteStudent(student.id)} className="btn ghost sm" title="Remove from your sections" aria-label="Remove from your sections" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>
                              <Icon name="trash" size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>{/* end table-scroll */}
              </div>{/* end card */}

              {/* CSV IMPORT CARD */}
              <div className="card" style={{ marginTop: 16, padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                  <h4 style={{ margin: 0, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="upload" size={15} color="var(--navy)" /> Import Students from CSV
                  </h4>
                  <button className="btn ghost sm" onClick={downloadStudentCSVTemplate} style={{ width: 'auto' }}>
                    <Icon name="download" size={13} /> Download Template
                  </button>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-3)' }}>
                  CSV columns: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>full_name, student_email, student_id, section, course</code> — a student who is already on file is added to the section instead of being duplicated. Course is a code such as BSAE or BSAMT.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label
                    className="btn ghost sm"
                    style={{ width: 'auto', cursor: 'pointer', ...(studentCsvParsed ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' } : {}) }}
                  >
                    <Icon name={studentCsvParsed ? 'check' : 'file-text'} size={14} />
                    {studentCsvParsed ? `${studentCsvParsed.students.length} students ready` : 'Choose CSV file'}
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => setStudentCsvParsed(parseStudentCSV(ev.target.result));
                      reader.readAsText(file);
                      e.target.value = '';
                    }} />
                  </label>

                  {studentCsvParsed && studentCsvParsed.errors.length === 0 && (
                    <button
                      className="btn sm"
                      onClick={importStudentsFromCSV}
                      disabled={studentCsvImporting || studentCsvParsed.students.length === 0}
                      style={{ width: 'auto', opacity: studentCsvImporting ? 0.7 : 1 }}
                    >
                      {studentCsvImporting ? 'Importing…' : `Import ${studentCsvParsed.students.length} Student${studentCsvParsed.students.length !== 1 ? 's' : ''}`}
                    </button>
                  )}

                  {studentCsvParsed && (
                    <button
                      onClick={() => setStudentCsvParsed(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
                    >×</button>
                  )}
                </div>

                {studentCsvParsed?.errors?.length > 0 && (
                  <div style={{ marginTop: 12, background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                    <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--bad)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert" size={14} color="var(--bad)" /> Fix these errors before importing:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--bad)', fontSize: 12 }}>
                      {studentCsvParsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}

                {studentCsvParsed?.warnings?.length > 0 && (
                  <div style={{ marginTop: 12, background: 'var(--warn-bg, var(--surface-2))', border: '1px solid var(--warn-bd, var(--line))', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                    <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--warn, var(--ink-2))', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert" size={14} /> Worth a look — these do not block the import:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 12 }}>
                      {studentCsvParsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {/* ADD STUDENT FORM */}
              <div style={{ marginTop: 16, background: 'var(--navy-50)', border: '2px dashed var(--navy-200)', borderRadius: 'var(--r-lg)', padding: '20px 24px' }}>
                <h4 style={{ margin: '0 0 16px 0', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="user-plus" size={16} color="var(--navy)" /> Add New Student</h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 2, minWidth: '160px' }}>
                    <label className="label">Full Name</label>
                    <input className="input" type="text" value={newStudentName} onChange={e => setNewStudentName(e.target.value)} placeholder="e.g. Juan dela Cruz" maxLength={120} />
                  </div>
                  <div style={{ flex: 2, minWidth: '180px' }}>
                    <label className="label">Student Email</label>
                    <input className="input" type="email" value={newStudentEmail} onChange={e => setNewStudentEmail(e.target.value)} placeholder="e.g. juan@patts.edu.ph" maxLength={254} />
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label className="label">Student ID</label>
                    <input className="input" style={{ fontFamily: 'var(--font-mono)' }} type="text" value={newStudentCode} onChange={e => setNewStudentCode(e.target.value)} placeholder="e.g. 2021-1-1234" maxLength={30} />
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label className="label">Section</label>
                    <input className="input" type="text" value={newStudentSection} onChange={e => setNewStudentSection(e.target.value)} placeholder="e.g. Aero 101" maxLength={60} list="instructor-sections-list" />
                    <datalist id="instructor-sections-list">
                      {[...instructorSections].map(sec => <option key={sec} value={sec} />)}
                    </datalist>
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label className="label" htmlFor="new-student-course">Course</label>
                    <select id="new-student-course" className="input" value={newStudentCourse} onChange={e => setNewStudentCourse(e.target.value)}>
                      <option value="">No course</option>
                      {COURSES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <button className="btn" onClick={createStudent} disabled={isAddingStudent || !newStudentName.trim() || !newStudentEmail.trim() || !newStudentCode.trim() || !newStudentSection.trim()} style={{ opacity: isAddingStudent ? 0.7 : 1 }}>
                    <Icon name="user-plus" size={15} color="white" />
                    {isAddingStudent ? 'Adding…' : 'Add Student'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

{/* --- TAB 4: LIVE MONITOR --- */}
        {activeView === 'live' && (() => {
          // A row is hidden only when the paper behind it is genuinely settled
          // — see sittingAlreadyFiled(), which reads the retake switch so a
          // re-opened paper does not take its class off the monitor. A locked
          // student always stays visible; they are the one the instructor most
          // needs to be able to reach.
          const activeSessions = liveSessions.filter(s =>
            s.status === 'locked' || !sittingAlreadyFiled(s));
          const stuckCount = liveSessions.length - activeSessions.length;
          // A timed-out sitting on a retakeable paper is submitted by the sweep
          // above without anyone clicking, so it is not offered as work to do.
          const forceSubmittable = activeSessions.filter(s => isSessionForceSubmittable(s) && !isAutoSubmittable(s));

          // Everything still open, whether the clock has run out or not. This is
          // what "Submit All Now" ends: a class that started late still has time
          // on their timers, and the period has to close on schedule regardless.
          const openSittings = activeSessions.filter(s =>
            !isAutoSubmittable(s) && !sittingAlreadyFiled(s));

          // The last few incidents across everyone being watched, newest first —
          // the thing an instructor walking the room actually wants at eye level.
          const recentViolations = violationFeed(activeSessions, { limit: 8 });
          const flaggedStudents = new Set(recentViolations.map(v => v.studentId)).size;

          // Sections, filters and the waiting list (lib/liveMonitor.js). Each
          // row carries the section the student sits THIS paper under.
          const statusOfSitting = s => s.status === 'locked' ? 'locked' : isSessionForceSubmittable(s) ? 'timed_out' : 'active';
          const sittingRows = activeSessions.map(s => ({
            s, name: formatName(s.student_name), section: sittingSectionOf(s.student_id, s.exam_id),
            paperId: s.exam_id, status: statusOfSitting(s), enteredAt: s.created_at,
          }));
          const waitingRows = admissions.filter(r => isWaitingNow(r, admissionClock)).map(r => ({
            r, name: formatName(r.student_name), section: sittingSectionOf(r.student_id, r.assessment_id),
            paperId: r.assessment_id, status: 'waiting', requestedAt: r.requested_at,
          }));
          const placeFilter = { ...liveFilter, status: '' };
          // Sorted here rather than once in state, so a student who starts
          // while the monitor is open lands in order and the numbers stay right.
          const shownSittings = filterLive(sittingRows, liveFilter).sort(compareLive(liveSort));
          // The status filter is for sittings; whoever is waiting is shown
          // unless the section, paper or name filters rule them out.
          const shownWaiting = filterLive(waitingRows, placeFilter)
            .sort(compareWaiting(waitingSort));
          const liveSectionChoices = sectionOptions([...sittingRows, ...waitingRows]);
          const livePaperChoices = [...new Set([...sittingRows, ...waitingRows].map(r => r.paperId))]
            .map(id => ({ id, title: examsDict[id] || 'Paper' }))
            .sort((a, b) => a.title.localeCompare(b.title));
          const filtering = Object.values(liveFilter).some(v => v.trim && v.trim());
          const setFilter = (k, v) => setLiveFilter(f => ({ ...f, [k]: v }));

          return (
            <div>
              {/* WAITING TO ENTER — check-in papers (sql/115). First on the
                  page: a student is standing there holding their phone. */}
              {(waitingRows.length > 0 || anyCheckIn) && (
                <div className="card live-waiting" style={{ border: `1.5px solid ${waitingRows.length ? 'var(--navy)' : 'var(--line)'}`, borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: shownWaiting.length ? 10 : 0 }}>
                    <Icon name="shield-check" size={15} color="var(--navy)" />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--navy)' }}>
                      Waiting to enter
                    </span>
                    <span className={`px-pill${waitingRows.length ? ' live' : ''}`} style={{ fontSize: 11 }}>{waitingRows.length}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      {waitingRows.length
                        ? 'Check each student, then let them in. Every time they open the paper, they ask again.'
                        : 'Nobody is waiting. Students on a paper with check-in on appear here after the password.'}
                      {waitingRows.length > shownWaiting.length && ` ${waitingRows.length - shownWaiting.length} hidden by the filters below.`}
                    </span>
                    {waitingRows.length > 1 && (
                      <div role="group" aria-label="Order the waiting list" style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {[['name', 'A–Z'], ['section', 'By section'], ['arrival', 'First come']].map(([k, label]) => (
                          <button key={k} type="button" className="btn ghost sm" aria-pressed={waitingSort === k}
                            onClick={() => setWaitingSort(k)}
                            style={{ width: 'auto', padding: '4px 10px', fontSize: 12, ...(waitingSort === k ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}) }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {shownWaiting.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                      {shownWaiting.map(({ r, name, section }) => (
                        <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 10px', background: 'var(--bg)', borderRadius: 'var(--r-md, 10px)' }}>
                          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: 'var(--ink-1)', fontSize: 15, overflowWrap: 'anywhere' }}>{name || 'Student'}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
                              {[section || 'No section on this paper', examsDict[r.assessment_id] || 'Paper', `waiting ${waitedFor(r.requested_at, admissionClock)}`].join(' · ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flex: '0 1 auto', flexWrap: 'wrap' }}>
                            <button type="button" className="btn sm" disabled={!!deciding[r.id]}
                              onClick={() => decideAdmission(r, true)}
                              style={{ width: 'auto', minHeight: 38, fontWeight: 700 }}
                              aria-label={`Let ${name || 'this student'} in`}>
                              <Icon name="check" size={14} /> Let in
                            </button>
                            <button type="button" className="btn ghost sm" disabled={!!deciding[r.id]}
                              onClick={() => decideAdmission(r, false)}
                              style={{ width: 'auto', minHeight: 38 }}
                              aria-label={`Do not let ${name || 'this student'} in`}>
                              <Icon name="x" size={14} /> Not allowed
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* RECENT VIOLATIONS — the last few incidents, newest first */}
              {recentViolations.length > 0 && (
                <div style={{ background: 'var(--bad-bg)', border: '1.5px solid var(--bad-bd)', borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <Icon name="flag" size={14} color="var(--bad)" />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bad)' }}>
                      Recent violations
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      {flaggedStudents} student{flaggedStudents !== 1 ? 's' : ''} flagged · newest first
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {recentViolations.map(v => (
                      <span
                        key={v.key}
                        title={`${v.studentName} — ${v.reason}${v.stamp ? ` (${v.stamp})` : ''}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          background: 'var(--surface, white)',
                          border: `1px solid ${v.tone === 'bad' ? 'var(--bad-bd)' : 'var(--warn-bd)'}`,
                          borderLeft: `3px solid ${v.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'}`,
                          borderRadius: 'var(--r-sm)', padding: '5px 10px', fontSize: 12.5,
                          maxWidth: '100%',
                        }}
                      >
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                          {v.stamp || '—'}
                        </span>
                        <strong style={{ color: 'var(--ink-1)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                          {v.studentName}
                        </strong>
                        <span style={{ color: v.tone === 'bad' ? 'var(--bad)' : 'var(--warn)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {v.label}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Force-submit warning banner */}
              {forceSubmittable.length > 0 && (
                <div style={{ background: 'var(--warn-bg, #FFF8E1)', border: '1.5px solid var(--warn-bd, #F9A825)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert" size={16} color="var(--warn)" />
                    <span style={{ fontWeight: 600, color: 'var(--warn)', fontSize: 14 }}>
                      {forceSubmittable.length} student{forceSubmittable.length !== 1 ? 's' : ''} need{forceSubmittable.length === 1 ? 's' : ''} force submission
                    </span>
                    <span style={{ color: 'var(--warn)', fontSize: 13 }}>— time expired or exam closed</span>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => setForceSubmitConfirmList(forceSubmittable)}
                    style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy-900)', width: 'auto', fontWeight: 700 }}
                  >
                    <Icon name="send" size={13} color="var(--navy-900)" /> Force Submit All ({forceSubmittable.length})
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '10px' }}>
                <span className="px-pill live" style={{ fontSize: '12.5px' }}>{activeSessions.length} active</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className={`btn ghost sm${liveSort === 'name' ? '' : ''}`} onClick={() => setLiveSort('name')} style={liveSort === 'name' ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}}>A–Z Name</button>
                  <button className="btn ghost sm" onClick={() => setLiveSort('section')} style={liveSort === 'section' ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}}>By Section</button>
                  <button className="btn ghost sm" onClick={() => setLiveSort('entered')} style={liveSort === 'entered' ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}}>Time Entered</button>
                  {stuckCount > 0 && (
                    <button className="btn ghost sm" onClick={clearStuckSessions}>
                      <Icon name="x" size={14} /> Clear {stuckCount} Finished
                    </button>
                  )}
                  {openSittings.length > 0 && (
                    <button
                      className="btn sm danger"
                      onClick={() => setForceSubmitConfirmList(openSittings)}
                      style={{ width: 'auto', fontWeight: 700 }}
                      title="Submit every open exam right now, including students who still have time left"
                    >
                      <Icon name="send" size={13} color="var(--bad)" /> Submit All Now ({openSittings.length})
                    </button>
                  )}
                </div>
              </div>
              {/* FILTERS — section, paper, status, name */}
              {(sittingRows.length > 0 || waitingRows.length > 0) && (
                <div className="card filter-row live-filters">
                  <div className="dash-filter-field">
                    <select id="live-f-section" aria-label="Section" className="input" value={liveFilter.section} onChange={e => setFilter('section', e.target.value)}>
                      <option value="">All sections</option>
                      {liveSectionChoices.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                    </select>
                  </div>
                  <div className="dash-filter-field dash-filter-grow">
                    <select id="live-f-paper" aria-label="Paper" className="input" value={liveFilter.paper} onChange={e => setFilter('paper', e.target.value)}>
                      <option value="">All papers</option>
                      {livePaperChoices.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </div>
                  <div className="dash-filter-field">
                    <select id="live-f-status" aria-label="Status" className="input" value={liveFilter.status} onChange={e => setFilter('status', e.target.value)}>
                      <option value="">Any status</option>
                      <option value="active">Active</option>
                      <option value="locked">Locked</option>
                      <option value="timed_out">Timed out</option>
                    </select>
                  </div>
                  <div className="dash-filter-field" style={{ flex: '1 1 150px' }}>
                    <input id="live-f-name" aria-label="Name" className="input" type="search" placeholder="Search a name" value={liveFilter.query}
                      onChange={e => setFilter('query', e.target.value)} />
                  </div>
                  {filtering && (
                    <button type="button" className="btn ghost sm" style={{ width: 'auto' }}
                      onClick={() => setLiveFilter({ section: '', paper: '', status: '', query: '' })}>
                      <Icon name="x" size={13} /> Clear
                    </button>
                  )}
                  {filtering && (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)', alignSelf: 'center' }}>
                      {shownSittings.length} of {sittingRows.length}
                    </span>
                  )}
                </div>
              )}

              <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
              <table className="tbl tbl-stack">
                <thead>
                  <tr>
                    <th><span className="row-no">#</span>Student Name</th>
                    <th>Section</th>
                    <th>Exam Taking</th>
                    <th>Entered</th>
                    <th>Status</th>
                    <th>Answered</th>
                    <th>Violations</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr><td colSpan="8" style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-3)' }}>No students are sitting a paper right now. Open one in Manage Exams — students appear here as they start.</td></tr>
                  ) : shownSittings.length === 0 ? (
                    <tr><td colSpan="8" style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-3)' }}>No sitting matches these filters. <button type="button" className="btn ghost sm" style={{ width: 'auto', marginLeft: 6 }} onClick={() => setLiveFilter({ section: '', paper: '', status: '', query: '' })}>Clear filters</button></td></tr>
                  ) : (
                    shownSittings.map(({ s: session, section }, index) => (
                      <tr key={session.id} style={
                        session.status === 'locked' ? { background: 'var(--bad-bg)' }
                        : isSessionForceSubmittable(session) ? { background: 'var(--warn-bg, #FFFDE7)' }
                        : {}
                      }>
                        <td className="tbl-stack-title live-name" style={{ fontWeight: 600, color: 'var(--ink-1)' }}><span className="row-no">{index + 1}</span>{formatName(session.student_name)}</td>
                        <td data-label="Section" style={{ color: 'var(--ink-2)' }}>{section || '—'}</td>
                        <td data-label="Paper" style={{ color: 'var(--navy)', fontWeight: 500 }}>{examsDict[session.exam_id] || '—'}</td>
                        <td data-label="Entered" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{submittedDateTime(session.created_at).time || '—'}</td>
                        <td data-label="Status">
                          {session.status === 'locked'
                            ? <span className="px-pill bad"><Icon name="lock" size={11} /> LOCKED</span>
                            : isSessionForceSubmittable(session)
                              ? <span className="px-pill" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid var(--warn-bd)', fontSize: 11 }}>
                                  <Icon name="alert" size={11} color="var(--warn)" /> TIMED OUT
                                </span>
                              : <span className="px-pill ok"><Icon name="dot" size={11} /> Active</span>}
                        </td>
                        <td data-label="Answered" style={{ fontWeight: 700, color: 'var(--ink-1)' }}>{session.answers_count}</td>
                        <td data-label="Flags">
                          <div style={{ position: 'relative', display: 'inline-block' }}
                            onMouseEnter={e => {
                              if (session.violation_count > 0) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setLiveViolationTooltip({ session, rect });
                              }
                            }}
                            onMouseLeave={() => setLiveViolationTooltip(null)}
                            // A phone has no hover: a tap opens the flags, and a second tap closes them.
                            onClick={e => {
                              if (!(session.violation_count > 0)) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              setLiveViolationTooltip(t => (t?.session.id === session.id ? null : { session, rect }));
                            }}
                          >
                            <span
                              className={`px-pill ${session.violation_count >= 2 ? 'bad' : session.violation_count === 1 ? 'warn' : 'ok'}`}
                              style={session.violation_count > 0 ? { cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 } : {}}
                            >
                              {session.violation_count}
                              {session.violation_count > 0 && <Icon name="flag" size={10} style={{ marginLeft: 4 }} />}
                            </span>
                          </div>
                        </td>
                        <td data-label="">
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {isAutoSubmittable(session) ? (
                              <span className="px-pill" style={{ fontWeight: 600 }}>
                                <Icon name="send" size={11} style={{ marginRight: 4 }} /> Auto-submitting…
                              </span>
                            ) : isSessionForceSubmittable(session) ? (
                              <button
                                className="btn sm"
                                onClick={() => setForceSubmitConfirmList([session])}
                                style={{ width: 'auto', background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy-900)', fontWeight: 700 }}
                              >
                                <Icon name="send" size={13} color="var(--navy-900)" /> Force Submit
                              </button>
                            ) : (
                              <button className={`btn sm ${session.status === 'locked' ? '' : 'danger'}`} onClick={() => toggleStudentLock(session.id, session.status)} style={{ width: 'auto' }}>
                                {session.status === 'locked' ? <><Icon name="unlock" size={13} /> Unlock</> : <><Icon name="lock" size={13} /> Lock</>}
                              </button>
                            )}
                            {/* Only ever offered on a row with nothing to lose.
                                A sitting with answers in it is force-submitted,
                                not dismissed — see dismissSession(). */}
                            {canDismissSession(session, { hasResult: sittingAlreadyFiled(session) }) && (
                              <button className="btn ghost sm" onClick={() => dismissSession(session)} style={{ width: 'auto' }}
                                title="Nothing has been answered — take this empty row off the monitor">
                                <Icon name="x" size={13} /> Dismiss
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>{/* end table-scroll */}
              </div>{/* end card */}
            </div>
          );
        })()}

      {/* --- TAB 5: ATTENDANCE --- */}
      {activeView === 'attendance' && (() => {
        const examObj = examsList.find(e => e.id === attendanceExam);

        // Show all instructor students — filter by section if one is selected,
        // otherwise scope to the selected exam's sections so the list isn't overwhelming.
        let eligibleStudents = studentsList;
        if (attendanceSection !== 'All') {
          // Specific section chosen: show those students regardless of which exam
          eligibleStudents = studentsList.filter(s =>
            s.section && s.section.split(',').map(x => x.trim()).includes(attendanceSection)
          );
        } else if (examObj?.target_section) {
          // "All" selected: scope to the exam's sections
          const examSections = examObj.target_section.split(',').map(s => s.trim().toLowerCase());
          eligibleStudents = studentsList.filter(s => {
            if (!s.section) return false;
            return s.section.split(',').map(x => x.trim().toLowerCase()).some(sec => examSections.includes(sec));
          });
        }

        const getStatus = (studentId) => {
          if (!attendanceExam) return null;
          if (results.some(r => r.student_id === studentId && r.exam_id === attendanceExam)) return 'done';
          const session = liveSessions.find(ls => ls.student_id === studentId && ls.exam_id === attendanceExam);
          if (session) return session.status === 'locked' ? 'locked' : 'active';
          return 'absent';
        };

        const statusCounts = { done: 0, active: 0, locked: 0, absent: 0 };
        eligibleStudents.forEach(s => {
          const st = getStatus(s.id);
          if (st) statusCounts[st]++;
        });

        // Only the sections this instructor holds. Expanding student rows here
        // used to surface the other sections those students sit in elsewhere.
        const allAttendanceSections = new Set(instructorSections);
        const sectionOptions = allAttendanceSections.size > 0
          ? ['All', ...[...allAttendanceSections].sort()]
          : ['All'];

        const exportAttendanceCSV = () => {
          const headers = ['Student Name', 'Section', 'Status', 'Date Taken', 'Time Submitted'];
          const rows = eligibleStudents.map(s => {
            const st = getStatus(s.id);
            const label = st === 'done' ? 'Done' : st === 'active' ? 'Taking Exam' : st === 'locked' ? 'LOCKED' : 'Absent';
            // When a Done paper was handed in, in Philippine time; blank for
            // everyone who has not handed one in.
            const filed = st === 'done'
              ? results.find(r => r.student_id === s.id && r.exam_id === attendanceExam)
              : null;
            const when = submittedDateTime(filed?.submitted_at);
            return [`"${s.full_name}"`, `"${s.section || ''}"`, `"${label}"`, when.date, when.time].join(',');
          });
          const csv = [headers.join(','), ...rows].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `attendance_${(examObj?.title || 'exam').replace(/\s+/g, '_')}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        return (
          <div>
            {/* Filters */}
            <div className="card filter-row">
              <div className="dash-filter-field dash-filter-grow">
                <select className="input" aria-label="Exam" value={attendanceExam} onChange={e => { setAttendanceExam(e.target.value); setAttendanceSection('All'); }}>
                  <option value="">— Choose an exam —</option>
                  {sharedExamsList.length > 0 ? (
                    <>
                      <optgroup label="My Exams">
                        {examsList.map(e => <option key={e.id} value={e.id}>{e.title}{e.archived_at ? ' (archived)' : ''}</option>)}
                      </optgroup>
                      <optgroup label="Shared With Me">
                        {sharedExamsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                      </optgroup>
                    </>
                  ) : (
                    examsList.map(e => <option key={e.id} value={e.id}>{e.title}{e.archived_at ? ' (archived)' : ''}</option>)
                  )}
                </select>
              </div>
              {attendanceExam && (
                <div className="dash-filter-field">
                  <select className="input" aria-label="Section" value={attendanceSection} onChange={e => setAttendanceSection(e.target.value)}>
                    {sectionOptions.map(sec => <option key={sec} value={sec}>{sec === 'All' ? 'All sections' : sec}</option>)}
                  </select>
                </div>
              )}
              {attendanceExam && eligibleStudents.length > 0 && (
                <button className="btn ghost sm" onClick={exportAttendanceCSV} style={{ marginBottom: 1 }}>
                  <Icon name="download" size={14} /> CSV
                </button>
              )}
            </div>

            {!attendanceExam ? (
              <p style={{ color: 'var(--ink-3)', textAlign: 'center', padding: '40px' }}>Choose an exam above to see who has sat it.</p>
            ) : (
              <>
                {/* Summary pills */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <span className="px-pill brand">Total: {eligibleStudents.length}</span>
                  <span className="px-pill ok">Done: {statusCounts.done}</span>
                  <span className="px-pill warn">Taking Exam: {statusCounts.active}</span>
                  <span className="px-pill bad">Locked: {statusCounts.locked}</span>
                  <span className="px-pill muted">Absent: {statusCounts.absent}</span>
                </div>

                {eligibleStudents.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)', textAlign: 'center', padding: '20px' }}>No students are enrolled in this exam's sections. Add them on the Students page, or check the exam's sections in Manage Exams.</p>
                ) : (
                  <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="table-scroll">
                  <table className="tbl tbl-stack tbl-attendance">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Student Name</th>
                        <th>Section</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleStudents.map((s, idx) => {
                        const st = getStatus(s.id);
                        const pillClass = { done: 'ok', active: 'warn', locked: 'bad', absent: 'muted' }[st] || 'muted';
                        const pillLabel = { done: 'Done', active: 'Taking Exam', locked: 'Locked', absent: 'Absent' }[st] || '—';
                        const rowBg = st === 'done' ? 'var(--ok-bg)' : st === 'locked' ? 'var(--bad-bg)' : st === 'active' ? 'var(--warn-bg)' : '';

                        return (
                          <tr key={s.id} style={rowBg ? { background: rowBg } : {}}>
                            <td className="att-no" data-label="#" style={{ color: 'var(--ink-4)', width: 40 }}>{idx + 1}</td>
                            <td className="tbl-stack-title att-name" style={{ fontWeight: 600 }}>{formatName(s.full_name) || 'Unknown'}</td>
                            <td className="att-section" data-label="Section" style={{ color: 'var(--ink-2)' }}>{s.section || '—'}</td>
                            <td className="att-status" data-label="Status"><span className={`px-pill ${pillClass}`}>{pillLabel}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* --- TAB 6: QUESTION MANAGEMENT --- */}
      {activeView === 'questions' && (
        <div>
          {/* Exam selector */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <label className="label">Select Exam to Manage</label>
            {(() => {
              // Current papers first, by title so a course's papers sit
              // together; archived ones only when asked for (or when one is
              // the paper already open here).
              const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
              const current = examsList.filter(e => !e.archived_at).sort(byTitle);
              const archived = examsList.filter(e => e.archived_at).sort(byTitle);
              const showArch = qShowArchived || archived.some(e => e.id === qExamId);
              return (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="input" style={{ maxWidth: '420px', flex: '1 1 260px' }} value={qExamId} onChange={e => handleQExamChange(e.target.value)}>
                    <option value="">— Choose an exam —</option>
                    <optgroup label={sharedExamsList.length > 0 ? 'My exams' : 'Current'}>
                      {current.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                    </optgroup>
                    {showArch && archived.length > 0 && (
                      <optgroup label="Archived">
                        {archived.map(e => <option key={e.id} value={e.id}>{e.title} (archived)</option>)}
                      </optgroup>
                    )}
                    {sharedExamsList.length > 0 && (
                      <optgroup label="Shared with me">
                        {[...sharedExamsList].sort(byTitle).map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {archived.length > 0 && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={qShowArchived} onChange={e => setQShowArchived(e.target.checked)} style={{ width: 'auto' }} />
                      Show archived ({archived.length})
                    </label>
                  )}
                </div>
              );
            })()}
          </div>

          {qExamId && (
            <>
              {/* Add / Edit Form */}
              <div className="card" style={{ padding: '20px 24px', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--navy)' }}>
                  {editingQ
                    ? <><Icon name="pencil" size={15} color="var(--navy)" /> Editing Question #{qList.findIndex(q => q.id === editingQ.id) + 1}</>
                    : <><Icon name="plus" size={15} color="var(--navy)" /> Add New Question</>}
                </h4>

                {/* Question Type Toggle */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label">Question Type</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {QUESTION_TYPES.map(({ value, label }) => (
                      <button key={value} type="button" className={`btn sm ${qForm.question_type === value ? '' : 'ghost'}`} onClick={() => setQForm(f => ({ ...f, question_type: value }))} style={{ width: 'auto' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Points, for every type. A paper of 1-point items scores
                    exactly as it always did, so leaving this alone changes
                    nothing (sql/025). */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label">Worth</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      type="number" min={1} max={100}
                      value={qForm.marks}
                      onChange={e => setQForm(f => ({ ...f, marks: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                      style={{ width: 92 }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                      point{Number(qForm.marks) === 1 ? '' : 's'}
                      {Number(qForm.marks) !== 1 && ' — this item counts for more than the others'}
                    </span>
                  </div>
                </div>

                {/* Set (sql/116): an item in one set goes only to students
                    who start that set; one in every set goes to everyone. */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label" htmlFor="q-set">Set</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <select id="q-set" className="input" style={{ width: 'auto', minWidth: 140 }}
                      value={qForm.set_label || ''} onChange={e => setQForm(f => ({ ...f, set_label: e.target.value }))}>
                      <option value="">Every set</option>
                      {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => <option key={l} value={l}>Set {l}</option>)}
                    </select>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                      {qForm.set_label
                        ? `Only students who start Set ${qForm.set_label} get this item.`
                        : 'Everyone gets this item, whichever set they start.'}
                    </span>
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label className="label">Question Text</label>
                  <textarea className="input" value={qForm.question_text} onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))} placeholder="Enter the question..." rows={3} style={{ resize: 'vertical' }} />
                </div>

                {/* Image / Figure */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label">Figure / Image <span style={{ fontWeight: 400, color: 'var(--ink-4)', letterSpacing: 0 }}>(optional)</span></label>
                  {qImagePreview ? (
                    <div>
                      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', marginBottom: 8 }}>
                        <img
                          src={qImagePreview}
                          alt="Question figure preview"
                          style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--line)', background: 'var(--surface-2)' }}
                        />
                        <button
                          type="button"
                          onClick={() => { setQImageFile(null); setQImagePreview(null); setQForm(f => ({ ...f, image_url: null })); }}
                          title="Remove image"
                          style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.6)', border: 'none', color: 'white', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}
                        >×</button>
                      </div>
                      <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', display: 'inline-flex' }}>
                        <Icon name="image" size={13} /> Replace image
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setQImageFile(f); setQImagePreview(URL.createObjectURL(f)); e.target.value = ''; }} />
                      </label>
                    </div>
                  ) : (
                    <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', display: 'inline-flex' }}>
                      <Icon name="image" size={13} /> Upload image
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setQImageFile(f); setQImagePreview(URL.createObjectURL(f)); e.target.value = ''; }} />
                    </label>
                  )}
                </div>

                {qForm.question_type !== 'essay' && qForm.question_type !== 'worked_solution' && qForm.question_type !== 'text_answer' && (
                  <>
                    {/* One row per choice, added and removed freely. The radio
                        lives on the row, so marking the correct one and typing
                        it are the same gesture rather than two lists to keep in
                        step. */}
                    <label className="label" style={{ display: 'block', marginBottom: 6 }}>
                      Choices <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
                        {qForm.question_type === 'multi_select'
                          ? '— tick every correct one'
                          : '— tick the correct one (tick more if another choice also counts)'}
                      </span>
                    </label>
                    {qForm.question_type === 'multi_select' && (
                      <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                        Marked all or nothing: the student earns the point only
                        if they tick every one of these and nothing else. Miss
                        one and the question scores zero.
                      </p>
                    )}
                    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                      {qForm.choice_list.map((text, i) => {
                        // The two types key differently — one index, or a set
                        // (sql/018) — so "is this choice the answer" is asked
                        // of whichever key the type uses.
                        const isMulti = qForm.question_type === 'multi_select';
                        const keyed = isMulti
                          ? isSelected(qForm.correct_answers, i)
                          : Number(qForm.correct_answer) === i;
                        // An "also counts" choice (sql/130) is shown as right too.
                        const counts = keyed || (!isMulti && isSelected(qForm.also_correct, i));
                        return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label title={`Mark ${letterFor(i)} correct`} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
                            {/* A one-answer item ticks too: the first ticked is its
                                key, any other ticked choice also counts (sql/130).
                                The last tick cannot be taken off — an item needs one. */}
                            <input
                              type="checkbox"
                              name={isMulti ? `correct_answers_${i}` : `counts_${i}`}
                              checked={isMulti ? keyed : counts}
                              onChange={() => setQForm(f => {
                                if (isMulti) return { ...f, correct_answers: toggleIndex(f.correct_answers, i) };
                                const key = Number(f.correct_answer), also = indexSet(f.also_correct) || [];
                                if (i === key) {
                                  if (!also.length) return f;
                                  const [next, ...rest] = also;
                                  return { ...f, correct_answer: next, also_correct: rest };
                                }
                                return { ...f, also_correct: also.includes(i) ? also.filter(k => k !== i) : indexSet([...also, i]) };
                              })}
                              style={{ width: 16, height: 16 }}
                            />
                            <span style={{ fontWeight: 700, fontSize: 13, width: 20, color: counts ? 'var(--ok)' : 'var(--ink-3)' }}>
                              {letterFor(i)}
                            </span>
                          </label>
                          <input
                            className="input"
                            type="text"
                            value={text}
                            onChange={e => setQForm(f => {
                              const next = [...f.choice_list]; next[i] = e.target.value;
                              return { ...f, choice_list: next };
                            })}
                            placeholder={`Choice ${letterFor(i)}...`}
                            style={{ flex: 1, ...(counts ? { borderColor: 'var(--ok)', boxShadow: '0 0 0 3px var(--ok-bg)' } : {}) }}
                          />
                          <button
                            type="button"
                            onClick={() => setQForm(f => {
                              const next = f.choice_list.filter((_, j) => j !== i);
                              // Keep the ticks on the same choices they were
                              // on: the ones after the removed row all shift up
                              // by one, and a tick on the removed row goes.
                              let key = Number(f.correct_answer);
                              if (key === i) key = 0;
                              else if (key > i) key -= 1;
                              const shift = list => (indexSet(list) || []).filter(k => k !== i).map(k => (k > i ? k - 1 : k));
                              return { ...f, choice_list: next, correct_answer: key, correct_answers: shift(f.correct_answers), also_correct: shift(f.also_correct) };
                            })}
                            disabled={qForm.choice_list.length <= 2}
                            title={qForm.choice_list.length <= 2 ? 'A question needs at least two choices' : `Remove choice ${letterFor(i)}`}
                            className="btn ghost sm"
                            style={{ width: 'auto', flexShrink: 0, opacity: qForm.choice_list.length <= 2 ? 0.35 : 1 }}
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        </div>
                        );
                      })}
                    </div>
                    {qForm.question_type === 'multiple_choice' && (indexSet(qForm.also_correct) || []).length > 0 && (
                      <p style={{ margin: '-4px 0 12px', fontSize: 12.5, color: 'var(--ok)', fontWeight: 600 }}>
                        Any one of {indexSet([Number(qForm.correct_answer), ...(indexSet(qForm.also_correct) || [])]).map(letterFor).join(' or ')} earns
                        the point. The student still picks one. After saving, press Re-score on Manage Exams to update papers already taken.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setQForm(f => ({ ...f, choice_list: [...f.choice_list, ''] }))}
                      className="btn ghost sm"
                      style={{ width: 'auto', marginBottom: 16 }}
                    >
                      <Icon name="plus" size={12} /> Add choice {letterFor(qForm.choice_list.length)}
                    </button>
                  </>
                )}

                {qForm.question_type === 'essay' && (
                  <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', marginBottom: '16px', fontSize: '13px', color: 'var(--warn)' }}>
                    Students will type a free-form written answer. This question will not be auto-graded. Review answers in the Results tab.
                  </div>
                )}

                {qForm.question_type === 'text_answer' && (
                  <div style={{ marginBottom: 16 }}>
                    <label className="label" htmlFor="q-text-answer">Answer</label>
                    <input
                      id="q-text-answer"
                      className="input"
                      value={qForm.text?.answer || ''}
                      onChange={e => setQForm(f => ({ ...f, text: { ...f.text, answer: e.target.value } }))}
                      placeholder="e.g. aileron"
                      style={{ marginBottom: 12 }}
                    />
                    <label className="label" htmlFor="q-text-accept">Also accept <span style={{ fontWeight: 400, color: 'var(--ink-4)' }}>— one per line, optional</span></label>
                    <textarea
                      id="q-text-accept"
                      className="input"
                      rows={3}
                      value={qForm.text?.accept || ''}
                      onChange={e => setQForm(f => ({ ...f, text: { ...f.text, accept: e.target.value } }))}
                      placeholder={'e.g. flaperon'}
                      style={{ resize: 'vertical' }}
                    />
                    <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                      Students type into a plain text box. Capital letters, spaces, and a full stop or
                      quotes at either end are ignored when the answer is compared, so <code>Aileron.</code>{' '}
                      counts for <code>aileron</code>. Any other spelling must be listed above.
                    </p>
                  </div>
                )}

                {qForm.question_type === 'worked_solution' && editingQ?.work_rubric?.mode === 'quantity' && (
                  <div className="ws-marked-reason" style={{ marginBottom: 12 }}>
                    <strong>A problem answered with values and units.</strong>{' '}
                    {(editingQ.work_rubric.parts || []).length} parts, each worth a point for the value and a point
                    for the unit. The parts, keys, accepted units and points are kept exactly as loaded; only the
                    question text is edited here.
                  </div>
                )}
                {qForm.question_type === 'worked_solution' && ['proof', 'simplify', 'logic'].includes(editingQ?.work_rubric?.mode) && (
                  <div style={{ padding: '12px 14px', marginBottom: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                    <strong>{editingQ.work_rubric.mode === 'proof' ? 'A proof, marked line by line.'
                      : editingQ.work_rubric.mode === 'simplify' ? 'A result and its law.' : 'A statement in symbols.'}</strong>{' '}
                    {editingQ.work_rubric.mode === 'proof'
                      ? 'Students write a statement and pick its law on each line; any correct route counts, and each missing or wrong law costs 1 point.'
                      : editingQ.work_rubric.mode === 'simplify'
                        ? 'Students write the simplified result and pick the law: a point for each.'
                        : 'Any spelling of the connectives counts, but not a different statement that merely means the same.'}
                    {' '}The answer key came from the paper's loader and is kept exactly as it is when you save
                    here — the steps below are shown for reference and changes to them are not saved.
                  </div>
                )}
                {qForm.question_type === 'worked_solution' && editingQ?.work_rubric?.mode === 'lines' && (
                  <div style={{ padding: '12px 14px', marginBottom: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                    <strong>Marked line by line.</strong> Students write the whole solution and each step
                    earns marks ({editingQ.work_rubric.steps.map(st => Number(st.marks) || 0).join(' → ')} points,
                    {' '}{Number(editingQ.work_rubric.steps.at(-1)?.alone) || 0} for the final answer alone). That
                    scheme came from the paper's loader and is kept exactly as it is when you save here —
                    the steps below are shown for reference and changes to them are not saved.
                  </div>
                )}
                {qForm.question_type === 'worked_solution' && (
                  <Suspense fallback={<div style={{ padding: 16, fontSize: 13, color: 'var(--ink-4)' }}>Loading the maths editor…</div>}>
                    <WorkedRubricEditor
                      value={qForm.work}
                      marks={qForm.marks}
                      onChange={work => setQForm(f => ({ ...f, work }))}
                    />
                  </Suspense>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn sm" onClick={saveQuestion} disabled={qSaving || qImageUploading} style={{ width: 'auto', opacity: qSaving || qImageUploading ? 0.7 : 1 }}>
                    <Icon name="check" size={14} color="white" />
                    {qImageUploading ? 'Uploading image…' : qSaving ? 'Saving…' : editingQ ? 'Update Question' : 'Add Question'}
                  </button>
                  {editingQ && (
                    <button className="btn ghost sm" onClick={() => { setEditingQ(null); setQForm(emptyQ); setQImageFile(null); setQImagePreview(null); }} style={{ width: 'auto' }}>
                      <Icon name="x" size={14} /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* CSV Import Panel */}
              <div className="card" style={{ padding: '20px 24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="download" size={15} color="var(--navy)" /> Import Questions from CSV</h4>
                  <button className="btn ghost sm" onClick={downloadWeightedCSVTemplate} style={{ width: 'auto' }}>
                    <Icon name="download" size={14} /> Template with points
                  </button>
                  <button className="btn ghost sm" onClick={downloadCSVTemplate} style={{ width: 'auto' }}>
                    <Icon name="download" size={13} /> Download Template
                  </button>
                </div>
                {/* Folded, as on Create New Exam: open, it pushed the
                    question list a screen and a half down on every visit. */}
                <details style={{ marginBottom: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--navy)' }}>
                    How to make the CSV — a guide for each kind of paper
                  </summary>
                  <div style={{ marginTop: 12 }}><CsvGuide /></div>
                </details>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <label className={`btn ghost sm ${csvParsed ? 'ok' : ''}`} style={{ width: 'auto', cursor: 'pointer', ...(csvParsed ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' } : {}) }}>
                    <Icon name={csvParsed ? 'check' : 'file-text'} size={14} />
                    {csvParsed ? `${csvParsed.questions.length} questions ready` : 'Choose CSV file'}
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleCsvFileSelect(e, setCsvParsed)} />
                  </label>

                  {csvParsed && (
                    <>
                      <span style={{ fontSize: '12px', color: 'var(--ink-3)' }}>
                        {csvImportSummary(csvParsed.questions)}
                      </span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600, color: csvReplaceMode ? 'var(--bad)' : 'var(--ink-2)' }}>
                        <input type="checkbox" checked={csvReplaceMode} onChange={e => setCsvReplaceMode(e.target.checked)} style={{ width: '15px', height: '15px' }} />
                        Replace existing questions (they go to the Trash)
                      </label>
                      <button className="btn sm" onClick={() => importQuestionsFromCSV(qExamId, csvParsed.questions, csvReplaceMode)} disabled={csvImporting || csvParsed.questions.length === 0} style={{ width: 'auto', opacity: csvImporting ? 0.7 : 1 }}>
                        {csvImporting ? 'Importing…' : `Import ${csvParsed.questions.length} Questions`}
                      </button>
                      <button onClick={() => setCsvParsed(null)} aria-label="Remove this file" style={{ width: 'auto', padding: '2px 6px', background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                    </>
                  )}
                </div>

                <CsvErrors errors={csvParsed?.errors} heading="Fix these errors in your CSV before importing:" />
              </div>

              {/* Question List */}
              {qLoading ? (
                <p style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Loading questions...</p>
              ) : qList.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '20px' }}>No questions yet. Add one above or import from CSV.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink-2)', fontSize: '13px' }}>
                      {qList.length} question{qList.length !== 1 ? 's' : ''} total
                      {setsOf(qList).length > 0 && ` · sets ${setsOf(qList).join(', ')}`}
                    </span>
                    {setsOf(qList).length > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                        Show
                        <select className="input" style={{ width: 'auto' }} value={qSetFilter} onChange={e => setQSetFilter(e.target.value)}>
                          <option value="">Every item</option>
                          {setsOf(qList).map(l => <option key={l} value={l}>What Set {l} gets</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {qList.map((q, idx) => (qSetFilter && !inSet(q, qSetFilter)) ? null : (
                      <div key={q.id} className="card" style={{ padding: '16px 20px', ...(editingQ?.id === q.id ? { borderColor: 'var(--navy)', background: 'var(--navy-50)' } : {}) }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--ink-1)', fontSize: '14px' }}>
                              <span style={{ color: 'var(--navy)', marginRight: '8px', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>{idx + 1}.</span>
                              <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span>
                              {q.question_type === 'essay' && <span className="px-pill info" style={{ marginLeft: 10 }}>Essay</span>}
                              {q.question_type === 'worked_solution' && <span className="px-pill info" style={{ marginLeft: 10 }}>{q.work_rubric?.mode === 'text' ? 'Text' : q.work_rubric?.mode === 'quantity' ? 'Values + units' : 'Maths'}</span>}
                              <InlinePoints
                                value={Number(q.marks) || 1}
                                busy={savingPointsFor === q.id}
                                onSave={pts => saveQuestionPoints(q, pts)}
                              />
                              {q.set_label
                                ? <span className="px-pill" style={{ marginLeft: 10, background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' }}>Set {q.set_label}</span>
                                : setsOf(qList).length > 0 && <span className="px-pill muted" style={{ marginLeft: 10 }}>Every set</span>}
                              {isMultiSelect(q) && <span className="px-pill ok" style={{ marginLeft: 10 }}>Multiple answers</span>}
                            </p>
                            {/* "Evaluate the limit." names no limit. For a
                                maths item the PROBLEM is the question, so it
                                is shown here with the answer beside it —
                                otherwise a list of thirty reads as thirty
                                copies of the same sentence. */}
                            {q.question_type === 'worked_solution' && (
                              <Suspense fallback={null}>
                                <div className="q-maths">
                                  {q.work_rubric?.mode === 'quantity' && <QuantityKey q={q} />}
                                  {q.work_given && q.work_rubric?.mode !== 'quantity' && (
                                    <span className="q-maths-part">
                                      <span className="q-maths-tag">Problem</span>
                                      <MathStatic latex={q.work_given} />
                                    </span>
                                  )}
                                  {q.work_rubric?.steps?.[q.work_rubric.steps.length - 1]?.latex && (
                                    <span className="q-maths-part">
                                      <span className="q-maths-tag">Answer</span>
                                      <TypedShown q={q} value={q.work_rubric.steps[q.work_rubric.steps.length - 1].latex} />
                                    </span>
                                  )}
                                  {(q.work_rubric?.accept?.length > 0) && (
                                    <span className="q-maths-tag" style={{ color: 'var(--ink-4)' }}>
                                      +{q.work_rubric.accept.length} accepted
                                    </span>
                                  )}
                                </div>
                              </Suspense>
                            )}
                            {q.image_url && (
                              <img
                                src={q.image_url}
                                alt="Figure"
                                style={{ maxHeight: 72, maxWidth: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-xs)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 6 }}
                              />
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button className="btn ghost sm" onClick={() => startEditQuestion(q)} style={{ width: 'auto' }}>
                              <Icon name="pencil" size={13} /> Edit
                            </button>
                            {/* Kept apart from Edit and smaller than it, so
                                the one used every day is not a slip away
                                from the one that cannot be undone. */}
                            <button className="btn ghost sm danger" onClick={() => deleteQuestion(q.id)}
                              aria-label={`Delete question ${idx + 1}`} title="Delete question"
                              style={{ width: 'auto', marginLeft: 10, padding: '5px 8px', color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>
                              <Icon name="trash" size={13} color="var(--bad)" />
                            </button>
                          </div>
                        </div>
                        {q.question_type === 'essay' ? (
                          <div style={{ padding: '8px 12px', background: 'var(--info-bg)', border: '1px solid var(--info-bd)', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--info)', fontStyle: 'italic' }}>
                            Open-ended — students type a written answer. Graded manually.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {/* A multi-answer item highlights every keyed
                                choice, not just one (sql/018). */}
                            {(() => { const keySet = acceptedSetOf(q) || []; return choicesOf(q).map((choiceText, i) => {
                              const letter = letterFor(i);
                              const keyed = keySet.includes(i);
                              return (
                              <div key={letter} style={{ padding: '6px 10px', borderRadius: 'var(--r-xs)', background: keyed ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1px solid ${keyed ? 'var(--ok-bd)' : 'var(--line)'}`, fontSize: '13px', color: keyed ? 'var(--ok)' : 'var(--ink-2)', fontWeight: keyed ? 600 : 400 }}>
                                <strong>{letter}.</strong> {choiceText}{keyed && ' ✓'}
                              </div>
                            ); }); })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* --- TAB 7: TRANSFER EXAMS --- */}
      {activeView === 'trash' && (() => {
        const papers = trashRows.filter(t => t.kind === 'paper');
        const people = trashRows.filter(t => t.kind === 'student');
        const scores = trashRows.filter(t => t.kind === 'result');
        const items = trashRows.filter(t => t.kind === 'question');
        const lessonRows = trashRows.filter(t => t.kind === 'lesson');
        const scoreLine = (d) => {
          const m = combinedScore(d);
          return `${d?.paper_title || 'A paper'} · ${m.score}/${m.total}`;
        };
        const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const trashRow = (row, icon, title, meta) => {
          // A paper's teachers all see its deleted results and questions, and
          // any of them may restore those; the server has the last word.
          const mine = row.trashed_by === instructorId || row.kind === 'result' || row.kind === 'question' || row.kind === 'lesson';
          return (
            <div className="trash-row" key={row.id}>
              <span className="trash-row-icon"><Icon name={icon} size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink-1)', fontSize: 14, overflowWrap: 'anywhere' }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                  {meta}{meta ? ' · ' : ''}Deleted {when(row.trashed_at)} · <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{purgeLabel(row.purge_after)}</span>
                </div>
              </div>
              {mine ? (
                <button className="btn ghost sm" style={{ width: 'auto', flexShrink: 0 }}
                  disabled={restoringTrash === row.id} onClick={() => restoreFromTrash(row)}>
                  <Icon name="refresh" size={13} />
                  {restoringTrash === row.id ? 'Restoring…' : 'Restore'}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--ink-4)', flexShrink: 0 }}>Deleted by its owner</span>
              )}
            </div>
          );
        };
        return (
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-3)' }}>
              Deleted for good after {TRASH_DAYS} days. A restored paper comes back closed.
            </p>
            {trashRows.length === 0 ? (
              <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)' }}>
                <Icon name="trash" size={26} color="var(--ink-4)" />
                <p style={{ margin: '10px 0 0', fontSize: 14 }}>The Trash is empty.</p>
              </div>
            ) : (
              <>
                {papers.length > 0 && (
                  <section style={{ marginBottom: 22 }}>
                    <h2 className="trash-heading">Papers <span>{papers.length}</span></h2>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {papers.map(row => trashRow(row, 'clipboard', row.label || 'Untitled paper', 'Questions and results kept'))}
                    </div>
                  </section>
                )}
                {scores.length > 0 && (
                  <section style={{ marginBottom: 22 }}>
                    <h2 className="trash-heading">Scores <span>{scores.length}</span></h2>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {scores.map(row => trashRow(row, 'bar-chart', formatName(row.label) || 'Unnamed student', scoreLine(row.detail)))}
                    </div>
                  </section>
                )}
                {items.length > 0 && (
                  <section style={{ marginBottom: 22 }}>
                    <h2 className="trash-heading">Questions <span>{items.length}</span></h2>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {items.map(row => trashRow(row, 'file-text', row.label || 'Untitled question', `From ${row.detail?.paper_title || 'a paper'}`))}
                    </div>
                  </section>
                )}
                {lessonRows.length > 0 && (
                  <section style={{ marginBottom: 22 }}>
                    <h2 className="trash-heading">Lessons <span>{lessonRows.length}</span></h2>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {lessonRows.map(row => trashRow(row, 'book', row.label || 'Untitled lesson', 'Read progress kept'))}
                    </div>
                  </section>
                )}
                {people.length > 0 && (
                  <section>
                    <h2 className="trash-heading">Students <span>{people.length}</span></h2>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {people.map(row => trashRow(row, 'users', formatName(row.label) || 'Unnamed student',
                        (row.detail?.sections || []).length ? `Removed from ${row.detail.sections.join(', ')}` : ''))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        );
      })()}

      {activeView === 'transfer' && (
        <div>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--ink-3)' }}>
            Give your exams to another instructor. Students follow automatically.
          </p>

          {/* Step 1 — Destination */}
          <div style={{ marginBottom: '28px' }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
              Step 1 — Choose destination instructor
            </p>
            {instructorsList.length === 0 ? (
              <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', padding: '14px 18px', fontSize: '13px', color: 'var(--warn)' }}>
                No other instructors found. Ask them to <strong>log in once</strong> using Instructor Login — they'll register automatically.
              </div>
            ) : (
              <div role="radiogroup" aria-label="Destination instructor" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {instructorsList.map(inst => {
                  const picked = transferTarget === inst.id;
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => setTransferTarget(inst.id)}
                      className="transfer-choice"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                        padding: '10px 16px', borderRadius: 'var(--r-sm)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                        border: `2px solid ${picked ? 'var(--navy)' : 'var(--line)'}`,
                        background: picked ? 'var(--navy-50)' : 'var(--surface)',
                        color: 'var(--ink-1)', width: 'auto',
                      }}
                    >
                      <span aria-hidden="true" style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${picked ? 'var(--navy)' : 'var(--ink-4)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {picked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--navy)' }} />}
                      </span>
                      {/* An account with no display name carries its email
                          as its name; it is then the label, said once. */}
                      <span>
                        {inst.full_name || inst.email}
                        {inst.full_name && inst.email && inst.full_name !== inst.email && (
                          <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: 'var(--ink-3)' }}>{inst.email}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
                <button className="btn ghost sm" onClick={fetchInstructors} style={{ width: 'auto' }}>
                  <Icon name="refresh" size={13} /> Refresh
                </button>
              </div>
            )}
          </div>

          {/* Step 2 — Select Exams */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
                Step 2 — Select exams to transfer
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn ghost sm" onClick={() => setTransferExamIds(new Set(examsList.map(e => e.id)))} style={{ width: 'auto' }}>Select All</button>
                <button className="btn ghost sm" onClick={() => setTransferExamIds(new Set())} style={{ width: 'auto' }}>Clear</button>
              </div>
            </div>

            {examsList.length === 0 ? (
              <p style={{ color: 'var(--ink-3)', fontSize: '14px' }}>You have no exams to transfer.</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {examsList.map(exam => {
                  const checked = transferExamIds.has(exam.id);
                  const resultCount = results.filter(r => r.exam_id === exam.id).length;
                  return (
                    <label key={exam.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', cursor: 'pointer', ...(checked ? { borderColor: 'var(--navy)', background: 'var(--navy-50)' } : {}) }}>
                      <input type="checkbox" checked={checked} onChange={() => setTransferExamIds(prev => { const next = new Set(prev); if (next.has(exam.id)) next.delete(exam.id); else next.add(exam.id); return next; })} style={{ width: '18px', height: '18px', flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>{exam.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                          <span>Section: <strong>{exam.target_section || '—'}</strong></span>
                          <span>{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
                          <span className={`px-pill ${exam.is_open ? 'ok' : 'muted'}`} style={{ fontSize: '11px' }}>{exam.is_open ? 'Open' : 'Closed'}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3 — Confirm */}
          {transferTarget && transferExamIds.size > 0 && (() => {
            const dest = instructorsList.find(i => i.id === transferTarget);
            return (
              <div className="card" style={{ padding: '20px 24px', borderColor: 'var(--navy)' }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
                  Step 3 — Confirm transfer
                </p>
                <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--ink-2)' }}>
                  You are transferring <strong>{transferExamIds.size} exam{transferExamIds.size !== 1 ? 's' : ''}</strong> to{' '}
                  <strong>{dest?.full_name || dest?.email}</strong>.
                  All questions and student results stay intact. Students in the transferred sections will move to their dashboard.
                </p>
                <button className="btn" onClick={transferExams} disabled={isTransferring} style={{ width: 'auto', opacity: isTransferring ? 0.7 : 1 }}>
                  <Icon name="arrow-up-right" size={15} color="white" />
                  {isTransferring ? 'Transferring…' : `Transfer ${transferExamIds.size} Exam${transferExamIds.size !== 1 ? 's' : ''} to ${dest?.full_name?.split(' ')[0] || 'Instructor'}`}
                </button>
              </div>
            );
          })()}
        </div>
      )}

        </div>{/* end panel content */}

      </main>

      {/* On a phone, the views used most sit under the thumb (index.css hides
          this above 1024px); everything else is in the menu behind "More". */}
      <nav className="dash-tabbar" aria-label="Dashboard">
        {[
          { id: 'home', label: 'Overview', icon: 'home' },
          { id: 'live', label: 'Live', icon: 'activity', badge: liveSessions.length > 0 ? liveSessions.length : null },
          { id: 'results', label: 'Results', icon: 'bar-chart' },
          { id: 'class', label: 'Class', icon: 'graduation' },
        ].map(t => (
          <button key={t.id} type="button" className={`dash-tab${activeView === t.id ? ' is-active' : ''}`}
            aria-current={activeView === t.id ? 'page' : undefined}
            onClick={() => { setActiveView(t.id); setSideOpen(false); }}>
            <Icon name={t.icon} size={20} />
            {t.label}
            {t.badge && <span className="dash-tab-badge">{t.badge}</span>}
          </button>
        ))}
        <button type="button" className={`dash-tab${['home', 'live', 'results', 'class'].includes(activeView) ? '' : ' is-active'}`}
          aria-expanded={sideOpen} aria-controls="dash-side" onClick={() => setSideOpen(o => !o)}>
          <Icon name="menu" size={20} />
          More
        </button>
      </nav>

{/* ========================================= */}
      {/* MODAL: DUPLICATE EXAM                     */}
      {/* ========================================= */}
      {rescoreFor && (
        <Suspense fallback={null}>
          <RescoreModal exam={rescoreFor} onClose={() => setRescoreFor(null)} onDone={() => fetchDashboardData()} />
        </Suspense>
      )}
      {dupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: '500px', overflow: 'hidden', boxShadow: 'var(--sh-modal)' }}>

            {/* Header */}
            <div className="patts-header" style={{ padding: '24px 28px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="copy" size={18} color="white" /> Duplicate Exam
              </h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.65)', fontSize: '13px' }}>
                Source: <strong style={{ color: 'var(--gold-bright)' }}>{dupModal.title}</strong>
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: '28px', display: 'grid', gap: '18px' }}>

              {/* New title */}
              <div>
                <label className="label">New Exam Title</label>
                <input autoFocus className="input" type="text" value={dupTitle} onChange={e => setDupTitle(e.target.value)} />
              </div>

              {/* Target section */}
              <div>
                <label className="label">Target Section</label>
                <input className="input" type="text" value={dupSection} onChange={e => setDupSection(e.target.value)} placeholder="e.g. Aero 202" />
              </div>

              {/* Assign to */}
              <div>
                <label className="label" style={{ marginBottom: '10px' }}>Assign to</label>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: dupAssignTo === 'self' ? 'var(--navy-50)' : 'var(--surface-2)', border: `2px solid ${dupAssignTo === 'self' ? 'var(--navy)' : 'var(--line)'}` }}>
                    <input type="radio" name="dupAssign" value="self" checked={dupAssignTo === 'self'} onChange={() => setDupAssignTo('self')} style={{ width: '16px', height: '16px' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>Keep for myself</div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>Duplicate stays on your account</div>
                    </div>
                  </label>

                  {instructorsList.length === 0 ? (
                    <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--warn)' }}>
                      No other instructors found. Ask them to log in once to register their account.
                    </div>
                  ) : (
                    instructorsList.map(inst => (
                      <label key={inst.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: dupAssignTo === inst.id ? 'var(--navy-50)' : 'var(--surface-2)', border: `2px solid ${dupAssignTo === inst.id ? 'var(--navy)' : 'var(--line)'}` }}>
                        <input type="radio" name="dupAssign" value={inst.id} checked={dupAssignTo === inst.id} onChange={() => setDupAssignTo(inst.id)} style={{ width: '16px', height: '16px' }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>{inst.full_name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>{inst.email}</div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Footer buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button className="btn ghost" onClick={() => setDupModal(null)} disabled={isDuplicating} style={{ flex: 1 }}>Cancel</button>
                <button className="btn" onClick={duplicateExam} disabled={isDuplicating || !dupTitle.trim()} style={{ flex: 2, opacity: isDuplicating || !dupTitle.trim() ? 0.5 : 1 }}>
                  <Icon name="copy" size={15} color="white" />
                  {isDuplicating ? 'Duplicating…' : 'Create Duplicate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* ========================================= */}
      {/* MODAL: SHARE EXAM                          */}
      {/* ========================================= */}
      {shareModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: '520px', overflow: 'hidden', boxShadow: 'var(--sh-modal)' }}>

            <div className="patts-header" style={{ padding: '24px 28px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="users" size={18} color="white" /> Share Exam
              </h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.65)', fontSize: '13px' }}>
                <strong style={{ color: 'var(--gold-bright)' }}>{shareModal.title}</strong>
              </p>
            </div>

            <div style={{ padding: '28px', display: 'grid', gap: '20px' }}>

              {/* Current access list */}
              <div>
                <label className="label" style={{ marginBottom: 10 }}>Current Access</label>
                {(sharesMap[shareModal.id] || []).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>No other instructors have access yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(sharesMap[shareModal.id] || []).map(s => {
                      const inst = instructorsList.find(i => i.id === s.shared_with);
                      return (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                            {(inst?.full_name || '?')[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{inst?.full_name || 'Unknown Instructor'}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{inst?.email || ''}</div>
                          </div>
                          <button
                            onClick={() => revokeShare(s.id, shareModal.id)}
                            className="btn ghost sm"
                            style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)', width: 'auto' }}
                          >
                            <Icon name="x" size={13} /> Revoke
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add access */}
              <div>
                <label className="label" style={{ marginBottom: 10 }}>Add Access</label>
                {instructorsList.filter(i => !(sharesMap[shareModal.id] || []).some(s => s.shared_with === i.id)).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                    {instructorsList.length === 0 ? 'No other instructors are registered yet.' : 'All instructors already have access.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={shareTarget}
                      onChange={e => setShareTarget(e.target.value)}
                      className="input"
                      style={{ flex: 1 }}
                    >
                      <option value="">Select an instructor…</option>
                      {instructorsList
                        .filter(i => !(sharesMap[shareModal.id] || []).some(s => s.shared_with === i.id))
                        .map(i => (
                          <option key={i.id} value={i.id}>{i.full_name} — {i.email}</option>
                        ))}
                    </select>
                    <button
                      className="btn"
                      onClick={shareExam}
                      disabled={!shareTarget || isSharing}
                      style={{ width: 'auto', opacity: !shareTarget || isSharing ? 0.5 : 1, flexShrink: 0 }}
                    >
                      <Icon name="user-plus" size={14} color="white" />
                      {isSharing ? 'Sharing…' : 'Share'}
                    </button>
                  </div>
                )}
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-4)' }}>
                  Shared instructors can view results, monitor live sessions, and manage questions for this exam.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <button className="btn ghost" onClick={() => setShareModal(null)} style={{ width: 'auto' }}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* Loading overlay for question fetches */}
      {isLoadingQuestions && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.72)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--surface)', padding: '28px 48px', borderRadius: 'var(--r-xl)', textAlign: 'center', boxShadow: 'var(--sh-modal)', color: 'var(--ink-1)', fontSize: '16px', fontWeight: 600 }}>
            Loading questions…
          </div>
        </div>
      )}

{/* ========================================= */}
      {/* MODAL 1: INDIVIDUAL STUDENT ANSWER SHEET  */}
      {/* ========================================= */}
      {viewingStudent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="dash-modal" style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '90%', maxWidth: '800px', maxHeight: '88vh', overflowY: 'auto', position: 'relative', boxShadow: 'var(--sh-modal)' }}>
            {/* Modal header */}
            <div className="patts-header modal-head" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>{formatName(students[viewingStudent.student_id]?.name)}'s Exam Paper</h2>
                  <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* The same score as the Results row — points plus worked
                        marks. This read score / total_items, the picked-item
                        count alone, and said 9 / 9 on a 20 / 67 paper. */}
                    {(() => {
                      const m = combinedScore(viewingStudent);
                      return (
                        <span className="px-pill" style={{ background: 'rgba(255,255,255,.15)', color: 'white', borderColor: 'transparent', fontSize: '13px' }}>
                          Score: <strong>{m.score} / {m.total}</strong>
                          {m.pending > 0 ? ` · ${m.pending} to mark` : m.pct !== null ? ` · ${m.pct}% · ${gradeVerdict(m)}` : ''}
                        </span>
                      );
                    })()}
                    {/* Only for a paper whose answers never reached the server
                        (the old force-submit loss) — known here because this
                        view fetches answers_json; the Results list does not. */}
                    {viewingStudent.total_items > 0
                      && Object.keys(viewingStudent.answers_json || {}).length === 0
                      && manualScoreFits(viewingStudent) && (
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          setManualScoreModal({
                            student_id: viewingStudent.student_id, exam_id: viewingStudent.exam_id,
                            student_name: students[viewingStudent.student_id]?.name || 'Student',
                            exam_title: examsDict[viewingStudent.exam_id] || 'Exam',
                            total_items: viewingStudent.total_items,
                            weighted: viewingStudent.points_total !== null && viewingStudent.points_total !== undefined,
                          });
                          setManualScoreValue(String(viewingStudent.score ?? 0));
                        }}
                        style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}
                      >
                        <Icon name="edit" size={13} color="white" /> Enter score
                      </button>
                    )}
                  </div>
                </div>
                <button className="btn ghost sm" aria-label="Close" onClick={() => setViewingStudent(null)} style={{ flexShrink: 0,  color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                  <Icon name="x" size={14} color="white" /> <span className="hide-narrow">Close</span>
                </button>
              </div>
            </div>

            <div style={{ padding: '24px 28px' }}>
              {viewingStudent.violation_logs && viewingStudent.violation_logs.length > 0 && (
                <div style={{ background: 'var(--bad-bg)', padding: '16px 20px', borderRadius: 'var(--r-md)', marginBottom: '20px', border: '1px solid var(--bad-bd)' }}>
                  <h3 style={{ color: 'var(--bad)', margin: '0 0 10px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert" size={15} color="var(--bad)" /> Security Incident Log
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--bad)', fontSize: '13px', lineHeight: '1.7' }}>
                    {viewingStudent.violation_logs.map((log, i) => {
                      const split = log.indexOf('] ');
                      const ts = split >= 0 ? log.substring(0, split + 1) : '';
                      const reason = split >= 0 ? log.substring(split + 2) : log;
                      return <li key={i}><strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: '11px' }}>{ts}</strong> {reason}</li>;
                    })}
                  </ul>
                </div>
              )}

              {/* Worked items are marked as a set rather than one at a time:
                  the marks are saved in a single call, so a script cannot end
                  up half-marked. They are therefore pulled out of the
                  per-question list below and shown together here. */}
              {sittingQuestions(viewingStudent.exam_id, viewingStudent.answers_json)
                .some(q => q.question_type === 'worked_solution') && (
                <Suspense fallback={<div style={{ padding: 16, fontSize: 13, color: 'var(--ink-4)' }}>Loading the marker…</div>}>
                  <WorkedMarking
                    assessmentId={viewingStudent.exam_id}
                    studentId={viewingStudent.student_id}
                    studentName={viewingStudent.full_name || viewingStudent.student_name}
                    questions={sittingQuestions(viewingStudent.exam_id, viewingStudent.answers_json)}
                    storedAnswers={viewingStudent.answers_json || {}}
                    attemptNo={viewingStudent.attempt_no ?? null}
                    onSaved={marks => {
                      // The row in the Results table behind this modal still
                      // says "N marks to mark". Patched locally rather than
                      // refetched, the same way a manual score edit is, so the
                      // badge clears the moment the save succeeds instead of
                      // lying until the next full reload.
                      const awarded = Object.values(marks).reduce((t, i) => t + (Number(i.marks) || 0), 0);
                      const available = Object.values(marks).reduce((t, i) => t + (Number(i.total) || 0), 0);
                      setResults(prev => prev.map(r =>
                        r.student_id === viewingStudent.student_id && r.exam_id === viewingStudent.exam_id
                          ? { ...r, work_marks: awarded, work_total: available, work_marked_at: new Date().toISOString() }
                          : r
                      ));
                      setViewingStudent(v => (v ? { ...v, work_marks: awarded, work_total: available } : v));
                    }}
                  />
                </Suspense>
              )}

              <div style={{ display: 'grid', gap: '12px' }}>
                {sittingQuestions(viewingStudent.exam_id, viewingStudent.answers_json).map((q, idx) => {
                  const sAnswer = (viewingStudent.answers_json || {})[q.id];

                  // Shown above, by WorkedMarking, with its ticks and its marks.
                  if (q.question_type === 'worked_solution') return null;

                  if (q.question_type === 'essay') {
                    const essayText = sAnswer?.text;
                    return (
                      <div key={q.id} className="card" style={{ padding: '20px', borderLeft: '4px solid var(--info)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                          <p style={{ margin: 0, fontWeight: 600, flex: 1, color: 'var(--ink-1)' }}>{idx + 1}. <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span></p>
                          <span className="px-pill info" style={{ flexShrink: 0 }}>Essay</span>
                        </div>
                        {q.image_url && (
                          <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 12 }} />
                        )}
                        <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-bd)', borderRadius: 'var(--r-sm)', padding: '14px 16px', fontSize: '14px', color: essayText ? 'var(--ink-1)' : 'var(--ink-4)', fontStyle: essayText ? 'normal' : 'italic', lineHeight: '1.6', minHeight: '60px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {essayText || 'No answer provided.'}
                        </div>
                      </div>
                    );
                  }

                  // Both the key and the answer may be a set (sql/018), so
                  // "did they get it right" is set equality, not one index
                  // against another. is_correct as stored by score_answers()
                  // is the authority; the comparison is the fallback for a row
                  // written before it recorded one.
                  const studentSet = indexSet(sAnswer?.chosen) || [];
                  const keySet = acceptedSetOf(q) || [];
                  const gotIt = typeof sAnswer?.is_correct === 'boolean'
                    ? sAnswer.is_correct
                    : isAnswerCorrect(q, sAnswer?.chosen) === true;
                  const multi = isMultiSelect(q);

                  return (
                    <div key={q.id} className="card" style={{ padding: '20px', borderLeft: gotIt ? '4px solid var(--ok)' : '4px solid var(--bad)' }}>
                      <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: 'var(--ink-1)' }}>
                        {idx + 1}. <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span>
                        {multi && <span className="px-pill ok" style={{ marginLeft: 8 }}>Multiple answers</span>}
                      </p>
                      {q.image_url && (
                        <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 12 }} />
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {choicesOf(q).map((choiceText, i) => {
                          const letter = letterFor(i);
                          const isCorrect = keySet.includes(i);
                          const isStudentWrong = studentSet.includes(i) && !isCorrect;
                          return (
                            <div key={letter} style={{ padding: '10px 12px', background: isCorrect ? 'var(--ok-bg)' : isStudentWrong ? 'var(--bad-bg)' : 'var(--surface-2)', border: `1.5px solid ${isCorrect ? 'var(--ok-bd)' : isStudentWrong ? 'var(--bad-bd)' : 'var(--line)'}`, borderRadius: 'var(--r-sm)', color: isCorrect ? 'var(--ok)' : isStudentWrong ? 'var(--bad)' : 'var(--ink-2)', fontSize: '13.5px' }}>
                              <strong>{letter}.</strong> {choiceText}
                              {isCorrect && <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: 700 }}>✓ Correct{studentSet.includes(i) ? ' — picked' : ''}</span>}
                              {isStudentWrong && <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: 700 }}>✗ Picked</span>}
                            </div>
                          );
                        })}
                      </div>
                      {/* All or nothing, so a paper can show three of four
                          right and still score zero for the item. Spell out
                          what was missed rather than leaving it to the
                          colours. */}
                      {multi && !gotIt && (
                        <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--ink-3)' }}>
                          Needed {keySet.map(letterFor).join(', ')} and nothing else.
                          Ticked {studentSet.length ? studentSet.map(letterFor).join(', ') : 'nothing'}.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* MODAL 2: CLASS ITEM ANALYSIS (STATS)      */}
      {/* ========================================= */}
      {viewingStatsExam && (
        <div className="print-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="print-zone" style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '90%', maxWidth: '900px', maxHeight: '88vh', overflowY: 'auto', boxShadow: 'var(--sh-modal)' }}>

            {/* Header */}
            <div className="patts-header" style={{ padding: '24px 28px', position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>Item Analysis & Statistics</h2>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.6)', fontSize: '13px' }}>
                    {(() => {
                      const src = statsSourceFor(viewingStatsExam);
                      const n = src.answers.length;
                      const base = src.practice
                        ? `Practice paper — each student's first attempt (${n} student${n === 1 ? '' : 's'}).`
                        : `How many students chose each option, and what they typed on maths items (${n} submission${n === 1 ? '' : 's'}).`;
                      if (!statsShownSet) return base;
                      const k = src.answers.filter(a => setOfAnswers(statsQuestions, a) === statsShownSet).length;
                      return `Set ${statsShownSet} — ${k} of ${n} sat it. ${base}`;
                    })()}
                  </p>
                  {statsSets.length > 0 && (
                    <div role="group" aria-label="Set" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {statsSets.map(set => {
                        const on = set === statsShownSet;
                        return (
                          <button key={set} type="button" aria-pressed={on} onClick={() => setStatsSet(set)}
                            style={{ width: 'auto', padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,.35)',
                              background: on ? 'white' : 'rgba(255,255,255,.08)', color: on ? 'var(--navy)' : 'white' }}>
                            Set {set}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost sm" onClick={printAnalysis} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                    Save as PDF
                  </button>
                  <button className="btn ghost sm" onClick={() => setViewingStatsExam(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                    <Icon name="x" size={14} color="white" /> Close
                  </button>
                </div>
              </div>
            </div>

            <div style={{ padding: '24px 28px', display: 'grid', gap: '16px' }}>
              {statsShownQuestions.map((q, idx) => {
                if (q.question_type === 'essay') {
                  return (
                    <div key={q.id} className="card" style={{ padding: '20px', borderLeft: '4px solid var(--info)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <p style={{ margin: 0, fontWeight: 600, flex: 1, color: 'var(--ink-1)' }}>{idx + 1}. <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span></p>
                        <span className="px-pill info" style={{ flexShrink: 0 }}>Essay</span>
                      </div>
                      {q.image_url && (
                        <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginTop: 10 }} />
                      )}
                      <p style={{ margin: '8px 0 0', color: 'var(--ink-3)', fontSize: '13px' }}>Open-ended question — view individual answers in the Results tab.</p>
                    </div>
                  );
                }

                // An item in one set is out of the students who sat that set.
                const allAnswers = statsSourceFor(viewingStatsExam).answers;
                const statAnswers = q.set_label
                  ? allAnswers.filter(a => setOfAnswers(statsQuestions, a) === q.set_label)
                  : allAnswers;
                const totalAnswers = statAnswers.length;

                // A "type your answer" item has no choices, so the option bars
                // below drew nothing and the card was just "Find the second
                // derivative." — no function, no answer. Show the problem and
                // the key, then how the class did and what they actually wrote.
                if (isWorkedSolution(q)) {
                  const key = workedKeyOf(q);
                  const st = workedItemStats(q, statAnswers);
                  const pct = n => (st.sat > 0 ? Math.round((n / st.sat) * 100) : 0);
                  return (
                    <div key={q.id} className="card" style={{ padding: '20px 24px', borderLeft: '4px solid var(--navy)' }}>
                      <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: 'var(--ink-1)', fontSize: '14.5px' }}>
                        {idx + 1}. <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span>
                        <span className="px-pill info" style={{ marginLeft: 8 }}>{q.work_rubric?.mode === 'text' ? 'Type a word' : q.work_rubric?.mode === 'quantity' ? 'Values + units' : 'Type your answer'}</span>
                        <span className="px-pill muted" style={{ marginLeft: 6 }}>
                          {Number(q.marks) || 1} pt{(Number(q.marks) || 1) === 1 ? '' : 's'}
                        </span>
                      </p>
                      {q.image_url && (
                        <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 12 }} />
                      )}
                      <Suspense fallback={null}>
                        <div className="q-maths">
                          {q.work_rubric?.mode === 'quantity' && <QuantityKey q={q} />}
                          {q.work_given && q.work_rubric?.mode !== 'quantity' && (
                            <span className="q-maths-part">
                              <span className="q-maths-tag">Problem</span>
                              <MathStatic latex={q.work_given} />
                            </span>
                          )}
                          {key.model && (
                            <span className="q-maths-part">
                              <span className="q-maths-tag">Answer</span>
                              <TypedShown q={q} value={key.model} />
                            </span>
                          )}
                          {key.accepted.length > 0 && (
                            <span className="q-maths-part" style={{ flexWrap: 'wrap' }}>
                              <span className="q-maths-tag">Also accepted</span>
                              {key.accepted.map(a => (
                                <span key={a} style={{ padding: '1px 7px', border: '1px solid var(--line)', borderRadius: 'var(--r-xs)', background: 'var(--white)' }}>
                                  <TypedShown q={q} value={a} />
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </Suspense>

                      <div style={{ margin: '12px 0 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontSize: '13px', marginBottom: 6 }}>
                          <span style={{ color: 'var(--ink-2)' }}>
                            <strong style={{ color: 'var(--ok)' }}>{st.full} of {st.sat}</strong> got it right
                          </span>
                          <span style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{pct(st.full)}%</span>
                        </div>
                        <div style={{ background: 'var(--line)', height: '8px', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct(st.full)}%`, height: '100%', background: 'var(--ok)', borderRadius: 'var(--r-pill)' }} />
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-3)' }}>
                          {[
                            st.zero > 0 && `${st.zero} wrong`,
                            st.partial > 0 && `${st.partial} part marks`,
                            st.blank > 0 && `${st.blank} left blank`,
                            st.pending > 0 && `${st.pending} not marked yet`,
                          ].filter(Boolean).join(' · ') || (st.sat === 0 ? 'Nobody has sat this paper yet.' : '')}
                        </p>
                      </div>

                      {st.groups.length > 0 && (
                        <>
                          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>What students wrote</div>
                          <div style={{ display: 'grid', gap: '8px' }}>
                            {st.groups.slice(0, 12).map(g => {
                              const right = g.full === g.count;
                              const wrong = g.zero === g.count;
                              const tone = right ? 'ok' : wrong ? 'bad' : null;
                              const share = pct(g.count);
                              return (
                                <div key={g.latex} style={{ padding: '10px 12px', borderRadius: 'var(--r-sm)', background: tone ? `var(--${tone}-bg)` : 'var(--surface-2)', border: `1.5px solid ${tone ? `var(--${tone}-bd)` : 'var(--line)'}` }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0, fontSize: 15, color: 'var(--ink-1)', overflowX: 'auto' }}>
                                      <Suspense fallback={<code>{g.latex}</code>}><TypedShown q={q} value={g.latex} /></Suspense>
                                      <span className={`px-pill ${tone || 'muted'}`} style={{ fontSize: '11px' }}>
                                        {right ? 'Correct' : wrong ? 'Wrong'
                                          : g.pending === g.count ? 'Not marked yet' : 'Mixed marks'}
                                      </span>
                                    </span>
                                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{g.count} ({share}%)</span>
                                  </div>
                                  <div style={{ background: 'var(--line)', height: '8px', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                                    <div style={{ width: `${share}%`, height: '100%', background: right ? 'var(--ok)' : wrong ? 'var(--bad)' : 'var(--navy-500)', borderRadius: 'var(--r-pill)' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {st.groups.length > 12 && (
                            <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--ink-3)' }}>
                              …and {st.groups.length - 12} other answer{st.groups.length - 12 === 1 ? '' : 's'}, each written by fewer students.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                }

                const counts = {};   // any number of choices (sql/016)
                // A multi-answer item's `chosen` is a set (sql/018), so every
                // index a student ticked is counted. The percentages then read
                // as "how many of the class ticked this choice" rather than
                // summing to 100, which is the right question for the type.
                let fullyRight = 0;
                statAnswers.forEach(aj => {
                  const sAnswer = aj[q.id];
                  if (sAnswer === undefined) return;
                  (indexSet(sAnswer.chosen) || []).forEach(i => { counts[i] = (counts[i] || 0) + 1; });
                  if (sAnswer.is_correct === true) fullyRight++;
                });
                const keySet = acceptedSetOf(q) || [];
                const multi = isMultiSelect(q);

                return (
                  <div key={q.id} className="card" style={{ padding: '20px 24px', borderLeft: '4px solid var(--navy)' }}>
                    <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: 'var(--ink-1)', fontSize: '14.5px' }}>
                      {idx + 1}. <span style={{ whiteSpace: 'pre-line' }}>{q.question_text}</span>
                      {multi && <span className="px-pill ok" style={{ marginLeft: 8 }}>Multiple answers</span>}
                    </p>
                    {multi && (
                      <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--ink-3)' }}>
                        Marked all or nothing — {fullyRight} of {totalAnswers} ticked
                        the whole key ({keySet.map(letterFor).join(', ')}) and nothing else.
                        Each bar below counts everyone who ticked that choice, so they do not add up to 100%.
                      </p>
                    )}
                    {q.image_url && (
                      <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 14 }} />
                    )}
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {choicesOf(q).map((choiceText, i) => {
                        const letter = letterFor(i);
                        const count = counts[i] || 0;
                        const percentage = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;
                        const isCorrect = keySet.includes(i);
                        return (
                          <div key={letter} style={{ padding: '10px 12px', borderRadius: 'var(--r-sm)', background: isCorrect ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1.5px solid ${isCorrect ? 'var(--ok-bd)' : 'var(--line)'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <span style={{ fontWeight: isCorrect ? 700 : 500, color: isCorrect ? 'var(--ok)' : 'var(--ink-2)', fontSize: '13.5px' }}>
                                <strong>{letter}.</strong> {choiceText}
                                {isCorrect && <span className="px-pill ok" style={{ marginLeft: 8, fontSize: '11px' }}>Correct</span>}
                              </span>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap', marginLeft: 12 }}>{count} ({percentage}%)</span>
                            </div>
                            <div style={{ background: 'var(--line)', height: '8px', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                              <div style={{ width: `${percentage}%`, height: '100%', background: isCorrect ? 'var(--ok)' : 'var(--navy-500)', borderRadius: 'var(--r-pill)', transition: 'width 0.5s var(--ease-out)' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Section Co-Instructor Modal */}
      {sectionCoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 480, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: 17 }}>Section Co-Instructors</h2>
                  <p style={{ margin: '3px 0 0', color: 'rgba(255,255,255,.6)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--gold-bright)' }}>{sectionCoModal}</strong> — both instructors see all exams for this section
                  </p>
                </div>
                <button className="btn ghost sm" onClick={() => setSectionCoModal(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                  <Icon name="x" size={14} color="white" />
                </button>
              </div>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Current co-instructors */}
              <div>
                <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>Current co-instructors</p>
                {(sectionCoMap[sectionCoModal] || []).length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, fontStyle: 'italic' }}>No co-instructors added yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(sectionCoMap[sectionCoModal] || []).map(row => {
                      const inst = instructorsList.find(i => i.id === row.instructor_id);
                      return (
                        <div key={row.instructor_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>{inst?.full_name || 'Unknown'}</p>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{inst?.email || ''}</p>
                          </div>
                          <button className="btn ghost sm" onClick={() => removeSectionCoInstructor(row)} style={{ color: 'var(--bad)', borderColor: 'var(--bad)', width: 'auto', fontSize: 12 }}>
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add co-instructor */}
              {instructorsList.filter(i => !(sectionCoMap[sectionCoModal] || []).some(r => r.instructor_id === i.id)).length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>Add a co-instructor</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      className="input"
                      value={sectionCoTarget}
                      onChange={e => setSectionCoTarget(e.target.value)}
                      style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}
                    >
                      <option value="">Select instructor…</option>
                      {instructorsList
                        .filter(i => !(sectionCoMap[sectionCoModal] || []).some(r => r.instructor_id === i.id))
                        .map(i => (
                          <option key={i.id} value={i.id}>{i.full_name} — {i.email}</option>
                        ))}
                    </select>
                    <button
                      className="btn sm"
                      onClick={addSectionCoInstructor}
                      disabled={!sectionCoTarget || isSectionCoSaving}
                      style={{ width: 'auto', whiteSpace: 'nowrap' }}
                    >
                      {isSectionCoSaving ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                    They will see and be able to administer all exams targeting <strong>{sectionCoModal}</strong>.
                  </p>
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, fontStyle: 'italic' }}>All other instructors already have access to this section.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Score Entry Modal */}
      {manualScoreModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 400, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '18px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 16 }}>Enter Score Manually</h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.65)', fontSize: 13 }}>
                {manualScoreModal.student_name} — {manualScoreModal.exam_title}
              </p>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                Answers weren't saved server-side for this student. Enter their score manually (out of <strong>{manualScoreModal.total_items}</strong>).
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  max={manualScoreModal.total_items}
                  value={manualScoreValue}
                  onChange={e => setManualScoreValue(e.target.value)}
                  className="input"
                  style={{ width: 100, fontSize: 20, fontWeight: 700, textAlign: 'center' }}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveManualScore()}
                />
                <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>/ {manualScoreModal.total_items}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => setManualScoreModal(null)} style={{ width: 'auto' }}>Cancel</button>
                <button className="btn sm" onClick={saveManualScore} style={{ width: 'auto' }}>Save Score</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPwModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '20px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 17, display: 'flex', alignItems: 'center', gap: 9 }}>
                <Icon name="lock" size={16} color="white" /> Change Password
              </h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.65)', fontSize: 13 }}>
                Update the password for your instructor account.
              </p>
            </div>
            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Current Password</label>
                <input className="input" type="password" autoComplete="current-password" value={pwCurrent}
                  onChange={e => { setPwCurrent(e.target.value); setPwError(''); }} autoFocus />
              </div>
              <div>
                <label className="label">New Password</label>
                <input className="input" type="password" autoComplete="new-password" value={pwNew}
                  onChange={e => { setPwNew(e.target.value); setPwError(''); }} placeholder="At least 8 characters" />
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <input className="input" type="password" autoComplete="new-password" value={pwConfirm}
                  onChange={e => { setPwConfirm(e.target.value); setPwError(''); }}
                  onKeyDown={e => e.key === 'Enter' && !isChangingPw && changePassword()} />
              </div>
              {pwError && (
                <div style={{ padding: '9px 12px', background: 'var(--bad-bg, #FDECEA)', border: '1px solid var(--bad, #E74C3C)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--bad, #C0392B)' }}>
                  {pwError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                <button className="btn ghost sm" onClick={closePwModal} disabled={isChangingPw} style={{ width: 'auto' }}>Cancel</button>
                <button className="btn sm" onClick={changePassword} disabled={isChangingPw} style={{ width: 'auto' }}>
                  {isChangingPw ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Force Submit Confirmation Modal */}
      {forceSubmitConfirmList && (() => {
        // Ending a sitting that still has time on it is a different act from
        // clearing up one whose clock already ran out, so the modal says so —
        // loudly, and with the minutes it is taking off each student.
        const early = forceSubmitConfirmList.filter(s => !isSessionForceSubmittable(s));
        const isEarly = early.length > 0;
        const accent = isEarly ? 'var(--bad, #C0392B)' : 'var(--warn)';
        const n = forceSubmitConfirmList.length;

        return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 520, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div style={{ background: accent, padding: '18px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name={isEarly ? 'alert' : 'send'} size={16} color="white" />
                {isEarly
                  ? `End ${n === 1 ? 'this exam' : `all ${n} exams`} now`
                  : `Force Submit ${n === 1 ? 'Exam' : `${n} Exams`}`}
              </h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.75)', fontSize: 13 }}>
                Scores will be calculated from answers already saved on the server.
              </p>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {isEarly && (
                <div style={{ background: 'var(--bad-bg)', border: '1.5px solid var(--bad-bd)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', gap: 10 }}>
                  <Icon name="alert" size={16} color="var(--bad)" />
                  <span style={{ fontSize: 13, color: 'var(--bad)', lineHeight: 1.55 }}>
                    <strong>{early.length} student{early.length !== 1 ? 's' : ''} still {early.length === 1 ? 'has' : 'have'} time left.</strong>{' '}
                    Their exam will be submitted where it stands and their timer taken away — anything
                    not yet answered is marked wrong. Use this to close a period on students who
                    started late; there is no way to hand the time back.
                  </span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                The following student{n !== 1 ? 's' : ''} will have their exam submitted immediately using their last saved answers. <strong>This cannot be undone.</strong>
              </p>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {forceSubmitConfirmList.map(s => {
                  const left = minutesLeftFor(s);
                  return (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>{formatName(s.student_name)}</p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{examsDict[s.exam_id] || s.exam_id}</p>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>
                      {s.answers_count || 0} answered
                      {left !== null && left > 0 && (
                        <span style={{ display: 'block', color: 'var(--bad)', fontWeight: 600 }}>
                          {left}m cut short
                        </span>
                      )}
                    </span>
                  </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => setForceSubmitConfirmList(null)} disabled={isForceSubmitting} style={{ width: 'auto' }}>
                  Cancel
                </button>
                <button
                  className="btn sm"
                  onClick={() => doForceSubmit(forceSubmitConfirmList)}
                  disabled={isForceSubmitting}
                  style={{ background: accent, borderColor: accent, color: 'white', width: 'auto', fontWeight: 700 }}
                >
                  {isForceSubmitting ? 'Submitting…'
                    : isEarly ? `Yes, submit ${n === 1 ? 'this exam' : `all ${n}`} now`
                    : `Submit ${n === 1 ? 'Exam' : 'All'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Violation log tooltip */}
      {liveViolationTooltip && (() => {
        const { session, rect } = liveViolationTooltip;
        // violation_log is written to live_sessions by the 5s pusher in ExamBoard
        // fall back to results.violation_logs for submitted/stuck sessions
        const result = results.find(r => r.student_id === session.student_id && r.exam_id === session.exam_id);
        const logs = (session.violation_log?.length ? session.violation_log : null)
          ?? result?.violation_logs
          ?? [];
        return (
          <div style={{
            position: 'fixed',
            ...(rect.bottom + 280 < window.innerHeight
              ? { top: rect.bottom + 8 }
              : { bottom: window.innerHeight - rect.top + 8 }),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
            zIndex: 9999,
            width: 'min(320px, calc(100vw - 16px))',
            maxHeight: '60vh', overflow: 'hidden',
            background: 'var(--navy-900)',
            color: 'white',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--sh-4)',
            padding: '14px 16px',
            pointerEvents: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name="flag" size={14} color="var(--gold-bright)" />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gold-bright)', }}>
                {session.student_name}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,.5)' }}>
                {session.violation_count} violation{session.violation_count !== 1 ? 's' : ''}
              </span>
            </div>
            {logs.length > 0 ? (
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
                {logs.map((log, i) => {
                  const split = log.indexOf('] ');
                  const ts = split >= 0 ? log.substring(0, split + 1) : '';
                  const reason = split >= 0 ? log.substring(split + 2) : log;
                  return (
                    <li key={i} style={{ fontSize: '12.5px', lineHeight: 1.5 }}>
                      {ts && <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '11px', color: 'rgba(255,255,255,.4)', marginRight: 6 }}>{ts}</span>}
                      <span style={{ color: 'rgba(255,255,255,.85)' }}>{reason}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,.5)', fontStyle: 'italic' }}>
                Log will appear within 5 seconds of the first violation.
              </p>
            )}
          </div>
        );
      })()}

    </div>
  );
}
/**
 * The points an item is worth, editable where it is read.
 *
 * Shown for every item, not only the weighted ones. A pill that appears the
 * moment a question stops being worth one point is a pill nobody knows they
 * can click, and reweighting a paper means touching most of its items.
 *
 * Commits on blur and on Enter; Escape puts the old number back. The value is
 * clamped on save rather than while typing, so clearing the box to type a new
 * number does not snap it to 1 under the cursor.
 */
function InlinePoints({ value, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  // The box shows the saved number whenever it is not being typed in, so a
  // value changed elsewhere is picked up without an effect writing state on
  // every render.
  const [draft, setDraft] = useState(null);
  const text = editing && draft !== null ? draft : String(value);
  const setText = setDraft;

  const commit = () => {
    const n = Math.max(1, Math.min(100, Math.round(Number(text) || 1)));
    setEditing(false);
    setDraft(null);
    if (n !== value) onSave(n);
  };

  return (
    <span
      title="Points for this question — click to change"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 10, verticalAlign: 'middle' }}
    >
      <input
        type="number" min={1} max={100}
        value={text}
        disabled={busy}
        onFocus={() => { setEditing(true); setDraft(String(value)); }}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        // A wheel over a focused number box changes it. Scrolling a long
        // list past one must never reweight a question, so the wheel lets go.
        onWheel={e => e.currentTarget.blur()}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(null); setEditing(false); e.currentTarget.blur(); }
        }}
        style={{
          width: 52, padding: '2px 6px', textAlign: 'center',
          fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 700,
          color: 'var(--ink-1)', background: 'var(--surface)',
          border: `1px solid ${editing ? 'var(--navy)' : 'var(--line)'}`,
          borderRadius: 'var(--r-sm)', opacity: busy ? 0.5 : 1,
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {busy ? 'saving…' : `pt${value === 1 ? '' : 's'}`}
      </span>
    </span>
  );
}
