import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../worker/index.js';

// The Worker runtime supplies Web Crypto. Keep local Node test runs equivalent.
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const ORIGIN = 'https://organizing.example';
let fixtureNumber = 0;

function harness(t, { writeStatus = 200, readStatus = 200 } = {}) {
  const number = ++fixtureNumber;
  const config = {
    apiKey: 'test-api-key',
    projectId: 'test-project',
    uid: `test-owner-${number}`,
    refreshToken: 'test-private-refresh-token'
  };
  const client = {
    clientName: 'Casey Example',
    referralCode: 'Casey4821',
    phoneDigits: '5550004821',
    lookupEnabled: true
  };
  const env = {
    OAB_REFERRAL_CODES: JSON.stringify([client, {
      clientName: 'Disabled Example', referralCode: 'Disabled1111', phoneDigits: '5550001111', lookupEnabled: false
    }]),
    OAB_CRM_CONFIG: JSON.stringify(config)
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const call = { url: parsed, method, options };
    calls.push(call);
    if (parsed.hostname === 'securetoken.googleapis.com') {
      assert.equal(method, 'POST');
      assert.equal(parsed.searchParams.get('key'), config.apiKey);
      assert.equal(new URLSearchParams(options.body).get('refresh_token'), config.refreshToken);
      return Response.json({ id_token: 'test-private-id-token', user_id: config.uid, expires_in: '3600' });
    }
    assert.equal(parsed.hostname, 'firestore.googleapis.com', 'No external services should be called except the mocked tracker');
    if (method === 'POST') {
      call.body = JSON.parse(options.body);
      return Response.json(writeStatus === 200 ? { name: 'test-created-lead' } : { error: { message: 'Synthetic tracker error' } }, { status: writeStatus });
    }
    assert.equal(method, 'GET');
    return Response.json(readStatus === 200 ? { name: parsed.pathname, fields: {} } : { error: { message: 'Synthetic missing lead' } }, { status: readStatus });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const send = async (body, { origin = ORIGIN, path = '/api/referrals', method = 'POST', contentType = 'application/json', ip = `192.0.2.${number}` } = {}) => {
    const headers = { Origin: origin, 'Content-Type': contentType, 'CF-Connecting-IP': ip };
    const request = new Request(ORIGIN + path, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) })
    });
    const response = await worker.fetch(request, env);
    const result = await response.json();
    return { response, result };
  };
  return {
    env, config, client, calls, send,
    writes: () => calls.filter(call => call.url.hostname === 'firestore.googleapis.com' && call.method === 'POST'),
    reads: () => calls.filter(call => call.url.hostname === 'firestore.googleapis.com' && call.method === 'GET')
  };
}

const validClaim = overrides => ({ referralCode: 'Casey4821', firstName: 'Taylor', lastName: 'Visitor', phone: '(214) 555-0199', ...overrides });
const stringField = (write, name) => write.body.fields[name]?.stringValue;

function assertNoDirectoryOrSecrets(result, h) {
  const output = JSON.stringify(result);
  for (const privateValue of [h.client.clientName, h.client.phoneDigits, 'Disabled Example', h.config.apiKey, h.config.refreshToken, 'test-private-id-token', h.config.uid]) {
    assert.ok(!output.includes(privateValue), `Response must not reveal ${privateValue}`);
  }
  assert.equal(Object.hasOwn(result, 'clients'), false);
  assert.equal(Object.hasOwn(result, 'directory'), false);
}

test('a valid claim is written to the tracker with names, phone, referral source, and attribution', async t => {
  const h = harness(t);
  const { response, result } = await h.send(validClaim());
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.match(result.leadId, /^oab_birthday_[a-f0-9]{32}$/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.writes().length, 1);
  const write = h.writes()[0];
  assert.equal(stringField(write, 'firstName'), 'Taylor');
  assert.equal(stringField(write, 'lastName'), 'Visitor');
  assert.equal(stringField(write, 'name'), 'Taylor Visitor');
  assert.equal(stringField(write, 'phone'), '2145550199');
  assert.equal(stringField(write, 'source'), 'Referral');
  assert.equal(stringField(write, 'referralCode'), h.client.referralCode);
  assert.equal(stringField(write, 'referredBy'), h.client.clientName);
  assert.equal(stringField(write, 'landingPageVariant'), 'referral-b');
  assert.equal(stringField(write, 'requestedService'), 'Free in-person consultation');
  assert.equal(write.body.fields.consultationCompleted.booleanValue, false);
  assert.equal(stringField(write, 'stage'), 'Not Contacted Yet');
  const notes = stringField(write, 'notes');
  assert.ok(notes.includes(`Referral code: ${h.client.referralCode}`));
  assert.ok(notes.includes(`Referred by: ${h.client.clientName}`));
  assert.ok(notes.includes('First name: Taylor'));
  assert.ok(notes.includes('Last name: Visitor'));
  assert.ok(notes.includes('Phone: 2145550199'));
  assert.ok(notes.includes('completed consultations, not form claims'));
  assert.ok(notes.includes('December 31, 2026'));
  assert.ok(notes.includes('no cash value'));
  assert.equal(write.options.headers.Authorization, 'Bearer test-private-id-token');
  assertNoDirectoryOrSecrets(result, h);
});

test('an invalid or disabled referral code is rejected before any tracker calls', async t => {
  const h = harness(t);
  for (const referralCode of ['Unknown9999', 'Disabled1111', '']) {
    const { response, result } = await h.send(validClaim({ referralCode }));
    assert.equal(response.status, 400);
    assert.equal(result.field, 'referralCode');
    assert.equal(result.ok, false);
    assertNoDirectoryOrSecrets(result, h);
  }
  assert.equal(h.calls.length, 0);
});

test('missing first or last names and invalid phone numbers are not stored', async t => {
  const h = harness(t);
  const cases = [
    [{ firstName: '' }, 'firstName'],
    [{ firstName: '   ' }, 'firstName'],
    [{ lastName: '' }, 'lastName'],
    [{ firstName: '<script>' }, 'firstName'],
    [{ phone: '' }, 'phone'],
    [{ phone: '555-0199' }, 'phone'],
    [{ phone: '2145550199 ext A' }, 'phone'],
    [{ phone: '1234567890123456' }, 'phone']
  ];
  for (const [overrides, field] of cases) {
    const { response, result } = await h.send(validClaim(overrides));
    assert.equal(response.status, 400, `Reject invalid ${field}`);
    assert.equal(result.field, field);
    assert.equal(result.ok, false);
  }
  assert.equal(h.calls.length, 0);
});

test('cross-origin submissions and missing Origin are rejected without a tracker write', async t => {
  const h = harness(t);
  for (const origin of ['https://unrelated.example', 'null', '']) {
    const { response, result } = await h.send(validClaim(), { origin });
    assert.equal(response.status, 403);
    assert.equal(result.error, 'origin_not_allowed');
    assert.equal(result.ok, false);
    assertNoDirectoryOrSecrets(result, h);
  }
  assert.equal(h.calls.length, 0);
});

test('a past client cannot submit themself as their own referred friend', async t => {
  const h = harness(t);
  const { response, result } = await h.send(validClaim({ phone: '+1 (555) 000-4821' }));
  assert.equal(response.status, 400);
  assert.equal(result.field, 'referralCode');
  assert.equal(h.calls.length, 0);
});

test('code lookup returns only the issued code and no private client directory', async t => {
  const h = harness(t);
  const { response, result } = await h.send({ referralCode: ' casey 4821 ', name: 'Casey' }, { path: '/api/referral-code' });
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, referralCode: 'Casey4821' });
  assertNoDirectoryOrSecrets(result, h);
  assert.equal(h.calls.length, 0);
});

test('tracker write failure returns 503 instead of showing a saved lead', async t => {
  const h = harness(t, { writeStatus: 503 });
  const { response, result } = await h.send(validClaim());
  assert.equal(response.status, 503);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'tracker_unavailable');
  assert.equal(Object.hasOwn(result, 'leadId'), false);
  assert.equal(h.writes().length, 1);
  assert.equal(h.reads().length, 0);
  assertNoDirectoryOrSecrets(result, h);
});

test('a conflicting write is a duplicate success only after confirming the existing tracker record', async t => {
  const h = harness(t, { writeStatus: 409, readStatus: 200 });
  const { response, result } = await h.send(validClaim());
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(h.writes().length, 1);
  assert.equal(h.reads().length, 1);
  assert.equal(h.reads()[0].url.pathname.split('/').at(-1), result.leadId);
  assert.equal(h.writes()[0].url.searchParams.get('documentId'), result.leadId);
  assertNoDirectoryOrSecrets(result, h);
});

test('an unconfirmed conflicting write remains a failure', async t => {
  const h = harness(t, { writeStatus: 409, readStatus: 404 });
  const { response, result } = await h.send(validClaim());
  assert.equal(response.status, 503);
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, 'duplicate'), false);
  assert.equal(h.reads().length, 1);
});

test('US phone formatting and country prefix normalize to the same tracker document ID', async t => {
  const h = harness(t);
  const results = [];
  for (const phone of ['2145550199', '(214) 555-0199', '+1 214 555 0199', '1-214-555-0199']) {
    const { response, result } = await h.send(validClaim({ phone }));
    assert.equal(response.status, 200);
    results.push(result.leadId);
  }
  assert.equal(new Set(results).size, 1);
  assert.equal(new Set(h.writes().map(write => write.url.searchParams.get('documentId'))).size, 1);
  assert.ok(h.writes().every(write => stringField(write, 'phone') === '2145550199'));
});

test('malformed body and unsupported method are rejected before any tracker call', async t => {
  const h = harness(t);
  const nonJson = await h.send(validClaim(), { contentType: 'text/plain' });
  assert.equal(nonJson.response.status, 400);
  assert.equal(nonJson.result.ok, false);
  const get = await h.send(null, { method: 'GET' });
  assert.equal(get.response.status, 405);
  assert.equal(get.result.ok, false);
  assert.equal(h.calls.length, 0);
});

test('repeated code guessing is rate limited without exposing the directory', async t => {
  const h = harness(t);
  for (let attempt = 0; attempt < 20; attempt++) {
    const { response } = await h.send(validClaim({ referralCode: `Wrong${attempt}` }));
    assert.equal(response.status, 400);
  }
  const { response, result } = await h.send(validClaim());
  assert.equal(response.status, 429);
  assert.equal(result.error, 'rate_limited');
  assertNoDirectoryOrSecrets(result, h);
  assert.equal(h.calls.length, 0);
});

test('name suggestions require three letters and return a bounded public match, never phones or codes', async t => {
  const h=harness(t);
  for(const query of ['', 'Ca', '  c  ']){
    const {response,result}=await h.send({query},{path:'/api/referral-clients'});
    assert.equal(response.status,200);assert.deepEqual(result.matches,[]);
  }
  const {response,result}=await h.send({query:'CaSe'},{path:'/api/referral-clients'});
  assert.equal(response.status,200);assert.equal(result.matches.length,1);
  assert.deepEqual(Object.keys(result.matches[0]).sort(),['canShare','id','name']);
  assert.equal(result.matches[0].name,h.client.clientName);assert.equal(result.matches[0].canShare,true);
  assert.match(result.matches[0].id,/^[a-f0-9]{24}$/);
  assert.ok(!JSON.stringify(result).includes(h.client.phoneDigits));assert.ok(!JSON.stringify(result).includes(h.client.referralCode));
  assert.equal(h.calls.length,0);
});

test('name selection returns the selected issued code and a clear missing-code state', async t => {
  const h=harness(t);
  const found=await h.send({query:'Casey'},{path:'/api/referral-clients'});
  const selected=await h.send({clientId:found.result.matches[0].id},{path:'/api/referral-code'});
  assert.equal(selected.response.status,200);
  assert.deepEqual(selected.result,{ok:true,clientName:h.client.clientName,referralCode:h.client.referralCode});
  assert.ok(!JSON.stringify(selected.result).includes(h.client.phoneDigits));
  const disabled=await h.send({query:'Disabled'},{path:'/api/referral-clients'});
  assert.equal(disabled.result.matches[0].canShare,false);
  const unavailable=await h.send({clientId:disabled.result.matches[0].id},{path:'/api/referral-code'});
  assert.equal(unavailable.response.status,409);assert.equal(unavailable.result.error,'code_not_ready');
  assert.equal(Object.hasOwn(unavailable.result,'referralCode'),false);
  const forged=await h.send({clientId:'000000000000000000000000'},{path:'/api/referral-code'});
  assert.equal(forged.response.status,400);assert.equal(forged.result.error,'client_not_found');
  assert.equal(h.calls.length,0);
});

test('matching supports first or last names, accents, multiple words and at most five suggestions', async t => {
  const h=harness(t);
  h.env.OAB_REFERRAL_CODES=JSON.stringify([
    {clientName:'Morgan Harper',referralCode:'Harper3958',phoneDigits:'5550003958',lookupEnabled:true},
    {clientName:'Éloise O’Neil',referralCode:'Oneil1122',lookupEnabled:true},
    ...Array.from({length:8},(_,index)=>({clientName:'Morgana Person'+index,referralCode:'Person'+index+'1234',lookupEnabled:true}))
  ]);
  for(const query of ['harp','mor har','Harper Morgan']){
    const {result}=await h.send({query},{path:'/api/referral-clients'});
    assert.equal(result.matches.length,1);assert.equal(result.matches[0].name,'Morgan Harper');
  }
  const accent=await h.send({query:'elo'},{path:'/api/referral-clients'});assert.equal(accent.result.matches[0].name,'Éloise O’Neil');
  const broad=await h.send({query:'mor'},{path:'/api/referral-clients'});assert.equal(broad.result.matches.length,5);
  assert.equal(h.calls.length,0);
});

test('typing lookups have their own throttle and do not exhaust the claim allowance', async t => {
  const h=harness(t);
  for(let count=0;count<60;count++){
    const lookup=await h.send({query:'Casey'},{path:'/api/referral-clients'});assert.equal(lookup.response.status,200);
  }
  const over=await h.send({query:'Casey'},{path:'/api/referral-clients'});assert.equal(over.response.status,429);
  const claim=await h.send(validClaim());assert.equal(claim.response.status,200);assert.equal(claim.result.ok,true);
});
