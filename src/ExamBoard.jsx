import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { supabase } from './supabase';
import { prepareQuestions } from './lib/examOrder';
import { fetchAnswerReview } from './lib/answerReview';
import { clearPasswordGate } from './lib/examGateKeys';
import Icon from './components/Icon';
import AnswerReview from './components/AnswerReview';
import {
  isMultiSelect, isSelected, toggleIndex, answeredCount, answersPayload,
  isItemAnswered, answeredOnPaper, keepOnPaper,
} from './lib/answers';
import { sittingDecision, restartPatch } from './lib/retakes';
import { hasWork, isWorkedSolution, workMarksAvailable } from './lib/workedShape.js';
import { gateErrorMessage, isSessionExpiredError } from './lib/sessionErrors.js';
import { sessionReplaced } from './lib/sessionCheck.js';

// The maths editor and the step checker are megabytes between them, and most
// papers have no maths item at all. Split hard, so a student sitting a paper of
// plain multiple choice on a phone downloads none of it. workedShape.js above
// is the deliberate exception: it is a handful of lines with no maths in it,
// and the palette needs it on every render to know which items are worked.
const WorkedSolution = lazy(() => import('./components/WorkedSolution.jsx'));

// How many items a student has actually answered, across all three kinds that
// can be answered. Defined once because it is read in eight places — the
// header, the palette, the submit modal and three separate pushers — and a
// count that disagreed with itself between any two of them would look, to a
// student, exactly like lost work.
//
// Counted item by item against the paper, the way the navigator lights them.
// Counting saved entries instead showed "9 / 30" beside a navigator with 3
// lit, because a rebuilt paper's items have new ids and the old answers were
// still saved against the old ones (see answeredOnPaper). Until the paper has
// loaded there is nothing to count against, and the entries are all there is.
function countAnswered(questions, mc, essays, work) {
  if (questions?.length) return answeredOnPaper(questions, { answers: mc, essays, work });
  return answeredCount(mc)
    + Object.values(essays || {}).filter(t => t?.trim().length > 0).length
    + Object.values(work || {}).filter(hasWork).length;
}

// Question text and choices, scaled together. Kept per device — a phone
// wants a bigger step than a laptop, and it is a reading preference, not
// exam state.
const TEXT_SCALES = [1, 1.12, 1.25];
const TEXT_SIZE_KEY = 'exam_text_size';

// When the clock crosses one of these, the student is told once, in words.
// Turning the timer red at five minutes is easy to miss on a phone, where the
// header is the one thing not being looked at.
const TIME_NOTICES = [
  { at: 60, text: '1 minute left. Your paper is submitted automatically when time runs out.' },
  { at: 300, text: '5 minutes left. Check your unanswered and bookmarked questions.' },
  { at: 600, text: '10 minutes left.' },
];

// How long to let an instructor's force submit finish before deciding what a
// 'finished' row means. The claim and the marking are two round trips.
const FINISH_SETTLE_MS = 4000;
// How often an open paper checks that its account has not been logged into
// elsewhere (see the CLONE GUARD). One request per student per interval.
const SESSION_CHECK_MS = 60000;

export default function ExamBoard({ student, exam, examSet, onFinish }) {
  // Practice papers (unlimited retakes) still COUNT suspicious activity — the
  // instructor wants that signal — but are never locked for it. Locking a
  // revision paper the student can simply restart is pure friction, and it
  // strands them behind a screen only an instructor can clear.
  const isPractice = !!exam?.allow_retakes;

  const storageKey = `exam_progress_${student?.id}_${exam?.id}`;
  const startingSeconds = exam?.duration_minutes ? (exam.duration_minutes * 60) : 14400;

  // --- 1. INITIAL STATE ---
  const [initialState] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    const newProgress = { answers: {}, essayAnswers: {}, workAnswers: {}, tabSwitchCount: 0, violationLogs: [], examStatus: 'active', endTime: Date.now() + (startingSeconds * 1000) };
    localStorage.setItem(storageKey, JSON.stringify(newProgress));
    return newProgress;
  });

  const [answers, setAnswers] = useState(initialState.answers);
  const [essayAnswers, setEssayAnswers] = useState(initialState.essayAnswers || {});
  // Worked solutions (sql/024): { "<question id>": { lines: [...] } }. Kept
  // apart from `answers` because the shape is nothing like a choice index,
  // and apart from essays because these get marked.
  const [workAnswers, setWorkAnswers] = useState(initialState.workAnswers || {});
  const [flaggedQuestions, setFlaggedQuestions] = useState(initialState.flaggedQuestions || {});
  const [tabSwitchCount, setTabSwitchCount] = useState(initialState.tabSwitchCount);
  // Bug fix: restore violation logs from localStorage so they survive page refreshes
  const [violationLogs, setViolationLogs] = useState(initialState.violationLogs || []);
  const endTimeRef = useRef(initialState.endTime); // mutable so initLiveSession can clamp it
  const [timeLeft, setTimeLeft] = useState(startingSeconds);
  const [localTime, setLocalTime] = useState(new Date().toLocaleTimeString()); 
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [questions, setQuestions] = useState([]); 
  const [isLoading, setIsLoading] = useState(true); 
  const [scoreDisplay, setScoreDisplay] = useState(null); 
  // Set from submit_assessment(): whether this paper reveals answers, and
  // which attempt this was. Both drive the post-submit screen only.
  const [canReviewAnswers, setCanReviewAnswers] = useState(false);
  const [attemptNo, setAttemptNo] = useState(1);
  const [reviewRows, setReviewRows] = useState(null);   // null = not fetched
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  // initLiveSession decides whether this mount continues the sitting on file or
  // starts a new one — and a new one resets the clock. Until that lands, a stale
  // end time restored from localStorage can read as 0:00, and auto-submit must
  // not act on it. Set on every path, failures included, so a student whose
  // session lookup falls over still gets their timer honoured.
  const [sittingResolved, setSittingResolved] = useState(false);
  // The instructor closed this sitting from the live monitor — either because
  // the clock ran out or because they ended the period on everyone at once.
  // What the student had saved has already been submitted and marked by then;
  // this only makes sure they are told rather than left typing into a paper
  // that is no longer open.
  const [endedByInstructor, setEndedByInstructor] = useState(false);

  // --- SCREEN-ONLY STATE (nothing here is saved with the paper) ---
  // The question list as a bottom sheet on a phone. On a wider screen the
  // same panel sits beside the question and this does nothing.
  const [navOpen, setNavOpen] = useState(false);
  const [textSize, setTextSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(TEXT_SIZE_KEY));
      return TEXT_SCALES[v] ? v : 0;
    } catch { return 0; }
  });
  const [timeNotice, setTimeNotice] = useState(null);
  const lastTimeLeftRef = useRef(null);
  // The figure viewer covers the whole screen, so nothing can move to another
  // question while it is open; it always opens fitted to the screen.
  const [figureOpen, setFigureOpen] = useState(false);
  const [figureFull, setFigureFull] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false);
  const [reconnects, setReconnects] = useState(0);
  // A phone drawing the desktop layout: Safari's page zoom turned down, or
  // "Request Desktop Website" left on. Everything is then a third of the size
  // and nothing here can undo it — the browser setting has to change. Read
  // once; a touch screen whose short side is phone-sized but whose page is
  // laid out wider than any phone.
  const [zoomedOutPhone] = useState(() => {
    try {
      const shortSide = Math.min(window.screen.width, window.screen.height);
      return navigator.maxTouchPoints > 0 && shortSide > 0 && shortSide < 600
        && window.innerWidth > 780;
    } catch { return false; }
  });
  const [zoomNoticeClosed, setZoomNoticeClosed] = useState(false);

  // --- LIVE PROCTORING STATES ---
  // Restored from localStorage so a locked student sees the lock screen immediately on
  // page refresh — no bypass window while waiting for initLiveSession to complete.
  // A student locked on a practice paper before locking was disabled would
  // otherwise stay stuck behind a screen only an instructor can clear, on a
  // paper that is no longer supposed to lock at all.
  const [examStatus, setExamStatus] = useState(
    isPractice ? 'active' : (initialState.examStatus || 'active'));
  const [liveSessionId, setLiveSessionId] = useState(null);

  // Refs for anti-cheat deduplication (prevent blur+visibilitychange double-counting)
  const pendingBlurRef = useRef(null);
  const alertActiveRef = useRef(false);
  // Tracks the count at mount so the lock only fires on NEW violations, not restored ones
  const prevViolationCountRef = useRef(initialState.tabSwitchCount);
  // Synchronous mirrors of violation state — React state is async and unavailable in beforeunload
  const tabSwitchCountRef = useRef(initialState.tabSwitchCount);
  const violationLogsRef = useRef(initialState.violationLogs || []);
  // True from the moment visibilitychange fires until the tab becomes visible again.
  // Lets beforeunload know whether this unload is a tab close (already counted) or a refresh (not yet).
  const visibilityViolationRef = useRef(false);
  // Prevents double-submission when two rapid clicks hit before React re-renders
  const isSubmittingRef = useRef(false);
  // Set the moment this tab writes its own 'finished'. Realtime replays our own
  // writes back to us, so without this the student's own submit would arrive a
  // moment later looking exactly like an instructor ending the sitting.
  const weFinishedRef = useRef(false);
  // What was already on file for this paper when this sitting began — see
  // readFiled() in initLiveSession.
  const filedRef = useRef({ graded: false, maxAttempt: 0 });
  // Snapshot of answers captured when submit modal opens — prevents last-second tampering
  const answersSnapshotRef = useRef(null);
  const essaySnapshotRef = useRef(null);
  const workSnapshotRef = useRef(null);
  // Debounce handles — each pusher has its own ref so they never cancel each other
  const progressPushDebounceRef = useRef(null);
  const violationPushDebounceRef = useRef(null);
  // Floor for answers_count: prevents PROGRESS PUSHER from writing 0 when init restores a session
  // where answers couldn't be loaded locally (no localStorage, no answers_json column).
  const minAnswersCountRef = useRef(0);

  // --- CLONE GUARD: has this account been logged into somewhere else? ---
  // Once a minute, asked of the database (sql/034) rather than read out of the
  // users table: the token never comes back to the browser. This used to read
  // the table every 30 seconds, and across a class that was most of the
  // project's log volume on an exam day. It stops once the paper is in —
  // there is nothing left for a second login to interfere with.
  useEffect(() => {
    if (!student?.id || scoreDisplay || endedByInstructor) return;
    let stopped = false;
    const checkSession = setInterval(async () => {
      const localToken = localStorage.getItem('local_session_token');
      const replaced = await sessionReplaced(supabase, student.id, localToken);
      // Only a definite yes. "Could not tell" (null) never ends a sitting.
      if (stopped || replaced !== true) return;
      stopped = true;
      clearInterval(checkSession);
      alert("⚠️ SECURITY ALERT: Your account was logged in from another device or tab. You have been disconnected.");
      // Clear both tokens so reload lands at login instead of re-entering ExamBoard
      // and re-triggering this guard in an infinite loop.
      localStorage.removeItem('local_session_token');
      localStorage.removeItem('patts_student_session');
      window.location.reload();
    }, SESSION_CHECK_MS);

    return () => { stopped = true; clearInterval(checkSession); };
  }, [student?.id, scoreDisplay, endedByInstructor]);

  // SUBMISSION CONTROLS
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); 

  // --- FIX 1: LIVE SESSION INITIALIZATION & LISTENER ---
  useEffect(() => {
    if (!student?.id || !exam?.id) return;
    let channel;

    // What this student already has on file for this paper. A graded sitting
    // lands in `results`, a practice one in `review_attempts`, and the highest
    // attempt number is what tells one retake from the next.
    //
    // Read once at mount as a baseline, and again whenever the row is finished
    // from outside this tab: a force submit files a paper and moves one of
    // these, a dismiss files nothing and moves neither. That is the only way to
    // tell the two apart, and getting it wrong means telling a student their
    // work was submitted when it was not.
    const readFiled = async () => {
      const [gradedRes, attemptRes] = await Promise.all([
        supabase.from('results').select('student_id')
          .eq('student_id', student.id).eq('exam_id', exam.id).limit(1)
          .then(r => r, () => ({ data: null })),
        supabase.from('review_attempts').select('attempt_no')
          .eq('student_id', student.id).eq('assessment_id', exam.id)
          .order('attempt_no', { ascending: false }).limit(1)
          .then(r => r, () => ({ data: null })),
      ]);
      return {
        graded: (gradedRes.data?.length || 0) > 0,
        maxAttempt: attemptRes.data?.[0]?.attempt_no || 0,
      };
    };

    const initLiveSession = async () => {
      const hasLocalAnswers =
        answeredCount(initialState.answers) > 0 ||
        Object.keys(initialState.essayAnswers || {}).length > 0;

      const [{ data: rows }, filed] = await Promise.all([
        supabase.from('live_sessions').select('*')
          .eq('student_id', student.id).eq('exam_id', exam.id).limit(1),
        readFiled(),
      ]);
      filedRef.current = filed;
      let existing = rows?.[0] || null;

      let currentSessionId;

      if (existing) {
        currentSessionId = existing.id;

        if (existing.status === 'finished') {
          // What a finished row means depends on what is on file behind it: a
          // completed sitting either way, or — with neither on file — an
          // instructor dismiss of a sitting that was still in progress.
          const decision = sittingDecision({
            sessionStatus: 'finished',
            allowRetakes: isPractice,
            hasGradedResult: filedRef.current.graded,
            hasPriorAttempt: filedRef.current.maxAttempt > 0,
          });

          if (decision === 'blocked') {
            // Submitted, and the paper does not allow another go.
            setScoreDisplay({ score: 0, total: 0 });
            return; // liveSessionId intentionally stays null — exam is done
          }

          if (decision === 'restart') {
            // A new sitting, not a continuation. Reusing the finished row's
            // created_at would hand the retake whatever was left of the first
            // sitting's clock — the live monitor reads that column too and
            // would force-submit the student seconds after they started.
            await supabase.from('live_sessions')
              .update(restartPatch()).eq('id', existing.id);
            // Nothing carries over into a fresh sitting.
            endTimeRef.current = Date.now() + startingSeconds * 1000;
            prevViolationCountRef.current = 0;
            tabSwitchCountRef.current = 0;
            violationLogsRef.current = [];
            setTabSwitchCount(0);
            setViolationLogs([]);
            setAnswers({});
            setEssayAnswers({});
            setWorkAnswers({});
            setFlaggedQuestions({});
            try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
            existing = { ...existing, answers_json: {}, essay_answers_json: {}, work_answers_json: {} };
            setExamStatus('active');
            // The baseline stays as it is: it is what was on file before this
            // sitting, which is exactly what a later force submit will move.

          } else {
            // 'reopen' — dismissed by the instructor mid-sitting, so put it
            // back exactly as it was, clock included.
            await supabase.from('live_sessions').update({
              status: 'active',
              answers_count: countAnswered(questions, answers, essayAnswers, workAnswers),
              violation_count: tabSwitchCount,
              updated_at: new Date()
            }).eq('id', existing.id);
            setExamStatus('active');
          }
        } else {
          setExamStatus(existing.status);
          // Server violation count is authoritative — prevents localStorage manipulation
          const serverViolations = existing.violation_count || 0;
          const effectiveViolations = Math.max(tabSwitchCount, serverViolations);
          if (serverViolations > tabSwitchCount) {
            // Advance the "acknowledged" ref BEFORE the state update so the lock
            // effect doesn't mistake a server-restored count as a new violation.
            prevViolationCountRef.current = serverViolations;
            tabSwitchCountRef.current = serverViolations;
            setTabSwitchCount(serverViolations);
          }
          // Clamp endTime to server-authoritative max — prevents localStorage inflation
          if (existing.created_at) {
            const serverMax = new Date(existing.created_at).getTime() + (exam.duration_minutes * 60 * 1000) + 30000;
            if (endTimeRef.current > serverMax) endTimeRef.current = serverMax;
          }
          const localCount = countAnswered(questions, answers, essayAnswers, workAnswers);
          const serverCount = countAnswered(questions, existing.answers_json, existing.essay_answers_json, existing.work_answers_json);
          // Use existing.answers_count as a floor so a page refresh never resets the count to 0
          // when answers_json is missing (column not migrated) or localStorage was cleared.
          const safeCount = Math.max(localCount, serverCount, existing.answers_count || 0);
          minAnswersCountRef.current = safeCount;
          await supabase.from('live_sessions').update({
            answers_count: safeCount,
            violation_count: effectiveViolations,
            updated_at: new Date()
          }).eq('id', existing.id);
        }
      } else {
        // No existing session — insert. If it fails (race/duplicate), re-fetch instead.
        const { data: newSession, error: insertError } = await supabase
          .from('live_sessions')
          .insert([{
            student_id: student.id,
            exam_id: exam.id,
            student_name: student.full_name,
            status: 'active',
            violation_count: tabSwitchCount,
            answers_count: countAnswered(questions, answers, essayAnswers, workAnswers)
          }])
          .select()
          .single();

        if (insertError) {
          // Duplicate row — race condition. Re-fetch the real row.
          const { data: refetch } = await supabase.from('live_sessions')
            .select('*')
            .eq('student_id', student.id)
            .eq('exam_id', exam.id)
            .limit(1);
          if (refetch?.[0]) {
            existing = refetch[0];
            currentSessionId = existing.id;
            setExamStatus(existing.status === 'finished' ? 'active' : existing.status);
          }
        } else if (newSession) {
          currentSessionId = newSession.id;
        }
      }

      // New device: no local answers — restore from server so progress isn't lost
      if (existing && !hasLocalAnswers) {
        if (existing.answers_json && Object.keys(existing.answers_json).length > 0) {
          setAnswers(existing.answers_json);
        }
        if (existing.essay_answers_json && Object.keys(existing.essay_answers_json).length > 0) {
          setEssayAnswers(existing.essay_answers_json);
        }
        if (existing.work_answers_json && Object.keys(existing.work_answers_json).length > 0) {
          setWorkAnswers(existing.work_answers_json);
        }
      }

      setLiveSessionId(currentSessionId);

      // Listen for instructor lock/unlock commands via postgres_changes.
      // Safe now because the data pusher no longer writes status — only the
      // auto-lock effect and the instructor's toggleStudentLock write to that field.
      if (currentSessionId) {
        channel = supabase.channel(`session-${currentSessionId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'live_sessions',
            filter: `id=eq.${currentSessionId}`
          }, payload => {
            if (payload.new.status === 'finished') {
              if (weFinishedRef.current || isSubmittingRef.current) return;
              // Finished from the outside. A force submit files the paper and
              // this tab has nothing left to send; a dismiss files nothing and
              // was only ever meant for a row nobody is sitting behind. Which
              // one it was is decided by what appeared on file, not guessed.
              (async () => {
                // Force submit CLAIMS the row by finishing it and only then
                // marks the paper, so reading the moment the event lands would
                // see nothing filed yet and mistake it for a dismiss. Wait for
                // that round trip, then check the row is still finished — a
                // failed submission hands it straight back.
                await new Promise(r => setTimeout(r, FINISH_SETTLE_MS));
                if (weFinishedRef.current || isSubmittingRef.current) return;
                const { data: rowNow } = await supabase.from('live_sessions')
                  .select('status').eq('id', currentSessionId).maybeSingle();
                if (rowNow?.status !== 'finished') return;

                const now = await readFiled();
                const submitted = (now.graded && !filedRef.current.graded) ||
                                  now.maxAttempt > filedRef.current.maxAttempt;
                if (submitted) {
                  try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
                  setEndedByInstructor(true);
                  return;
                }
                // A dismiss, and the student is plainly still here. Put the row
                // back so they reappear on the monitor rather than sitting an
                // exam nobody can see.
                await supabase.from('live_sessions')
                  .update({ status: 'active', updated_at: new Date() })
                  .eq('id', currentSessionId).eq('status', 'finished');
              })().catch(err => console.error('Session end check failed:', err));
              return;
            }
            // Back to a live status. doForceSubmit claims a row by finishing it
            // and hands it back if the submission itself fails, so this is the
            // student being returned to a sitting that never actually ended.
            if (!weFinishedRef.current) setEndedByInstructor(false);
            // A practice paper is never locked, by the counter or by an
            // instructor — there is nothing to protect and the student can
            // just start it again.
            if (payload.new.status === 'locked') { if (!isPractice) setExamStatus('locked'); }
            else if (payload.new.status === 'active') setExamStatus('active');
          })
          .subscribe();
      }
    };

    initLiveSession()
      .catch(err => console.error('Live session init failed:', err))
      .finally(() => setSittingResolved(true));

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [student?.id, exam?.id]);

  // --- VIOLATION PUSHER (1s debounce) ---
  // Separate from the progress pusher so rapid answer changes never reset the violation timer.
  // With 100+ students, a student triggering violations every 2-3s would have previously reset
  // the single 5s debounce continuously, meaning the count never reached the DB.
  useEffect(() => {
    if (!liveSessionId) return;
    if (violationPushDebounceRef.current) clearTimeout(violationPushDebounceRef.current);
    violationPushDebounceRef.current = setTimeout(() => {
      violationPushDebounceRef.current = null;
      supabase.from('live_sessions').update({
        violation_count: tabSwitchCount,
        violation_log: violationLogs,
        updated_at: new Date()
      }).eq('id', liveSessionId).then(({ error }) => {
        if (error) console.error('Violation push failed:', error.message);
      });
    }, 1000);
    return () => {
      if (violationPushDebounceRef.current) clearTimeout(violationPushDebounceRef.current);
    };
  }, [tabSwitchCount, violationLogs, liveSessionId, reconnects]);

  // --- PROGRESS PUSHER (2s debounce) — the count for the admin monitor and the full answers
  // for cross-device resume, in ONE write. These used to be two pushers, 2s and 5s after
  // the last change, kept apart in case the answer columns had not been migrated. They
  // have been everywhere for a long time, and the pair was a third of the project's log
  // lines: every answer showed up twice, three seconds apart.
  useEffect(() => {
    if (!liveSessionId) return;
    if (progressPushDebounceRef.current) clearTimeout(progressPushDebounceRef.current);
    progressPushDebounceRef.current = setTimeout(() => {
      progressPushDebounceRef.current = null;
      const liveCount = countAnswered(questions, answers, essayAnswers, workAnswers);
      // Never write below the server-known count from session init — prevents a page refresh
      // on a new device from briefly resetting the count to 0 in the admin monitor.
      // Only until the paper has loaded, though: that floor was counted from saved
      // entries, which can include answers to items no longer on the paper, and once
      // the paper is here the count against it is the true one.
      const paperLoaded = questions.length > 0;
      const safeCount = paperLoaded ? liveCount : Math.max(liveCount, minAnswersCountRef.current);
      // Once the live count catches up, the floor is no longer needed.
      if (paperLoaded || liveCount >= minAnswersCountRef.current) minAnswersCountRef.current = 0;
      supabase.from('live_sessions').update({
        answers_count: safeCount,
        answers_json: answers,
        essay_answers_json: essayAnswers,
        work_answers_json: workAnswers,
        exam_set: examSet,
        updated_at: new Date()
      }).eq('id', liveSessionId).then(({ error }) => {
        if (error) console.error('Progress push failed:', error.message);
      });
    }, 2000);
    return () => {
      if (progressPushDebounceRef.current) clearTimeout(progressPushDebounceRef.current);
    };
    // `reconnects` re-sends on coming back online: a push made with no signal
    // fails, and nothing else would try again until the next answer changed.
  }, [answers, essayAnswers, workAnswers, questions, liveSessionId, reconnects]);

  // --- LOCK STATUS PUSHER (only writes when student auto-locks, never overrides instructor) ---
  useEffect(() => {
    if (!liveSessionId || examStatus !== 'locked') return;
    supabase.from('live_sessions').update({
      status: 'locked', updated_at: new Date()
    }).eq('id', liveSessionId).then(({ error }) => {
      if (error) console.error('Lock status push failed:', error.message);
    });
  }, [examStatus, liveSessionId]);

  const toggleFlag = (questionId) => {
    setFlaggedQuestions(prev => {
      const next = { ...prev };
      if (next[questionId]) delete next[questionId];
      else next[questionId] = true;
      return next;
    });
  };

  // --- ANSWERS TO ITEMS THAT ARE NOT ON THIS PAPER ---
  // A rebuilt paper has new question ids, and whatever was saved against the
  // old ones — on this device, or in the live session a resume restores from —
  // comes back with nothing on screen to belong to. It cannot be marked (the
  // server marks against the paper's own items) but it was being counted, and
  // pushed to the live monitor as if it were progress. Dropped once the paper
  // is here, and again if a restore from the server lands after that.
  useEffect(() => {
    if (questions.length === 0) return;
    const prune = (map, setter) => {
      if (keepOnPaper(map, questions) !== map) setter(prev => keepOnPaper(prev, questions));
    };
    prune(answers, setAnswers);
    prune(essayAnswers, setEssayAnswers);
    prune(workAnswers, setWorkAnswers);
    prune(flaggedQuestions, setFlaggedQuestions);
  }, [questions, answers, essayAnswers, workAnswers, flaggedQuestions]);

  // --- CONNECTION ---
  // Answers are written to this device on every change, so losing signal
  // loses nothing — but a student on mobile data cannot know that, and the
  // live session stops hearing from them. Say so, and push again on return.
  useEffect(() => {
    const up = () => { setIsOnline(true); setReconnects(n => n + 1); };
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // --- AUTO-SAVER ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting || endedByInstructor) return;
    const progressData = { answers, essayAnswers, workAnswers, flaggedQuestions, tabSwitchCount, violationLogs, examStatus, endTime: endTimeRef.current, examSet };
    localStorage.setItem(storageKey, JSON.stringify(progressData));
  }, [answers, essayAnswers, workAnswers, flaggedQuestions, tabSwitchCount, violationLogs, examStatus, storageKey, scoreDisplay, isSubmitting, endedByInstructor]);

  // --- TIMER & CLOCK ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting || endedByInstructor) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setLocalTime(new Date(now).toLocaleTimeString());
      const secondsRemaining = Math.max(0, Math.floor((endTimeRef.current - now) / 1000));
      setTimeLeft(secondsRemaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [scoreDisplay, isSubmitting, endedByInstructor]);

  // Pulls the marked paper back from the server. This is the only route to a
  // correct answer: get_answer_review() refuses unless the assessment has
  // show_answers on AND this student has already submitted it — and, since
  // sql/022, unless the caller can prove they ARE that student. The id alone
  // used to be enough, which made a paper opened for review hand its key to
  // anybody who passed a classmate's id.
  const loadAnswerReview = async () => {
    setIsLoadingReview(true);
    const { data, error } = await fetchAnswerReview(student?.id, exam.id);
    setIsLoadingReview(false);
    if (error) {
      console.error('Could not load the answer review:', error.message);
      alert(/session has expired/i.test(error.message || '')
        ? '⚠️ Your session has expired. Please log in again.'
        : 'Could not load the answers. Please try again.');
      return;
    }
    setReviewRows(data || []);
  };

  // --- SUBMIT HANDLER (declared before the auto-submit effect that depends on it) ---
  const executeSubmission = useCallback(async () => {
    if (isSubmittingRef.current || isSubmitting) return;
    isSubmittingRef.current = true;

    setIsSubmitting(true);
    setIsLoading(true);

    try {
      // Use snapshot captured at modal-open time; fall back to live state for auto-submit
      const submittedAnswers = answersSnapshotRef.current ?? answers;
      const submittedEssayAnswers = essaySnapshotRef.current ?? essayAnswers;
      const submittedWork = workSnapshotRef.current ?? workAnswers;

      // Marking happens on the server. This used to fetch every
      // correct_answer to mark in the browser, which is why the key was
      // readable by anyone holding the anon key — it ships in this bundle.
      // submit_assessment() marks in Postgres, routes the row to results or
      // review_attempts depending on whether retakes are on, and returns the
      // score. sql/003 revokes the key from anon once this is deployed.
      //
      // A multi-answer item (sql/018) sends an ARRAY of indices and is marked
      // all or nothing there; a single-answer one sends a plain index, exactly
      // as it always has. answersPayload() takes the shape from the answer
      // itself and drops anything left blank.
      const mcAnswers = answersPayload(submittedAnswers);

      // submit_assessment() files the working itself, from the live session
      // (sql/039) — so a refused save_worked_answers() below, a second sign-in
      // having replaced this device's token, no longer leaves the paper as
      // its picked items alone. The progress pusher writes that copy 2s
      // after the last change; send the one being handed in first.
      const workTotal = workMarksAvailable(questions);
      if (workTotal > 0) {
        const flush = supabase.from('live_sessions')
          .update({ work_answers_json: submittedWork, updated_at: new Date() });
        const { error: flushError } = await (liveSessionId
          ? flush.eq('id', liveSessionId)
          : flush.eq('student_id', student?.id).eq('exam_id', exam.id));
        if (flushError) console.error('Could not send working ahead of submit:', flushError.message);
      }

      const { data: outcome, error: rpcError } = await supabase.rpc('submit_assessment', {
        p_student_id: student?.id,
        p_assessment_id: exam.id,
        p_answers: mcAnswers,
        p_time_taken_seconds: startingSeconds - timeLeft,
        p_tab_switches: tabSwitchCount,
        p_violation_logs: violationLogs,
      });

      if (rpcError) {
        // No client-side fallback any more: sql/003 revokes anon's access to
        // correct_answer, so the browser cannot mark a paper even if it wanted
        // to. Marking here would silently record everyone as zero, which is
        // far worse than refusing. Fail loudly and keep the local copy so
        // nothing the student typed is lost.
        console.error('submit_assessment failed:', rpcError.message);
        throw new Error(rpcError.message);
      }

      const correctCount = outcome?.score ?? 0;
      const mcTotal = outcome?.total_items ?? 0;
      setCanReviewAnswers(!!outcome?.can_review);
      setAttemptNo(outcome?.attempt_no ?? 1);

      // Essays are not marked server-side (there is nothing to mark against),
      // so they are attached to the stored row separately.
      const essayPayload = {};
      Object.entries(submittedEssayAnswers).forEach(([qId, text]) => {
        if (text?.trim()) essayPayload[String(qId)] = { type: 'essay', text: text.trim() };
      });
      // NOTE: essays still go through the direct patch below and are subject
      // to the same silent loss described there. They are stored in
      // live_sessions.essay_answers_json regardless, which is where the
      // dashboard's repair path reads them from, so nothing is lost outright
      // — but this wants the same treatment as worked answers.

      // WORKING IS SAVED BY A FUNCTION, NOT BY PATCHING THE ROW.
      //
      // This used to do supabase.from('results').update({...}) straight from
      // the browser. A student's session has no UPDATE policy on that table,
      // so the statement matched zero rows — which is not an error — and
      // PostgREST reported success. Ten real submissions scored 0/0 with
      // every answer thrown away before anyone noticed, and essays had been
      // disappearing the same way for far longer. save_worked_answers()
      // (sql/026) proves the session and writes on the student's behalf,
      // returns what it saved, and its failures are actual failures.
      const workPayload = {};
      Object.entries(submittedWork).forEach(([qId, value]) => {
        const lines = (Array.isArray(value?.lines) ? value.lines : [])
          .map(l => String(l ?? '').trim()).filter(Boolean);
        if (lines.length > 0) workPayload[String(qId)] = { lines };
      });

      // One call saves the working AND marks it, in the database, against a
      // rubric this browser has never seen. The number that comes back is
      // already stored — it is read here, not decided here (sql/027).
      let workOutcome = null;
      if (workTotal > 0) {
        const { data, error: saveError } = await supabase.rpc('save_worked_answers', {
          p_student_id: student?.id,
          p_assessment_id: exam.id,
          p_session_token: localStorage.getItem('local_session_token'),
          p_work: workPayload,
        });
        // Loud, not silent: the answers are still in localStorage and in the
        // live session, so a student who sees this has not lost their work.
        if (saveError) console.error('Could not save worked answers:', saveError.message);
        else workOutcome = data;
      }

      // Essays still go through a direct patch, which only lands on a
      // non-practice paper. Their real home is live_sessions.essay_answers_json,
      // which the dashboard reads, so nothing is lost outright — but this
      // wants its own function the way worked answers now have one.
      if (Object.keys(essayPayload).length > 0 && !isPractice) {
        const { data: existing } = await supabase.from('results')
          .select('id, answers_json')
          .eq('student_id', student?.id).eq('exam_id', exam.id).limit(1);
        if (existing?.[0]) {
          const { error: essayError } = await supabase.from('results')
            .update({ answers_json: { ...(existing[0].answers_json || {}), ...essayPayload } })
            .eq('id', existing[0].id);
          if (essayError) console.error('Could not attach essay answers:', essayError.message);
        }
      }

      weFinishedRef.current = true;
      if (liveSessionId) {
        await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', liveSessionId);
      } else {
        await supabase.from('live_sessions').update({ status: 'finished' })
          .eq('student_id', student?.id).eq('exam_id', exam.id);
      }

      localStorage.removeItem(storageKey);
      // An item may be worth more than one point (sql/025), in which case the
      // weighted pair is the score — and the two are equal on an unweighted
      // paper, so this reads the same as it always did there.
      const weighted = outcome?.points_total !== null && outcome?.points_total !== undefined;
      const picked = weighted
        ? { score: Number(outcome.points_earned) || 0, total: Number(outcome.points_total) || 0 }
        : { score: correctCount, total: mcTotal || questions.length };

      // A paper of worked items has no picked items at all, so `picked` is 0
      // out of 0 and showing it would tell a student who answered everything
      // that they scored nothing. Their answers are marked here instead, from
      // the keys the paper releases once it has been handed in (sql/026) —
      // which only happens when the instructor has turned answers on. When
      // they have not, the score is left as pending rather than invented.
      if (workTotal > 0) {
        // The server has already marked it — by save_worked_answers() when it
        // got through, otherwise by submit_assessment() itself (sql/039).
        // Only when neither did are the marks shown as pending rather than
        // invented; an instructor can still recover and score the script.
        const filed = workOutcome
          ?? (outcome?.work_total !== null && outcome?.work_total !== undefined ? outcome : null);
        const earned = filed?.work_marks !== null && filed?.work_marks !== undefined
          ? Number(filed.work_marks) : NaN;
        const available = Number(filed?.work_total) || workTotal;
        setScoreDisplay(Number.isFinite(earned)
          ? { score: picked.score + earned, total: picked.total + available }
          : { ...picked, workPending: workTotal });
      } else {
        setScoreDisplay(picked);
      }

    } catch (err) {
      alert("There was an error saving your exam. Please contact your instructor.");
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
      setIsSubmitting(false);
      setShowSubmitModal(false);
      // Spent either way. After a failure the student carries on answering,
      // and a retry — or the clock running out — must send what they have
      // now, not what they had when they first pressed Submit.
      answersSnapshotRef.current = null;
      essaySnapshotRef.current = null;
      workSnapshotRef.current = null;
    }
  }, [answers, essayAnswers, workAnswers, questions, tabSwitchCount, violationLogs, timeLeft, startingSeconds, liveSessionId, student, exam, isSubmitting]);
  // answersSnapshotRef / essaySnapshotRef intentionally excluded — refs are stable

  // --- SAFE AUTO-SUBMIT TRIGGER ---
  useEffect(() => {
    if (timeLeft === 0 && sittingResolved && !scoreDisplay && !isSubmitting && !isLoading && !endedByInstructor) {
      executeSubmission();
    }
  }, [timeLeft, sittingResolved, scoreDisplay, isSubmitting, isLoading, endedByInstructor, executeSubmission]);

  // --- NO EXAM-CLOSE WATCHER, deliberately ---
  // Closing a paper hides it from the list; it does NOT end sittings already
  // in progress. The instructor ends those with Force Submit, or the clock
  // does. A 30-second poll here was meant to auto-submit on close, but it
  // depended on executeSubmission, which changes every second with the
  // clock, so its timer was restarted every second and never once fired.
  // Every exam has run without it, and that is now the intended behaviour.

  // --- ANTI-CHEAT ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting || examStatus === 'locked' || endedByInstructor) return;

    const logViolation = (reason) => {
      const timeStr = new Date().toLocaleTimeString();
      const log = `[${timeStr}] ${reason}`;
      // Update refs synchronously first — beforeunload reads these, not React state
      tabSwitchCountRef.current += 1;
      violationLogsRef.current = [...violationLogsRef.current, log];
      setViolationLogs(violationLogsRef.current);
      setTabSwitchCount(tabSwitchCountRef.current);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) { visibilityViolationRef.current = false; return; }
      visibilityViolationRef.current = true; // mark so beforeunload doesn't double-count
      // Cancel any pending blur log — visibilitychange is the authoritative tab-switch event
      if (pendingBlurRef.current) {
        clearTimeout(pendingBlurRef.current);
        pendingBlurRef.current = null;
      }
      logViolation("Tab hidden or switched to another app");
      // Counted either way; only a real exam interrupts the student for it.
      if (!isPractice) {
        alertActiveRef.current = true;
        alert("⚠️ SYSTEM WARNING: Tab switch detected.");
        alertActiveRef.current = false;
      }
    };

    // Fires on both tab close AND page refresh.
    // - Tab close: visibilitychange already fired and counted the violation.
    //   We only need to flush lock status to localStorage before the page dies.
    // - Refresh: visibilitychange does NOT fire in Chrome (tab stays "visible").
    //   We count the violation here and save everything synchronously.
    const handleBeforeUnload = () => {
      let finalCount = tabSwitchCountRef.current;
      let finalLogs = violationLogsRef.current;

      if (!visibilityViolationRef.current) {
        // Refresh — not yet counted by visibilitychange
        const timeStr = new Date().toLocaleTimeString();
        finalCount += 1;
        finalLogs = [...finalLogs, `[${timeStr}] Page refreshed`];
      }

      try {
        const saved = localStorage.getItem(storageKey);
        const progress = saved ? JSON.parse(saved) : {};
        const shouldLock = !isPractice && finalCount > 0 && finalCount % 4 === 0;
        localStorage.setItem(storageKey, JSON.stringify({
          ...progress,
          tabSwitchCount: finalCount,
          violationLogs: finalLogs,
          endTime: endTimeRef.current,
          examStatus: shouldLock ? 'locked' : (progress.examStatus || 'active'),
        }));
      } catch { /* ignore */ }
    };

    const handleBlur = () => {
      // Ignore blur caused by our own alert dialogs
      if (alertActiveRef.current) return;
      // Wait 250ms — if visibilitychange fires first it cancels this, preventing double-count
      if (pendingBlurRef.current) clearTimeout(pendingBlurRef.current);
      pendingBlurRef.current = setTimeout(() => {
        pendingBlurRef.current = null;
        // Only log if tab is still visible (genuine split-screen / notification focus loss)
        if (!document.hidden) {
          logViolation("Screen lost focus (Split-screen or notifications opened)");
        }
      }, 250);
    };

    const handleKeyDown = (e) => {
      const forbidden = e.key === 'PrintScreen'
        || ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's'))
        || (e.metaKey && e.shiftKey);
      if (forbidden) {
        e.preventDefault();
        logViolation("Screenshot or Print shortcut attempted");
        if (!isPractice) alert("⚠️ SECURITY VIOLATION: Screenshot/Print disabled.");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (pendingBlurRef.current) {
        clearTimeout(pendingBlurRef.current);
        pendingBlurRef.current = null;
      }
    };
  }, [scoreDisplay, isSubmitting, examStatus, endedByInstructor]);

  // Dedicated lock trigger — only fires when count actually increases (not on page restore).
  // Locks at every 4th NEW violation: 4, 8, 12, ...
  // Instructor unlocks give students another 4-violation window before the next lock.
  useEffect(() => {
    tabSwitchCountRef.current = tabSwitchCount; // keep sync ref current (e.g. after server restore)
    if (
      !isPractice &&
      tabSwitchCount > prevViolationCountRef.current &&
      tabSwitchCount % 4 === 0 &&
      !scoreDisplay &&
      !isSubmitting
    ) {
      setExamStatus('locked');
    }
    prevViolationCountRef.current = tabSwitchCount;
  }, [tabSwitchCount, scoreDisplay, isSubmitting, isPractice]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    async function loadQuestions() {
      if (!exam?.id) return;

      // The paper comes from the server, gated (sql/020). The password used to
      // guard the Start button and nothing else — the questions themselves came
      // from a table anon could read with USING (true), so the gate could be
      // walked around by never clicking Start. get_exam_questions() checks who
      // is asking, that the paper is theirs and open, and that they are through
      // the password, before it hands over a single item.
      // The only way in: since sql/021 anon cannot read `questions` at all.
      const { data, error } = await supabase.rpc('get_exam_questions', {
        p_assessment_id: exam.id,
        p_student_id: student?.id,
        p_session_token: localStorage.getItem('local_session_token'),
      });

      if (error || !data || data.length === 0) {
        console.error("Error loading questions:", error);
        // The gate's refusals are written to be read by a student — show the
        // one that applies rather than a generic failure they cannot act on.
        alert(isSessionExpiredError(error)
          // Worth spelling out: the student has done nothing wrong and the
          // server is fine. There is one session_token per student, so logging
          // in anywhere else invalidated this device.
          ? `⚠️ ${gateErrorMessage(error)}`
          : error?.message && /password|section|not open|exists/i.test(error.message)
            ? `⚠️ ${error.message}`
            : "⚠️ Could not load exam questions. Please refresh the page or contact your instructor.");

        // Turned away at the password gate, holding a tab that thinks it is
        // already through. That happens the moment an instructor changes a
        // paper's password: sql/020's trigger tears up every unlock, but the
        // sessionStorage flag lives in the tab and survives it, so ExamList
        // skips the modal and sends the student straight back here. Forget the
        // flag and they are asked for the new password, which is the whole
        // point of changing it. Without this they loop on a dead screen that a
        // refresh cannot clear.
        if (/password/i.test(error?.message || '')) {
          clearPasswordGate(student?.id, exam.id);
        }

        // Never strand them on an exam shell with no questions in it. Nothing
        // has been answered yet at mount, and a paper already under way is
        // resumed from its live session, so going back costs nothing and is
        // the only screen with a way forward on it.
        setIsLoading(false);
        onFinish?.();
        return;
      }

      if (data) {
        // Order, and per-question choice order, both seeded on the student so
        // a reload gives the same paper back. See src/lib/examOrder.js.
        setQuestions(prepareQuestions(data, exam, student?.id));
      }
      setIsLoading(false);
    }
    loadQuestions();
    // The two switches decide the order the paper is built in, so they belong
    // here. Answers are keyed by question id and live in their own state, so a
    // reload only re-orders what is on screen; nothing a student has picked is
    // lost if an instructor flips a switch mid-sitting. `exam` itself is NOT a
    // dependency: it is a fresh object on every parent render, which would
    // refetch and reshuffle the paper continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, student?.id, exam?.shuffle_choices, exam?.shuffle_questions]);

  // --- MOVING BETWEEN QUESTIONS ---
  const goTo = useCallback((n) => {
    setCurrentQuestion(Math.min(Math.max(1, n), Math.max(1, questions.length)));
    setNavOpen(false);
  }, [questions.length]);

  // Snapshot the answers as the confirmation opens, so what is submitted is
  // what the student was looking at when they confirmed.
  const openSubmit = () => {
    answersSnapshotRef.current = { ...answers };
    essaySnapshotRef.current = { ...essayAnswers };
    workSnapshotRef.current = { ...workAnswers };
    setNavOpen(false);
    setShowSubmitModal(true);
  };

  // ...and let go of it if they back out. Kept, the snapshot outlived the
  // modal: a student who opened it, cancelled, and carried on answering had
  // the OLD snapshot sent when the clock ran out or the paper was closed on
  // them, and everything answered after that cancel was lost.
  const closeSubmit = () => {
    setShowSubmitModal(false);
    setConfirmText('');
    answersSnapshotRef.current = null;
    essaySnapshotRef.current = null;
    workSnapshotRef.current = null;
  };

  // A new question starts at its top. On a phone the Next button is at the
  // bottom of a long page, and without this the next question opened already
  // scrolled past its own text.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentQuestion]);

  useEffect(() => {
    try { localStorage.setItem(TEXT_SIZE_KEY, String(textSize)); } catch { /* private mode */ }
  }, [textSize]);

  // --- TIME NOTICES ---
  // Only on the way down through a mark, never for one already passed when
  // the page opened — except that a refresh deep into the paper does cross
  // them all at once, and then the nearest is the one worth saying.
  useEffect(() => {
    if (!sittingResolved || scoreDisplay || isSubmitting) return;
    const prev = lastTimeLeftRef.current;
    lastTimeLeftRef.current = timeLeft;
    if (prev === null || timeLeft <= 0) return;
    const crossed = TIME_NOTICES.find(n => prev > n.at && timeLeft <= n.at && startingSeconds > n.at);
    if (crossed) setTimeNotice(crossed.text);
  }, [timeLeft, sittingResolved, scoreDisplay, isSubmitting, startingSeconds]);

  useEffect(() => {
    if (!timeNotice) return;
    const t = setTimeout(() => setTimeNotice(null), 9000);
    return () => clearTimeout(t);
  }, [timeNotice]);

  // --- KEYBOARD (a laptop; a phone has no keys to press) ---
  // ← → to move, and the letter beside a choice to pick it. Never while the
  // student is typing — an essay, a maths answer, the confirmation box — and
  // never with a modifier held, which is the anti-cheat handler's territory.
  useEffect(() => {
    // Only while the paper is actually being sat. These are registered on
    // every screen, and a locked student — or one already submitted — must not
    // be able to change an answer from the keyboard.
    if (isLoading || scoreDisplay || isSubmitting || endedByInstructor || examStatus === 'locked') return;
    if (showSubmitModal || figureOpen || navOpen) return;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, math-field, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(currentQuestion + 1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentQuestion - 1); return; }
      const q = questions[currentQuestion - 1];
      if (!q || isWorkedSolution(q) || q.question_type === 'essay') return;
      if (!/^[a-z]$/i.test(e.key)) return;
      const position = e.key.toLowerCase().charCodeAt(0) - 97;
      const original = (q.choice_order || [])[position];
      if (original === undefined) return;
      e.preventDefault();
      setAnswers(prev => ({
        ...prev,
        [q.id]: isMultiSelect(q) ? toggleIndex(prev[q.id], original) : original,
      }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [questions, currentQuestion, showSubmitModal, figureOpen, navOpen, goTo,
      isLoading, scoreDisplay, isSubmitting, endedByInstructor, examStatus]);

  // Escape closes whatever is open over the paper.
  useEffect(() => {
    if (!navOpen && !figureOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setNavOpen(false);
      setFigureOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, figureOpen]);

  if (isLoading && !isSubmitting) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        <Icon name="clipboard" size={38} color="var(--navy)" style={{ opacity: 0.22, marginBottom: 14 }} />
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: 'var(--ink-2)' }}>Loading Exam…</p>
      </div>
    </div>
  );

  // Ended from the live monitor. Shown ahead of the score screen because the
  // student never submitted this one themselves — telling them their paper is
  // in and why is the whole point, and a score they did not choose to end on
  // would only read as an accusation.
  if (endedByInstructor) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
        <div className="patts-header" style={{ padding: '36px 24px 80px', textAlign: 'center', position: 'relative' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 52, objectFit: 'contain' }} />
            <div className="eyebrow" style={{ color: 'var(--gold-bright)', fontSize: 11, maxWidth: 340, margin: '14px auto 0', lineHeight: 1.5 }}>
              Aeronautical Engineering Learning Portal
            </div>
            <h1 className="display" style={{ color: 'white', marginTop: 8, fontSize: 24 }}>Time Called</h1>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '0 20px 40px', marginTop: -56, position: 'relative', zIndex: 1 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden', boxShadow: 'var(--s-lg)' }}>
            <div style={{ background: 'linear-gradient(135deg, #34495E 0%, #22313F 100%)', padding: '36px 32px', textAlign: 'center' }}>
              <Icon name="check-circle" size={48} color="white" style={{ marginBottom: 14, opacity: .92 }} />
              <h2 style={{ margin: 0, color: 'white', fontSize: 20, fontWeight: 800 }}>Your instructor has ended this exam.</h2>
              <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.78)', fontSize: 13.5 }}>
                {student?.full_name}{examSet ? ` · Set ${examSet}` : ''}
              </p>
            </div>
            <div style={{ padding: '28px 32px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.65 }}>
                Everything you had answered was saved and has been submitted for marking.
                There is nothing further for you to do here.
              </p>
              <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                If you believe this was a mistake, speak to your instructor — only they can reopen a paper.
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{ marginTop: 22, width: '100%', background: 'var(--navy)', color: 'white', fontWeight: 700, padding: '12px' }}
              >
                Back to my papers
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (scoreDisplay) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>

        {/* Hero band */}
        <div className="patts-header" style={{ padding: '36px 24px 80px', textAlign: 'center', position: 'relative' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 52, objectFit: 'contain' }} />
            {/* wraps rather than overflowing on a narrow phone — see Login.jsx */}
            <div className="eyebrow" style={{ color: 'var(--gold-bright)', fontSize: 11, maxWidth: 340, margin: '14px auto 0', lineHeight: 1.5 }}>
              Aeronautical Engineering Learning Portal
            </div>
            <h1 className="display" style={{ color: 'white', marginTop: 8, fontSize: 24 }}>Exam Complete</h1>
          </div>
        </div>

        {/* Result card */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '0 20px 40px', marginTop: -56, position: 'relative', zIndex: 1 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden', boxShadow: 'var(--s-lg)' }}>
            <div style={{ background: 'linear-gradient(135deg, #27AE60 0%, #1E8449 100%)', padding: '36px 32px', textAlign: 'center' }}>
              <Icon name="check-circle" size={48} color="white" style={{ marginBottom: 14, opacity: .92 }} />
              <h2 style={{ margin: 0, color: 'white', fontSize: 20, fontWeight: 800 }}>Your answers have been saved.</h2>
              <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.78)', fontSize: 13.5 }}>
                {student?.full_name} · Set {examSet}
              </p>
            </div>
            <div style={{ padding: '28px 32px', textAlign: 'center' }}>
              {/* On a paper that reveals answers there is no reason to withhold
                  the mark — the student is about to see every question anyway.
                  On a real exam it stays hidden, as before. */}
              {canReviewAnswers && scoreDisplay && (() => {
                // A worked paper's score arrives a moment after submit, once
                // the answers have been fetched and marked on this device. A
                // percentage of a half-counted paper would be wrong, so while
                // marks are still pending there is no percentage at all.
                const pending = scoreDisplay.workPending > 0;
                const pct = (!pending && scoreDisplay.total > 0)
                  ? Math.round((scoreDisplay.score / scoreDisplay.total) * 100) : null;
                const tone = pct === null ? 'var(--ink-2)'
                  : pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
                return (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700 }}>
                      Your score{attemptNo > 1 ? ` · attempt ${attemptNo}` : ''}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 40, color: tone, lineHeight: 1.1, marginTop: 6 }}>
                      {pending ? '—' : scoreDisplay.score}
                      <span style={{ color: 'var(--ink-4)', fontSize: 26 }}>
                        /{pending ? scoreDisplay.workPending + scoreDisplay.total : scoreDisplay.total}
                      </span>
                    </div>
                    {pct !== null && (
                      <div style={{ fontSize: 15, fontWeight: 700, color: tone, marginTop: 2 }}>{pct}%</div>
                    )}
                    {pending && (
                      <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600, marginTop: 4 }}>
                        Your instructor will mark this
                      </div>
                    )}

                  </div>
                );
              })()}

              <p style={{ margin: '0 0 22px', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.65 }}>
                {canReviewAnswers
                  ? 'You can retake this as many times as you like. Review your answers below to see what you missed.'
                  : 'Your submission is recorded. You may now close this window or return to the login screen.'}
              </p>
              <button onClick={() => window.location.reload()} className="btn lg" style={{ width: '100%' }}>
                <Icon name="login" size={16} />
                Return to Login
              </button>
            </div>
          </div>
        </div>

        {/* Answer review. Sits BELOW the navy hero band, on the light page
            background — AnswerReview inks itself for a light surface, which is
            why it must stay outside that band. Not the only way in any more:
            the Summary tab reopens this for any paper the instructor has
            switched review on for, including long after the sitting. */}
        {canReviewAnswers && (
          <div style={{ maxWidth: 820, margin: '0 auto', width: '100%', padding: '0 4px' }}>
            {reviewRows === null ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
                <button
                  onClick={loadAnswerReview}
                  disabled={isLoadingReview}
                  className="btn"
                  style={{ width: 'auto', padding: '12px 28px' }}
                >
                  <Icon name="eye" size={15} />
                  {isLoadingReview ? 'Loading…' : 'Review my answers'}
                </button>
              </div>
            ) : (
              <AnswerReview rows={reviewRows} />
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', margin: '20px 0 14px', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.18em', fontWeight: 700 }}>
          KMR · PATTS COLLEGE OF AERONAUTICS
        </p>
      </div>
    );
  }

  if (examStatus === 'locked') {
    return (
      <div className="prevent-select" style={{ background: 'var(--navy-900)', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '24px' }}>
        <div style={{ maxWidth: 620, width: '100%' }}>
          <div style={{ border: '2px solid rgba(231,76,60,.45)', borderRadius: 'var(--r-lg)', padding: '36px 28px', marginBottom: 24, background: 'rgba(231,76,60,.07)' }}>
            <Icon name="alert" size={48} color="#E74C3C" style={{ marginBottom: 16 }} />
            <h1 style={{ fontSize: 28, color: '#E74C3C', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.01em' }}>EXAM SUSPENDED</h1>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,.72)', margin: 0 }}>Your exam has been paused by the system.</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(231,76,60,.14)', border: '1px solid rgba(231,76,60,.38)', color: '#E74C3C', padding: '8px 20px', borderRadius: 9999, fontSize: 14, fontWeight: 700 }}>
              <Icon name="flag" size={14} color="#E74C3C" />
              {tabSwitchCount} Violation{tabSwitchCount !== 1 ? 's' : ''} Recorded
            </span>
          </div>
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 'var(--r-md)', padding: '24px 28px' }}>
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,.68)', margin: 0, lineHeight: 1.78 }}>
              This system has recorded multiple attempts to bypass security protocols. You are now locked out of the exam.
              <br /><br />
              In accordance with the <strong style={{ color: 'white' }}>Student Handbook</strong>, academic dishonesty will be sanctioned accordingly.
              Your instructor has been notified. Please <strong style={{ color: 'white' }}>raise your hand</strong> and wait for further instructions.
            </p>
          </div>
        </div>
        <p style={{ margin: '28px 0 0', fontSize: 10, color: 'rgba(255,255,255,.14)', letterSpacing: '.18em', fontWeight: 700 }}>
          KMR · PATTS COLLEGE OF AERONAUTICS
        </p>
      </div>
    );
  }

  const currentQ = questions[currentQuestion - 1] || {};
  const multiSelect = isMultiSelect(currentQ);
  const worked = isWorkedSolution(currentQ);
  const isEssay = currentQ?.question_type === 'essay';
  const isLast = questions.length > 0 && currentQuestion === questions.length;
  const isFlagged = !!flaggedQuestions[currentQ?.id];
  const lowTime = timeLeft <= 300;

  // One count, read everywhere on this screen — see countAnswered().
  const totalAnswered = countAnswered(questions, answers, essayAnswers, workAnswers);
  const allAnswered = questions.length > 0 && totalAnswered === questions.length;
  // Question NUMBERS, as the student sees them on the navigator.
  const answeredMaps = { answers, essays: essayAnswers, work: workAnswers };
  const unansweredNos = questions
    .map((q, i) => (isItemAnswered(q, answeredMaps) ? null : i + 1)).filter(Boolean);
  const flaggedNos = questions
    .map((q, i) => (flaggedQuestions[q.id] ? i + 1 : null)).filter(Boolean);
  // The next one after this question, wrapping round to the first.
  const nextOf = list => list.find(n => n > currentQuestion) ?? list[0];

  // "submit now" as a phone types it — often with the trailing space that
  // predictive text adds, which used to leave the Submit button greyed out
  // with no hint why.
  const confirmed = confirmText.trim().replace(/\s+/g, ' ').toLowerCase() === 'submit now';

  const pickChoice = originalIndex => setAnswers(prev => ({
    ...prev,
    [currentQ.id]: multiSelect ? toggleIndex(prev[currentQ.id], originalIndex) : originalIndex,
  }));

  return (
    <div
      className={`exam-shell prevent-select${navOpen ? ' nav-open' : ''}`}
      style={{ '--q-scale': TEXT_SCALES[textSize] }}
      onContextMenu={e => e.preventDefault()}
    >

      {/* ── Submit confirmation ── */}
      {showSubmitModal && (
        <div className="exam-overlay" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="card exam-dialog">
            <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '22px 24px', borderBottom: '3px solid var(--gold)' }}>
              <h2 id="submit-title" style={{ margin: 0, color: 'white', fontSize: 17, fontWeight: 700 }}>Final Submission</h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.62)', fontSize: 13 }}>
                {totalAnswered} of {questions.length} questions answered
              </p>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              {/* Not just how many are left, but which — each one a way back
                  to it. A count alone left the student to hunt through the
                  navigator for the gap. */}
              {unansweredNos.length > 0 && (
                <div className="submit-list warn">
                  <div className="submit-list-title">
                    <Icon name="alert" size={15} />
                    {unansweredNos.length} question{unansweredNos.length !== 1 ? 's' : ''} left unanswered
                  </div>
                  <div className="submit-chips">
                    {unansweredNos.map(n => (
                      <button key={n} type="button" className="submit-chip"
                        onClick={() => { closeSubmit(); goTo(n); }}
                        aria-label={`Go to question ${n}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {flaggedNos.length > 0 && (
                <div className="submit-list flag">
                  <div className="submit-list-title">
                    <Icon name="bookmark" size={14} color="#E67E22" />
                    {flaggedNos.length} bookmarked for review
                  </div>
                  <div className="submit-chips">
                    {flaggedNos.map(n => (
                      <button key={n} type="button" className="submit-chip"
                        onClick={() => { closeSubmit(); goTo(n); }}
                        aria-label={`Go to bookmarked question ${n}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(unansweredNos.length > 0 || flaggedNos.length > 0) && (
                <p style={{ margin: '-4px 0 16px', fontSize: 12, color: 'var(--ink-4)' }}>
                  Tap a number to go back to that question.
                </p>
              )}
              {allAnswered && flaggedNos.length === 0 && (
                <div className="submit-list ok">
                  <div className="submit-list-title">
                    <Icon name="check-circle" size={15} />
                    Every question has an answer.
                  </div>
                </div>
              )}

              <p style={{ margin: '0 0 12px', color: 'var(--ink-3)', fontSize: 13.5, textAlign: 'center' }}>
                Type <strong style={{ color: 'var(--navy)' }}>submit now</strong> to confirm:
              </p>
              <input
                className="input"
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="type here…"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="done"
                style={{ textAlign: 'center', fontSize: 16, borderColor: confirmed ? 'var(--ok)' : undefined }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={closeSubmit}>
                  Keep working
                </button>
                <button
                  className="btn"
                  style={{ flex: 1, background: confirmed ? 'var(--ok)' : 'var(--ink-4)', border: 'none' }}
                  disabled={!confirmed || isSubmitting}
                  onClick={executeSubmission}
                >
                  {isSubmitting ? 'Saving…' : 'Submit Exam'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky exam header ── */}
      <header className="patts-header exam-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1, minWidth: 0 }}>
          <img src="/patts-logo.png" alt="PATTS" className="exam-logo" />
          <p className="exam-student-name" style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.68)', fontWeight: 500 }}>
            {student?.full_name} &nbsp;·&nbsp; Set {examSet}
          </p>
        </div>
        <div className="exam-header-right" style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <div className="exam-header-meta" style={{ fontSize: 11, textAlign: 'right', color: 'rgba(255,255,255,.52)', lineHeight: 1.5 }}>
            Local Time<br /><strong style={{ color: 'white', fontSize: 13 }}>{localTime}</strong>
          </div>
          <div title="Tab switches recorded" style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: tabSwitchCount > 0 ? 'rgba(231,76,60,.25)' : 'rgba(255,255,255,.1)',
            border: `1px solid ${tabSwitchCount > 0 ? 'rgba(231,76,60,.5)' : 'rgba(255,255,255,.15)'}`,
            color: tabSwitchCount > 0 ? '#FF8F85' : 'rgba(255,255,255,.75)',
            padding: '5px 12px', borderRadius: 'var(--r-full)', fontWeight: 700, fontSize: 13,
          }}>
            <Icon name="flag" size={13} />
            {tabSwitchCount}
          </div>
          <div className="exam-timer" role="timer" aria-label="Time left" style={{
            fontSize: 22, fontWeight: 800, letterSpacing: '-.02em',
            color: lowTime ? '#FF8F85' : 'white',
            background: lowTime ? 'rgba(231,76,60,.22)' : 'rgba(255,255,255,.1)',
            padding: '6px 16px', borderRadius: 'var(--r-sm)',
            border: lowTime ? '1px solid rgba(231,76,60,.4)' : '1px solid rgba(255,255,255,.14)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </header>

      {timeNotice && (
        <div className="exam-toast" role="status" aria-live="polite">
          <Icon name="clock" size={15} />
          <span style={{ flex: 1 }}>{timeNotice}</span>
          <button type="button" className="exam-toast-close" onClick={() => setTimeNotice(null)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* ── Exam body ── */}
      <div className="exam-layout">

        {/* Main question panel */}
        <main className="main-panel">
          {zoomedOutPhone && !zoomNoticeClosed && (
            <div className="exam-notice info zoom">
              <Icon name="info" size={18} />
              <span style={{ flex: 1 }}>
                <strong>This page is showing its computer layout, so everything is tiny.</strong>{' '}
                On iPhone, tap <strong>aA</strong> in the address bar, set the zoom to 100% and choose
                {' '}<strong>Request Mobile Website</strong>. On Android, open the browser menu and untick
                {' '}<strong>Desktop site</strong>. Your answers are kept.
              </span>
              <button type="button" className="exam-notice-close" onClick={() => setZoomNoticeClosed(true)} aria-label="Dismiss">
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {!isOnline && (
            <div className="exam-notice warn" role="status">
              <Icon name="alert" size={16} />
              <span>
                <strong>You are offline.</strong> Keep answering — everything is saved on this
                device and is sent as soon as you are back online. Reconnect before you submit.
              </span>
            </div>
          )}

          <div className="q-meta">
            <span style={{ background: 'var(--navy)', color: 'white', borderRadius: 'var(--r-sm)', padding: '4px 12px', fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em', flexShrink: 0 }}>
              Q {currentQuestion}
            </span>
            <span style={{ color: 'var(--ink-4)', fontSize: 13, flexShrink: 0 }}>of {questions.length}</span>
            {isEssay && (
              <span style={{ background: '#EBF4FF', color: '#1565C0', padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
                Essay
              </span>
            )}
            {/* What the item is worth, and that it counts. "Show your working"
                was left over from the step-by-step pad and is no longer what
                the screen asks for — there is one answer field. */}
            {(worked || Number(currentQ?.marks) > 1) && (
              <span style={{
                background: worked ? '#EBF4FF' : 'var(--gold-100)',
                color: worked ? '#1565C0' : 'var(--gold-700)',
                padding: '3px 10px', borderRadius: 'var(--r-full)',
                fontSize: 11.5, fontWeight: 700, flexShrink: 0,
              }}>
                {currentQ.marks || 1} point{(currentQ.marks || 1) === 1 ? '' : 's'} · counts toward your score
              </span>
            )}
            {multiSelect && (
              <span style={{ background: '#EEF6EE', color: '#1B6E2F', padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
                Select all that apply
              </span>
            )}
            <button
              type="button"
              className={`q-bookmark${isFlagged ? ' on' : ''}`}
              onClick={() => toggleFlag(currentQ?.id)}
              aria-pressed={isFlagged}
              title={isFlagged ? 'Remove bookmark' : 'Bookmark for review'}
            >
              <Icon name="bookmark" size={14} />
              <span className="q-bookmark-label">{isFlagged ? 'Bookmarked' : 'Bookmark'}</span>
            </button>
          </div>

          <p className="q-text">
            {currentQ?.question_text}
          </p>

          {currentQ?.image_url && (
            <div
              className="q-figure"
              role="button"
              tabIndex={0}
              aria-label="Enlarge the figure"
              onClick={() => { setFigureFull(false); setFigureOpen(true); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFigureFull(false); setFigureOpen(true); } }}
            >
              <img src={currentQ.image_url} alt="Question figure" draggable={false} />
              <span className="q-figure-hint"><Icon name="search" size={12} /> Tap to enlarge</span>
            </div>
          )}

          {multiSelect && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '9px 13px', lineHeight: 1.5 }}>
              <strong>Tick every correct answer.</strong> All of them must be
              ticked, and nothing else, to earn the point for this question.
            </p>
          )}

          {worked ? (
            <Suspense fallback={<div style={{ padding: 20, fontSize: 13, color: 'var(--ink-4)' }}>Loading the maths editor…</div>}>
              <WorkedSolution
                question={currentQ}
                value={workAnswers[currentQ.id]}
                onChange={v => setWorkAnswers(prev => ({ ...prev, [currentQ.id]: v }))}
              />
            </Suspense>
          ) : isEssay ? (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-3)' }}>Type your answer in the box below.</p>
              {/* 16px and up: iOS zooms the whole page in on any field
                  smaller than that the moment it is tapped. */}
              <textarea
                value={essayAnswers[currentQ.id] || ''}
                onChange={e => setEssayAnswers(prev => ({ ...prev, [currentQ.id]: e.target.value }))}
                placeholder="Write your answer here…"
                rows={8}
                maxLength={8000}
                style={{
                  width: '100%', padding: '14px 16px', border: '2px solid', boxSizing: 'border-box',
                  borderColor: essayAnswers[currentQ.id]?.trim() ? 'var(--navy)' : 'var(--line)',
                  borderRadius: 'var(--r-md)', fontSize: 'calc(16px * var(--q-scale, 1))', lineHeight: 1.6,
                  resize: 'vertical', fontFamily: 'inherit', color: 'var(--ink-1)',
                  background: 'var(--white)', transition: 'border-color var(--t-fast)',
                  outline: 'none',
                }}
              />
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                {(essayAnswers[currentQ.id] || '').length} / 8,000
              </div>
            </div>
          ) : (
            <div className="choices" role={multiSelect ? 'group' : 'radiogroup'} aria-label="Choices">
              {/* A multi-answer item (sql/018) holds an ARRAY of indices and
                  ticks rather than picks, so a second click on the same choice
                  unticks it instead of doing nothing. A single-answer item
                  keeps holding one index. The letter is the position ON
                  SCREEN — it names what the student sees, and the stored
                  index underneath is what gets marked. */}
              {(currentQ?.choice_order || []).map((originalIndex, position) => {
                // The stored index, never the position on screen, so marking
                // is unaffected by the order the choices are shown in.
                const picked = multiSelect
                  ? isSelected(answers[currentQ?.id], originalIndex)
                  : answers[currentQ?.id] === originalIndex;
                const letter = position < 26 ? String.fromCharCode(65 + position) : String(position + 1);
                return (
                  <button
                    key={originalIndex}
                    type="button"
                    className={`choice-btn ${picked ? 'selected' : ''} ${multiSelect ? 'tickable' : ''}`}
                    role={multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={picked}
                    onClick={() => pickChoice(originalIndex)}
                  >
                    <span className="choice-key" aria-hidden="true">
                      {multiSelect && picked ? '✓' : letter}
                    </span>
                    <span className="choice-text">
                      {(currentQ.choice_list || [])[originalIndex]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* On a phone these are replaced by the bar pinned to the bottom of
              the screen, which is where a thumb already is. */}
          <div className="exam-inline-nav">
            <button
              className="btn ghost" style={{ flex: 1 }}
              onClick={() => goTo(currentQuestion - 1)}
              disabled={currentQuestion === 1}
            >
              <Icon name="arrow-left" size={15} /> Previous
            </button>
            {isLast ? (
              <button
                className="btn" style={{ flex: 1, background: 'linear-gradient(135deg, #27AE60, #1E8449)', border: 'none' }}
                onClick={openSubmit}
              >
                <Icon name="check-circle" size={15} /> Review &amp; Submit
              </button>
            ) : (
              <button className="btn" style={{ flex: 1 }} onClick={() => goTo(currentQuestion + 1)}>
                Next <Icon name="arrow-right" size={15} />
              </button>
            )}
          </div>
          <p className="exam-keys-hint">
            Tip: <kbd>←</kbd> <kbd>→</kbd> move between questions · press the letter beside a choice to pick it
          </p>
        </main>

        {/* The question list. Beside the paper on a wide screen; on a phone a
            sheet that slides up from the bottom bar, so the question itself
            gets the whole screen. */}
        <div className="sheet-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
        <aside className="side-panel" aria-label="Question navigator">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="side-head">
            <div className="eyebrow" style={{ fontSize: 10 }}>Navigator</div>
            <span className="side-count">{totalAnswered}/{questions.length}</span>
            <button type="button" className="sheet-close" onClick={() => setNavOpen(false)} aria-label="Close the question list">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="nav-legend" aria-hidden="true">
            <span><i className="lg-answered" />Answered</span>
            <span><i className="lg-current" />Current</span>
            <span><i className="lg-open" />Not answered</span>
            <span><i className="lg-flagged" />Bookmarked</span>
          </div>

          <div className="grid-container">
            {questions.map((q, i) => {
              const isAnswered = isItemAnswered(q, answeredMaps);
              const flagged = !!flaggedQuestions[q.id];
              const isCurrent = currentQuestion === i + 1;
              return (
                <div
                  key={q.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Question ${i + 1}, ${isAnswered ? 'answered' : 'not answered'}${flagged ? ', bookmarked' : ''}`}
                  onClick={() => goTo(i + 1)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i + 1); } }}
                  className={`grid-item ${isCurrent ? 'active' : ''} ${isAnswered ? 'answered' : ''}`}
                >
                  {i + 1}
                  {flagged && <span className="grid-flag" />}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
              <span>Answered</span>
              <span style={{ fontWeight: 700, color: allAnswered ? 'var(--ok)' : 'var(--navy)' }}>
                {totalAnswered} / {questions.length}
              </span>
            </div>
            <div style={{ background: 'var(--line)', borderRadius: 'var(--r-full)', height: 5, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 'var(--r-full)',
                background: allAnswered ? 'var(--ok)' : 'var(--gold)',
                width: `${questions.length > 0 ? (totalAnswered / questions.length) * 100 : 0}%`,
                transition: 'width var(--t)',
              }} />
            </div>
            {unansweredNos.length > 0 && (
              <button type="button" className="jump-btn unanswered" onClick={() => goTo(nextOf(unansweredNos))}>
                <Icon name="circle" size={12} />
                {unansweredNos.length} unanswered — go to next
                <Icon name="chevron-right" size={12} style={{ marginLeft: 'auto' }} />
              </button>
            )}
            {flaggedNos.length > 0 && (
              <button type="button" className="jump-btn flagged" onClick={() => goTo(nextOf(flaggedNos))}>
                <Icon name="bookmark" size={12} color="#E67E22" />
                {flaggedNos.length} bookmarked — go to next
                <Icon name="chevron-right" size={12} style={{ marginLeft: 'auto' }} />
              </button>
            )}
          </div>

          <div className="text-size">
            <span>Text size</span>
            <div className="text-size-btns" role="group" aria-label="Text size">
              {TEXT_SCALES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={i === textSize ? 'on' : ''}
                  aria-pressed={i === textSize}
                  aria-label={['Normal', 'Large', 'Largest'][i]}
                  onClick={() => setTextSize(i)}
                  style={{ fontSize: 12 + i * 3 }}
                >
                  A
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn"
            style={{ marginTop: 14, width: '100%', background: 'linear-gradient(135deg, #27AE60, #1E8449)', border: 'none', boxShadow: 'var(--s-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={openSubmit}
          >
            <Icon name="check-circle" size={16} />
            Submit Final Exam
          </button>
        </aside>
      </div>

      <p style={{ textAlign: 'center', margin: '6px 0 10px', fontSize: 10, color: 'rgba(0,0,0,.15)', letterSpacing: '.18em', fontWeight: 700 }}>
        KMR · PATTS COLLEGE OF AERONAUTICS
      </p>

      {/* ── Phone: previous / question list / next, under the thumb ── */}
      <nav className="exam-bottom-bar" aria-label="Question navigation">
        <button type="button" className="bb-btn bb-prev" onClick={() => goTo(currentQuestion - 1)}
          disabled={currentQuestion === 1} aria-label="Previous question">
          <Icon name="arrow-left" size={18} />
        </button>
        <button type="button" className="bb-btn bb-list" onClick={() => setNavOpen(true)}
          aria-label={`Question ${currentQuestion} of ${questions.length}. Open the question list`}>
          <Icon name="grid" size={17} />
          <span className="bb-list-text">
            <strong>Q{currentQuestion} of {questions.length}</strong>
            <small>
              {totalAnswered} answered{flaggedNos.length > 0 ? ` · ${flaggedNos.length} bookmarked` : ''}
            </small>
          </span>
        </button>
        {isLast ? (
          <button type="button" className="bb-btn bb-next bb-finish" onClick={openSubmit}>
            Finish <Icon name="check" size={16} />
          </button>
        ) : (
          <button type="button" className="bb-btn bb-next" onClick={() => goTo(currentQuestion + 1)}>
            Next <Icon name="arrow-right" size={16} />
          </button>
        )}
      </nav>

      {/* ── A figure, as big as the screen allows ── */}
      {figureOpen && currentQ?.image_url && (
        <div className={`figure-viewer${figureFull ? ' full' : ''}`} role="dialog" aria-modal="true" aria-label="Question figure">
          <div className="figure-viewer-bar">
            <button type="button" onClick={() => setFigureFull(f => !f)}>
              {figureFull ? 'Fit to screen' : 'Actual size'}
            </button>
            <button type="button" onClick={() => setFigureOpen(false)}>
              <Icon name="x" size={15} /> Close
            </button>
          </div>
          <div className="figure-viewer-body" onClick={e => { if (e.target === e.currentTarget) setFigureOpen(false); }}>
            <img src={currentQ.image_url} alt="Question figure" draggable={false} />
          </div>
        </div>
      )}
    </div>
  );
}
