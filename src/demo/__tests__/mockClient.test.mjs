// Exercises the mock client through the same call shapes the app uses, so the
// demo cannot ship with a silently broken data layer. Node-only.
//   npm run test:demo
import { mockSupabase as sb, resetDemoData } from '../mockClient.js';

let pass=0, fail=0;
const ck=(n,ok,d='')=>{ok?(pass++,console.log(`  PASS  ${n}`)):(fail++,console.log(`  FAIL  ${n}${d?' — '+d:''}`));};

console.log('=== STUDENT LOGIN LOOKUP ===');
{
  const { data } = await sb.from('users')
    .select('id, full_name, section, student_email, student_code, session_token')
    .eq('student_email','juan.delacruz@demo.local').eq('student_code','2026-1-0001');
  ck('demo student found', data.length===1 && data[0].full_name==='Juan Dela Cruz');
  ck('select() narrows columns like PostgREST', data[0] && !('created_at' in data[0]));
}
{
  const { data } = await sb.from('users').select('id').eq('student_email','nobody@x').eq('student_code','0');
  ck('wrong credentials return no rows', data.length===0);
}

console.log('\n=== ASSESSMENT LIST ===');
{
  const { data } = await sb.from('assessments')
    .select('id, kind, title, target_section, is_open, opens_at, closes_at, duration_minutes, has_password, created_at')
    .eq('is_open', true).order('created_at',{ascending:false});
  ck('three assessments returned', data.length===3, String(data.length));
  ck('sorted newest first', new Date(data[0].created_at) >= new Date(data[2].created_at));
  ck('one seatwork scheduled for later', data.some(a=>a.opens_at && new Date(a.opens_at) > new Date()));
  ck('both kinds present', new Set(data.map(a=>a.kind)).size===2);
}

console.log('\n=== QUESTIONS ===');
{
  const { data } = await sb.from('questions').select('*').eq('exam_id','asm-demo-exam').order('id',{ascending:true});
  ck('exam has 6 questions', data.length===6, String(data.length));
  ck('all have 4 choices and a valid key',
     data.every(q=>q.choice_a&&q.choice_b&&q.choice_c&&q.choice_d&&q.correct_answer>=0&&q.correct_answer<=3));
}

console.log('\n=== SUBMIT A RESULT ===');
{
  const before = (await sb.from('results').select('id')).data.length;
  await sb.from('results').insert([{ student_id:'stu-demo-0001', exam_id:'asm-demo-quiz', assessment_id:'asm-demo-quiz', score:4, total_items:5, answers_json:{}, submitted_at:new Date().toISOString() }]);
  const after = (await sb.from('results').select('id')).data.length;
  ck('insert persists within the session', after===before+1);
  const { data } = await sb.from('results').select('score').eq('student_id','stu-demo-0001');
  ck('readable back', data.length===1 && data[0].score===4);
}

console.log('\n=== LESSONS ===');
{
  const { data } = await sb.from('lessons').select('id, title, content_md, is_published').eq('is_published',true);
  ck('three published lessons', data.length===3, String(data.length));
  ck('bodies carry markdown', data.every(l=>l.content_md.length>100));
  ck('one uses KaTeX math', data.some(l=>l.content_md.includes('$$')));
  ck('one uses a GFM table', data.some(l=>l.content_md.includes('|---')));
}

console.log('\n=== LESSON PROGRESS (upsert) ===');
{
  const row = { student_id:'stu-demo-0001', lesson_id:'les-demo-1', viewed_at:new Date().toISOString() };
  await sb.from('lesson_progress').upsert([row], { onConflict:'student_id,lesson_id' });
  await sb.from('lesson_progress').upsert([{...row, completed_at:new Date().toISOString()}], { onConflict:'student_id,lesson_id' });
  const { data } = await sb.from('lesson_progress').select('*').eq('student_id','stu-demo-0001');
  ck('upsert updates rather than duplicating', data.length===1, String(data.length));
  ck('completion recorded', !!data[0].completed_at);
}

console.log('\n=== INSTRUCTOR AUTH ===');
{
  ck('no session before signing in', (await sb.auth.getSession()).data.session===null);
  await sb.auth.signInWithPassword({ email:'anything@demo.local', password:'x' });
  const { data:{ session } } = await sb.auth.getSession();
  ck('any credentials sign in as demo instructor', !!session?.user?.id);
  await sb.auth.signOut();
  ck('sign out clears it', (await sb.auth.getSession()).data.session===null);
}

console.log('\n=== SAFETY RAILS ===');
{
  let threw=false;
  try { sb.from('definitely_not_a_table'); } catch { threw=true; }
  ck('unknown table throws instead of returning empty', threw);
  const { data } = await sb.rpc('verify_exam_password', { p_exam_id:'x', p_password:'y' });
  ck('password RPC resolves', data===true);
  const ch = sb.channel('x'); ch.on('a','b',()=>{}); ch.subscribe(); sb.removeChannel(ch);
  ck('realtime no-ops without throwing', true);
}

console.log('\n=== RESET ===');
{
  resetDemoData();
  const { data } = await sb.from('results').select('id').eq('student_id','stu-demo-0001');
  ck('reload returns a clean portal', data.length===0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
