import { createClient } from '@supabase/supabase-js';
import { mockSupabase } from './demo/mockClient';

// VITE_DEMO_MODE is set only by the demo build (see .env.demo). Vite inlines it
// at build time, so a demo bundle never contains a project URL or key and makes
// no network request — it cannot reach real student data even if someone tries.
export const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail loudly rather than shipping a production build that quietly talks to
// nothing — an empty portal is far harder to diagnose than a thrown error.
if (!IS_DEMO && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. For the student demo build, set VITE_DEMO_MODE=true instead.');
}

export const supabase = IS_DEMO ? mockSupabase : createClient(supabaseUrl, supabaseAnonKey);
