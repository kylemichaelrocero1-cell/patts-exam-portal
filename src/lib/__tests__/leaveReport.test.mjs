// A proctoring flag says what happened, on which device, for how long — and
// is sent the moment it happens.
//
//   npm run test:leave-report

import { deviceOf, leaveText, formatAway, withAway, pushViolationsNow, PAUSE_MS } from '../leaveReport.js';
import { parseViolation } from '../proctoring.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== which device ===');
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/466.0.0.39.106;FBBV/602411734]',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidMessenger: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/466.0.0.43.109;]',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.43.109;]',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
for (const [ua, touch, label, kind] of [
  [UA.iphoneSafari, 5, 'iPhone · Safari', 'phone'], [UA.iphoneChrome, 5, 'iPhone · Chrome', 'phone'],
  [UA.iphoneMessenger, 5, 'iPhone · Messenger in-app browser', 'phone'],
  [UA.ipadDesktop, 5, 'iPad · Safari', 'tablet'],
  [UA.androidChrome, 5, 'Android · Chrome', 'phone'], [UA.androidSamsung, 5, 'Android · Samsung Internet', 'phone'],
  [UA.androidMessenger, 5, 'Android · Messenger in-app browser', 'phone'], [UA.androidFacebook, 5, 'Android · Facebook in-app browser', 'phone'],
  [UA.androidTablet, 5, 'Android · Chrome', 'tablet'],
  [UA.windowsEdge, 0, 'Windows · Edge', 'computer'], [UA.windowsChrome, 0, 'Windows · Chrome', 'computer'],
  [UA.macSafari, 0, 'Mac · Safari', 'computer'], [UA.macFirefox, 0, 'Mac · Firefox', 'computer'],
  [UA.chromebook, 0, 'Chromebook · Chrome', 'computer'],
]) {
  const d = deviceOf({ userAgent: ua, maxTouchPoints: touch });
  check(`${label} (${kind})`, d.label === label && d.kind === kind, `${d.label} (${d.kind})`);
}
check('nothing known: still a label', deviceOf().label === 'device · browser' && deviceOf().kind === 'computer');

console.log('\n=== what it says, by device ===');
const phone = deviceOf({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 });
const laptop = deviceOf({ userAgent: UA.windowsChrome });
const ipad = deviceOf({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 });
check('phone, hidden: home screen, app, tab or lock — and the device',
  leaveText('hidden', phone) === 'Left the exam page — home screen, another app, another tab or the screen locked (iPhone · Safari)', leaveText('hidden', phone));
check('laptop, hidden: tab or minimised', leaveText('hidden', laptop) === 'Switched to another tab or minimised the browser (Windows · Chrome)');
check('phone, blur: a window over the exam (chat bubble)', /chat bubble/.test(leaveText('blur', phone)));
check('iPad counts as a phone here', leaveText('blur', ipad).startsWith('A window opened over the exam'));
check('laptop, blur: clicked away', leaveText('blur', laptop).startsWith('Clicked away from the browser'));
check('paused, by device', /screen locked, or the phone/.test(leaveText('paused', phone)) && /computer slept/.test(leaveText('paused', laptop)));
check('the heartbeat waits well past a slow load', PAUSE_MS >= 5000);

console.log('\n=== how long ===');
check('seconds', formatAway(48_400) === '48 s');
check('minutes', formatAway(185_000) === '3 min 5 s' && formatAway(120_000) === '2 min');
check('hours', formatAway(3_725_000) === '1 h 2 min');
{
  const e = '[10:42:07 AM] Left the exam page — home screen, another app, another tab or the screen locked (iPhone · Safari)';
  const a = withAway(e, 48_000);
  check('added once', a === `${e} — away 48 s` && withAway(a, 99_000) === a);
  check('with a note', withAway(e, 61_000, 'the page was reloaded on return').endsWith('— away 1 min 1 s (the page was reloaded on return)'));
  check('under a second: left alone', withAway(e, 400) === e && withAway(e, NaN) === e);
}

console.log('\n=== the dashboard reads them ===');
const lbl = t => parseViolation(`[10:42:07 AM] ${t}`).label;
check('phone hidden → Left the page', lbl(withAway(leaveText('hidden', phone), 48_000)) === 'Left the page');
check('laptop hidden → Tab switch', lbl(leaveText('hidden', laptop)) === 'Tab switch');
check('phone blur → Lost focus', lbl(leaveText('blur', phone)) === 'Lost focus');
check('laptop blur → Lost focus (not tab switch, though it says "another app")', lbl(leaveText('blur', laptop)) === 'Lost focus');
check('paused → Browser paused', lbl(leaveText('paused', phone)) === 'Browser paused' && lbl(leaveText('paused', laptop)) === 'Browser paused');
check('a reloaded page is still a leave, not a refresh', lbl(withAway(leaveText('hidden', phone), 61_000, 'the page was reloaded on return')) === 'Left the page');
check('older wording keeps its labels', lbl('Tab hidden or switched to another app') === 'Tab switch'
  && lbl('Screen lost focus (Split-screen or notifications opened)') === 'Lost focus' && lbl('Page refreshed') === 'Page refresh');

console.log('\n=== sent at once ===');
{
  const calls = [];
  const fetchFn = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
  const ok = pushViolationsNow({ url: 'https://x.test', key: 'anon', sessionId: 'abc-1', count: 3, logs: ['a', 'b', 'c'], fetchFn });
  const c = calls[0];
  check('one PATCH to the live session', ok && calls.length === 1 && c.url === 'https://x.test/rest/v1/live_sessions?id=eq.abc-1' && c.opts.method === 'PATCH');
  check('keepalive, so it finishes while the page freezes', c.opts.keepalive === true);
  check('the count and the log', JSON.parse(c.opts.body).violation_count === 3 && JSON.parse(c.opts.body).violation_log.length === 3);
  check('as the anon key, minimal reply', c.opts.headers.apikey === 'anon' && c.opts.headers.Authorization === 'Bearer anon' && c.opts.headers.Prefer === 'return=minimal');
  check('no session yet: nothing sent', !pushViolationsNow({ url: 'u', key: 'k', sessionId: null, count: 1, logs: [], fetchFn }) && calls.length === 1);
  check('a fetch that throws does not', pushViolationsNow({ url: 'u', key: 'k', sessionId: 's', count: 1, logs: [], fetchFn: () => { throw new Error('x'); } }) === false);
  check('a fetch that rejects is caught', pushViolationsNow({ url: 'u', key: 'k', sessionId: 's', count: 1, logs: [], fetchFn: () => Promise.reject(new Error('offline')) }) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
