import { buildDemoTables, demoInstructor } from './demoData.js';

// A stand-in for the Supabase client, used only in the demo build.
//
// The point is that the demo bundle contains no project URL, no API key, and
// makes no network call — so it can be public and cannot touch real student
// data even by accident. Everything lives in memory and resets on reload.
//
// It implements only the surface this app actually uses (see the grep in the
// commit message). Anything unimplemented throws loudly rather than silently
// returning empty, so a gap shows up immediately instead of looking like "no
// data".

const LATENCY_MS = 120;   // enough that loading states are visible, not annoying
const delay = (v) => new Promise(res => setTimeout(() => res(v), LATENCY_MS));

let tables = buildDemoTables();
export const resetDemoData = () => { tables = buildDemoTables(); };

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

function matches(row, filters) {
  return filters.every(f => {
    const v = row[f.col];
    switch (f.op) {
      case 'eq':    return String(v) === String(f.val);
      case 'neq':   return String(v) !== String(f.val);
      case 'in':    return f.val.map(String).includes(String(v));
      case 'is':    return f.val === null ? (v === null || v === undefined) : v === f.val;
      case 'not.is':return !(v === null || v === undefined);
      case 'ilike': return new RegExp('^' + String(f.val).replace(/%/g, '.*') + '$', 'i').test(String(v ?? ''));
      case 'match': return Object.entries(f.val).every(([k, x]) => String(row[k]) === String(x));
      default:      return true;
    }
  });
}

// `select('a, b')` should narrow the returned columns, the way PostgREST does —
// otherwise the demo would hand back fields the real API withholds.
function project(row, cols) {
  if (!cols || cols === '*' || cols.includes('(')) return { ...row };
  const keep = cols.split(',').map(c => c.trim()).filter(Boolean);
  const out = {};
  keep.forEach(k => { out[k] = row[k]; });
  return out;
}

function makeBuilder(table) {
  const state = { filters: [], cols: '*', order: null, range: null, limit: null, single: false };
  let action = { type: 'select' };

  const run = () => {
    const rows = tables[table] || [];

    if (action.type === 'insert') {
      const added = action.rows.map(r => ({ id: uid(table.slice(0, 3)), created_at: new Date().toISOString(), ...r }));
      tables[table] = [...rows, ...added];
      return { data: state.single ? added[0] : added, error: null };
    }

    if (action.type === 'upsert') {
      const conflict = (action.opts?.onConflict || 'id').split(',').map(s => s.trim());
      const out = [];
      action.rows.forEach(r => {
        const i = (tables[table] || []).findIndex(x => conflict.every(k => String(x[k]) === String(r[k])));
        if (i >= 0) { tables[table][i] = { ...tables[table][i], ...r }; out.push(tables[table][i]); }
        else { const n = { id: uid(table.slice(0, 3)), created_at: new Date().toISOString(), ...r }; tables[table].push(n); out.push(n); }
      });
      return { data: out, error: null };
    }

    if (action.type === 'update') {
      const hit = [];
      tables[table] = rows.map(r => {
        if (!matches(r, state.filters)) return r;
        const n = { ...r, ...action.values };
        hit.push(n);
        return n;
      });
      return { data: state.single ? (hit[0] ?? null) : hit, error: null };
    }

    if (action.type === 'delete') {
      const kept = rows.filter(r => !matches(r, state.filters));
      const removed = rows.filter(r => matches(r, state.filters));
      tables[table] = kept;
      return { data: removed, error: null };
    }

    // select
    let out = rows.filter(r => matches(r, state.filters));
    if (state.order) {
      const { col, asc } = state.order;
      out = [...out].sort((a, b) => {
        const x = a[col], y = b[col];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (state.range) out = out.slice(state.range.from, state.range.to + 1);
    if (state.limit !== null) out = out.slice(0, state.limit);
    out = out.map(r => project(r, state.cols));
    if (state.single) return { data: out[0] ?? null, error: out.length ? null : { message: 'No rows found', code: 'PGRST116' } };
    return { data: out, error: null, count: out.length };
  };

  const b = {
    select(cols = '*') { state.cols = cols; return b; },
    insert(rows) { action = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return b; },
    upsert(rows, opts) { action = { type: 'upsert', rows: Array.isArray(rows) ? rows : [rows], opts }; return b; },
    update(values) { action = { type: 'update', values }; return b; },
    delete() { action = { type: 'delete' }; return b; },

    eq(col, val) { state.filters.push({ col, op: 'eq', val }); return b; },
    neq(col, val) { state.filters.push({ col, op: 'neq', val }); return b; },
    in(col, val) { state.filters.push({ col, op: 'in', val }); return b; },
    is(col, val) { state.filters.push({ col, op: 'is', val }); return b; },
    ilike(col, val) { state.filters.push({ col, op: 'ilike', val }); return b; },
    match(obj) { state.filters.push({ col: '_', op: 'match', val: obj }); return b; },
    or() { return b; },   // only used for an instructor-sharing query the demo does not exercise

    order(col, opts = {}) { state.order = { col, asc: opts.ascending !== false }; return b; },
    range(from, to) { state.range = { from, to }; return b; },
    limit(n) { state.limit = n; return b; },
    single() { state.single = true; return b; },
    maybeSingle() { state.single = true; return b; },

    then(onOk, onErr) { return delay(run()).then(onOk, onErr); },
    catch(fn) { return delay(run()).catch(fn); },
    finally(fn) { return delay(run()).finally(fn); },
  };
  return b;
}

// A demo instructor session, so the dashboard can be shown too.
let session = null;

export const mockSupabase = {
  from(table) {
    if (!(table in tables)) {
      throw new Error(`[demo] unknown table "${table}" — add it to demoData.js`);
    }
    return makeBuilder(table);
  },

  rpc(fn, args) {
    // The only RPC students can reach is the exam password check; every demo
    // assessment is open, so this simply succeeds.
    if (fn === 'verify_exam_password') return delay({ data: true, error: null });
    return delay({ data: null, error: { message: `[demo] rpc ${fn} not implemented` } });
  },

  auth: {
    getSession: () => delay({ data: { session }, error: null }),
    getUser: () => delay({ data: { user: session?.user ?? null }, error: null }),
    signInWithPassword: ({ email }) => {
      session = { user: { id: demoInstructor.id, email, user_metadata: { full_name: demoInstructor.full_name } } };
      return delay({ data: { user: session.user, session }, error: null });
    },
    signOut: () => { session = null; return delay({ error: null }); },
    updateUser: () => delay({ data: { user: session?.user ?? null }, error: null }),
  },

  // Realtime is a no-op: nothing else is writing to this in-memory database.
  channel() {
    const ch = { on: () => ch, subscribe: () => ch };
    return ch;
  },
  removeChannel() {},

  storage: {
    from() {
      return {
        upload: () => delay({ data: null, error: { message: '[demo] uploads are disabled' } }),
        getPublicUrl: (p) => ({ data: { publicUrl: p } }),
        remove: () => delay({ data: null, error: null }),
      };
    },
  },
};
