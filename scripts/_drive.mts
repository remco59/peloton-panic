import WebSocket from 'ws';
const BASE = 'http://localhost:3000';
const target = process.argv[2] ?? 'team';
const tutorial = process.argv[3] === 'tutorial';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function open(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
  return new Promise((r) => ws.once('open', () => r(ws)));
}
const tv = await open();
let code = '';
tv.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'tv:state' && !code) code = m.code;
});
tv.send(JSON.stringify({ t: 'tv:create', origin: BASE }));
while (!code) await sleep(50);
const p = await open();
let token = '';
let st: any = null;
let me: any = null;
let teamId = '';
let stopped = false;
let lastKey = '';
p.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'joined') { token = m.token; teamId = m.teamId; }
  if (m.t === 'player:state') { st = m.state; me = m.me; react(); }
});
const send = (o: unknown) => p.send(JSON.stringify(o));
send({ t: 'player:join', code, name: 'Remco' });
while (!token) await sleep(50);
if (tutorial) send({ t: 'president', what: 'tutorialOn' });
send({ t: 'president', what: 'addBot' });
send({ t: 'president', what: 'addBot' });
await sleep(300);
function react() {
  if (stopped || !st) return;
  const ph = st.phase;
  if (ph === target || (target==='lobby' && ph==='lobby')) { if (!stopped) { stopped = true; console.log('REACHED', ph, `${BASE}/play?room=${code}&token=${token}&name=Remco`); } return; }
  const key = ph + st.round + st.stage;
  if (key === lastKey) return;
  lastKey = key;
  const team = st.teams.find((t: any) => t.id === teamId);
  if (ph === 'draft' && me?.pickPending) setTimeout(() => send({ t: 'act', action: { type: 'draftPick', source: { kind: 'deck' } } }), 200);
  if (ph === 'team') setTimeout(() => send({ t: 'act', action: { type: 'ready' } }), 500);
  if (ph === 'race') {
    const efforts: any = {};
    st.riders.filter((r: any) => r.teamId === teamId).forEach((r: any) => (efforts[r.id] = 'normaal'));
    setTimeout(() => send({ t: 'act', action: { type: 'effort', efforts } }), 300);
  }
  if (ph === 'results') setTimeout(() => send({ t: 'president', what: 'nextStage' }), 1500);
}
if (target !== 'lobby') send({ t: 'president', what: 'start' });
await sleep(10 * 60 * 1000);
process.exit(0);
