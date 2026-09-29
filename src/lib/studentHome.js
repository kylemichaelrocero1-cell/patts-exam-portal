import { supabase } from '../supabase';
import { selectAssessments } from './assessments';
import { makeHomeReads } from './studentHomeCore';

// Thin wiring layer: the logic lives in studentHomeCore.js so it can be
// unit-tested in Node. One copy per page load, shared by every home tab.
export const homeReads = makeHomeReads({
  from: (table) => supabase.from(table),
  selectOpenAssessments: () =>
    selectAssessments(q => q.eq('is_open', true).order('created_at', { ascending: false })),
});

// Called when a student leaves a paper and when anyone logs out.
export const forgetStudentHome = () => homeReads.forget();
