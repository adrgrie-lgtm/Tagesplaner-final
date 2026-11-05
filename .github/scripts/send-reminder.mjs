import webpush from 'web-push';
import { generateKeyPairSync } from 'crypto';

const API_KEY = 'AIzaSyDnxOWelFO4nNgxHNgX9j2x-zb0IrV0SHg';
const PROJECT = 'familienplaner-6ac08';
const CODE = 'GBGV-A9T6';

const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(Date.now() + 24 * 3600 * 1000));

async function main() {
  const auth = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  if (!auth.ok) throw new Error('Anonyme Anmeldung fehlgeschlagen: ' + auth.status);
  const token = (await auth.json()).idToken;
  const headers = { Authorization: 'Bearer ' + token };
  const base = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/families/' + CODE;

  const cfgRes = await fetch(base + '/pushConfig/vapid', { headers });
  let pub, priv;
  if (cfgRes.ok) {
    const f = (await cfgRes.json()).fields || {};
    pub = f.publicKey && f.publicKey.stringValue;
    priv = f.privateKey && f.privateKey.stringValue;
    console.log('VAPID-Schluessel aus Firestore geladen');
  } else {
    const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    pub = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64url');
    priv = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64url');
    const put = await fetch(base + '/pushConfig/vapid', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { publicKey: { stringValue: pub }, privateKey: { stringValue: priv } } })
    });
    if (!put.ok) throw new Error('VAPID-Schluessel konnte nicht in Firestore gespeichert werden: ' + put.status);
    console.log('VAPID-Schluessel neu erzeugt und in Firestore gespeichert');
  }
  webpush.setVapidDetails('mailto:adrgrie@gmail.com', pub, priv);

  const [evRes, memRes, subRes] = await Promise.all([
    fetch(base + '/events?pageSize=300', { headers }),
    fetch(base + '/members?pageSize=100', { headers }),
    fetch(base + '/pushSubs?pageSize=100', { headers })
  ]);
  if (!evRes.ok) throw new Error('Firestore events nicht lesbar: ' + evRes.status);
  const evs = (await evRes.json()).documents || [];
  const mems = memRes.ok ? ((await memRes.json()).documents || []) : [];
  const subs = subRes.ok ? ((await subRes.json()).documents || []) : [];

  const nameOf = {};
  mems.forEach(function (d) { nameOf[d.name.split('/').pop()] = d.fields.name ? d.fields.name.stringValue : ''; });

  const list = evs.filter(function (d) {
    const f = d.fields || {};
    return f.date && f.date.stringValue === tomorrow && !(f.isCompleted && f.isCompleted.booleanValue);
  }).map(function (d) {
    const f = d.fields;
    const time = f.startTime ? (f.startTime.stringValue || '') + ' ' : '';
    const who = (f.personId && nameOf[f.personId.stringValue]) ? ' (' + nameOf[f.personId.stringValue] + ')' : '';
    return time + (f.title ? f.title.stringValue : '') + who;
  }).sort();

  if (list.length === 0) { console.log('Keine Termine fuer morgen (' + tomorrow + ') - keine Push-Nachricht.'); return; }
  const body = list.join('\n');
  console.log('Erinnerung fuer ' + tomorrow + ': ' + body);

  let sent = 0;
  for (const d of subs) {
    const f = d.fields || {};
    if (!f.endpoint || !f.p256dh || !f.auth) continue;
    try {
      await webpush.sendNotification(
        { endpoint: f.endpoint.stringValue, keys: { p256dh: f.p256dh.stringValue, auth: f.auth.stringValue } },
        JSON.stringify({ title: '📅 Morgen: ' + list.length + (list.length === 1 ? ' Termin' : ' Termine'), body: body })
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await fetch(d.name, { method: 'DELETE', headers }).catch(function () { });
        console.log('Abgelaufenes Push-Abo entfernt');
      } else {
        console.warn('Push fehlgeschlagen:', err.statusCode || err.message);
      }
    }
  }
  console.log('Push-Nachrichten gesendet: ' + sent);
}
main().catch(function (e) { console.error(e.message); process.exit(1); });
