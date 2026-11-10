/* Aura · backend (Vercel Function: api/db.js). Sin email: todos los avisos van por WhatsApp.
   Variables de entorno:
   - KV_REST_API_URL / KV_REST_API_TOKEN ........ Upstash Redis (ya configuradas)
   - WA_PHONE_ID, WA_TOKEN ...................... WhatsApp Business Platform (Cloud API de Meta)
   - WA_TPL_<TIPO>[_ES|_PT|_EN] ................. plantillas aprobadas por Meta (ver whatsapp_templates.txt).
       Sin plantilla se envía texto libre, que Meta solo entrega si la persona escribió en las últimas 24 h.
   - WA_TPL_CODE_BTN=1 .......................... si la plantilla del código es de autenticación (botón "copiar código")
   - CRON_SECRET ................................ clave para GET /api/db?key=... (envía recordatorios; llamar cada 10 min)
   Sin WA_PHONE_ID/WA_TOKEN la web funciona igual, pero no se envía ningún WhatsApp. */
const crypto = require("crypto");
const DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const WA_ID = process.env.WA_PHONE_ID, WA_TOKEN = process.env.WA_TOKEN;
const SITE = "https://aura-paschoalbeauty-website.vercel.app/";
const STAFF = { "aura.paschoalbeauty@icloud.com": ["bruna", "lutty"], "lutyelen@icloud.com": ["lutty"] };
// Avisos de nueva cita: Bruna -> 746 07 18 18 · Lutty -> 602 56 63 25 y también 746 07 18 18
const PHONE = { bruna: ["34746071818"], lutty: ["34746071818", "34602566325"] };
const H = { 0: null, 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 14] };
const SN = ["Drenaje linfático","Limpieza de piel Detox","Dermapen facial","Radiofrecuencia facial","Extensiones de pestañas","Relleno de pestañas","Masaje relajante","Lifting de pestañas","Ingles integral","Piernas enteras","Ingles","1/2 piernas","Brazos","Axilas","Depilación completa","Manicure básica","Semipermanente","Relleno gel","Gel extensión","Pedicura básica","Pedicura + semipermanente","Pedicura + uña encarnada","Cejas hilo","Cejas pinza","Laminado cejas","Microblading + repaso"];
const SP = [40,39,59,49,45,40,45,29,18,15,8,10,8,8,38,15,23,30,35,20,30,45,15,10,40,180];
const FU = [4, 5, 15, 16, 17, 18]; // pestañas y uñas: aviso de relleno a los 15 días
const dp = p => (p * .1).toFixed(2).replace(".00", "");

const MSG = {
  code: { es: "Tu código de Aura: {0} (válido 10 minutos). No lo compartas.", pt: "O seu código da Aura: {0} (válido 10 minutos). Não o partilhe.", en: "Your Aura code: {0} (valid 10 minutes). Don't share it." },
  staffnew: { pt: "MARCAÇÃO: O(A) Cliente {0} quer uma cita para {1}, Voce quer aprovar a cita? {2}" },
  staffcancel: { pt: "Aura: {0} cancelou a cita de {1}. {2}" },
  approved: { es: "Hola {0}, tu cita de {1} del {2} ha sido aprobada. Para confirmarla falta el depósito de {3} € por Bizum o transferencia.", pt: "Olá {0}, a sua marcação de {1} em {2} foi aprovada. Para confirmar falta o sinal de {3} € por Bizum ou transferência.", en: "Hi {0}, your {1} booking on {2} has been approved. To confirm it, the deposit of €{3} is due by Bizum or bank transfer." },
  confirmed: { es: "Hola {0}, tu cita de {1} del {2} está confirmada. ¡Te esperamos!", pt: "Olá {0}, a sua marcação de {1} em {2} está confirmada. Esperamos por si!", en: "Hi {0}, your {1} booking on {2} is confirmed. See you soon!" },
  reject: { es: "Hola {0}, no hemos podido aceptar tu cita del {1}. Puedes elegir otra fecha u hora aquí: {2}", pt: "Olá {0}, não foi possível aceitar a sua marcação de {1}. Pode escolher outra data ou hora aqui: {2}", en: "Hi {0}, we couldn't accept your booking on {1}. You can choose another date or time here: {2}" },
  cancel: { es: "Hola {0}, tu cita del {1} ha sido cancelada por un imprevisto. Puedes reservar otra fecha aquí: {2}", pt: "Olá {0}, a sua marcação de {1} foi cancelada por um imprevisto. Pode remarcar aqui: {2}", en: "Hi {0}, your booking on {1} was cancelled due to an unforeseen issue. You can rebook here: {2}" },
  rem5: { es: "Hola {0}, te recordamos tu cita de {1} del {2}. Si necesitas cambiarla, avísanos con al menos 48 h de antelación: {3}", pt: "Olá {0}, lembramos a sua marcação de {1} em {2}. Se precisar de a alterar, avise com pelo menos 48 h de antecedência: {3}", en: "Hi {0}, a reminder of your {1} booking on {2}. If you need to change it, let us know at least 48 h ahead: {3}" },
  rem1: { es: "Hola {0}, te recordamos que mañana tienes tu cita de {1} ({2}).", pt: "Olá {0}, lembramos que amanhã tem a sua marcação de {1} ({2}).", en: "Hi {0}, a reminder that your {1} booking is tomorrow ({2})." },
  rem2: { es: "Hola {0}, tu cita de {1} es dentro de 2 horas ({2}). ¡Te esperamos!", pt: "Olá {0}, a sua marcação de {1} é daqui a 2 horas ({2}). Esperamos por si!", en: "Hi {0}, your {1} booking is in 2 hours ({2}). See you soon!" },
  follow: { es: "Hola {0}, han pasado unos 15 días desde tu {1}. ¿Reservamos el relleno? {2}", pt: "Olá {0}, passaram cerca de 15 dias desde o seu serviço de {1}. Reservamos o preenchimento? {2}", en: "Hi {0}, it has been about 15 days since your {1}. Shall we book the refill? {2}" }
};
const fill = (s, p) => s.replace(/\{(\d)\}/g, (_, i) => p[i]);
const digits = t => { let d = String(t || "").replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.length === 9) d = "34" + d; return d; };
const LC = { es: "es", pt: "pt_PT", en: "en" };
async function wsend(to, kind, lang, params) {
  if (!WA_ID || !WA_TOKEN) return false;
  to = digits(to); if (to.length < 10) return false;
  lang = MSG[kind][lang] ? lang : (MSG[kind].es ? "es" : "pt");
  const K = "WA_TPL_" + kind.toUpperCase(), tpl = process.env[K + "_" + lang.toUpperCase()] || process.env[K];
  let body;
  if (tpl) {
    const comp = [{ type: "body", parameters: params.map(x => ({ type: "text", text: String(x) })) }];
    if (kind === "code" && process.env.WA_TPL_CODE_BTN) comp.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(params[0]) }] });
    body = { messaging_product: "whatsapp", to, type: "template", template: { name: tpl, language: { code: LC[lang] }, components: comp } };
  } else body = { messaging_product: "whatsapp", to, type: "text", text: { body: fill(MSG[kind][lang], params) } };
  try {
    const r = await fetch("https://graph.facebook.com/v21.0/" + WA_ID + "/messages", { method: "POST", headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) console.error("wa", r.status, await r.text());
    return r.ok;
  } catch (e) { return false; }
}
const toStaff = async (p, kind, params) => (await Promise.all(PHONE[p].map(t => wsend(t, kind, "pt", params)))).some(Boolean);

const rc = async (...a) => {
  const r = await fetch(DB, { method: "POST", headers: { Authorization: "Bearer " + TK }, body: JSON.stringify(a) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
};
const all = async k => { const a = (await rc("HGETALL", k)) || [], o = []; for (let i = 1; i < a.length; i += 2) o.push(JSON.parse(a[i])); return o; };
const getU = async id => { const r = await rc("GET", "u:" + id); if (!r) return null; const u = JSON.parse(r); u.id = id; u.email = u.email || (id.includes("@") ? id : ""); return u; };
const norm = s => String(s || "").trim().toLowerCase();
// Cuenta = teléfono (id). El email es opcional y se busca por el índice e:<email>; las cuentas antiguas (u:<email>) siguen funcionando.
const findId = async s => { s = norm(s); if (s.includes("@")) return (await rc("GET", "e:" + s)) || ((await rc("EXISTS", "u:" + s)) ? s : null); const d = digits(s); return d.length >= 9 && (await rc("EXISTS", "u:" + d)) ? d : null; };
const hp = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const fdt = (lang, d, m) => d.split("-").reverse().join("/") + " " + ({ es: "a las", pt: "às", en: "at" }[lang] || "às") + " " + hm(m);
const live = b => b.st !== "cancelled" && b.st !== "rejected";
const slotErr = (p, d, m, dur, bks, bls) => {
  const hr = H[new Date(d + "T12:00").getDay()];
  if (!hr || m < hr[0] * 60 || m + dur > hr[1] * 60) return "closed";
  if (bks.some(b => live(b) && b.p === p && b.d === d && m < b.m + b.dur && b.m < m + dur) ||
      bls.some(b => b.p === p && b.d === d && m < b.to && b.from < m + dur)) return "busy";
  return "";
};
const okSlot = b => ["bruna", "lutty"].includes(b.p) && /^\d{4}-\d{2}-\d{2}$/.test(b.d) && Number.isInteger(b.m) && b.m >= 0 && b.m < 1440 &&
  Number.isInteger(b.dur) && b.dur >= 5 && b.dur <= 300 && Number.isInteger(b.i) && b.i >= 0 && b.i < SN.length;
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const tzOff = ms => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms)), g = t => +p.find(x => x.type === t).value; return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(ms / 60000) * 60000; };
const madrid = (d, m) => { const g = Date.parse(d + "T" + hm(m) + ":00Z"); return g - tzOff(g - 36e5); };

async function run(b, tok) {
  const op = b.op;
  const pub = u => ({ id: u.id, email: u.email, name: u.name, tel: u.tel, pref: "wa", staff: STAFF[u.email] || null });
  const session = async e => { const t = crypto.randomBytes(24).toString("hex"); await rc("SET", "s:" + t, e, "EX", 2592000); return t; };

  if (op === "register") {
    const em = norm(b.email), tel = digits(b.tel);
    if (tel.length < 9 || tel.length > 15 || String(b.pw || "").length < 8 || !String(b.name || "").trim() || (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))) return { err: "input" };
    if (em && ((await rc("EXISTS", "e:" + em)) || (await rc("EXISTS", "u:" + em)))) return { err: "exists" };
    const salt = crypto.randomBytes(16).toString("hex");
    const u = { salt, h: hp(b.pw, salt), name: String(b.name).trim().slice(0, 80), tel: String(b.tel).trim().slice(0, 30), email: em, pref: "wa", lang: ["es", "pt", "en"].includes(b.lang) ? b.lang : "es" };
    if ((await rc("SET", "u:" + tel, JSON.stringify(u), "NX")) !== "OK") return { err: "exists" };
    if (em && (await rc("SET", "e:" + em, tel, "NX")) !== "OK") { await rc("DEL", "u:" + tel); return { err: "exists" }; }
    u.id = tel;
    return { tok: await session(tel), me: pub(u) };
  }
  if (op === "login") {
    const key = norm(b.ident), n = await rc("INCR", "f:" + key); if (n === 1) await rc("EXPIRE", "f:" + key, 900); if (n > 10) return { err: "bad" };
    const id = await findId(key), u = id && await getU(id);
    if (!u || !crypto.timingSafeEqual(Buffer.from(hp(String(b.pw || ""), u.salt)), Buffer.from(u.h))) return { err: "bad" };
    await rc("DEL", "f:" + key);
    return { tok: await session(id), me: pub(u) };
  }
  if (op === "forgot") {
    if (!WA_ID || !WA_TOKEN) return { err: "nowa" };
    const key = norm(b.ident), n = await rc("INCR", "g:" + key); if (n === 1) await rc("EXPIRE", "g:" + key, 3600); if (n > 5) return { ok: 1 };
    const id = await findId(key), u = id && await getU(id);
    if (u) {
      const code = String(100000 + crypto.randomInt(900000));
      await rc("SET", "c:" + id, JSON.stringify({ code, tries: 0 }), "EX", 600);
      await wsend(u.tel, "code", u.lang || "es", [code]);
    }
    return { ok: 1 };
  }
  if (op === "reset") {
    const id = await findId(b.ident), r = id && await rc("GET", "c:" + id), c = r ? JSON.parse(r) : null, u = id && await getU(id);
    if (!c || !u || c.tries >= 5) return { err: "code" };
    if (String(b.code || "").trim() !== c.code) { c.tries++; await rc("SET", "c:" + id, JSON.stringify(c), "EX", 600); return { err: "code" }; }
    if (b.pw) { if (String(b.pw).length < 8) return { err: "input" }; u.salt = crypto.randomBytes(16).toString("hex"); u.h = hp(b.pw, u.salt); await rc("SET", "u:" + id, JSON.stringify(u)); }
    await rc("DEL", "c:" + id);
    return { tok: await session(id), me: pub(u) };
  }

  const me = tok && (await rc("GET", "s:" + tok)), user = me && (await getU(me));
  if (!user) return { err: "auth" };
  const mine = STAFF[user.email] || [];
  if (op === "logout") { await rc("DEL", "s:" + tok); return { ok: 1 }; }

  const bks = await all("bk"), bls = await all("bl");
  if (op === "list") {
    return { me: pub(user),
      bookings: bks.filter(x => mine.includes(x.p) || x.email === me),
      busy: bks.filter(live).map(x => ({ p: x.p, d: x.d, m: x.m, dur: x.dur })),
      blocks: bls.map(x => mine.includes(x.p) ? x : { id: x.id, p: x.p, d: x.d, from: x.from, to: x.to }) };
  }
  if (op === "book" || op === "sbook") {
    const staff = op === "sbook";
    if (!okSlot(b) || (staff && !mine.includes(b.p))) return { err: staff ? "forbidden" : "input" };
    const e = slotErr(b.p, b.d, b.m, b.dur, bks, bls); if (e) return { err: e };
    const now = Date.now();
    const bk = { id: newId(), i: b.i, p: b.p, d: b.d, m: b.m, dur: b.dur,
      n: String(staff ? b.n : b.n || user.name).slice(0, 80), tel: String(staff ? b.tel : b.tel || user.tel).slice(0, 30),
      email: staff ? "" : me, pref: "wa",
      src: staff ? String(b.src || "presencial").slice(0, 20) : "online", st: staff ? "paid" : "pending", ts: now };
    if (staff) bk.pt = now;
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    let notified = false;
    if (!staff) notified = await toStaff(b.p, "staffnew", [bk.n, fdt("pt", bk.d, bk.m), SITE]);
    return { id: bk.id, notified };
  }
  if (op === "act") {
    const r = await rc("HGET", "bk", String(b.id)), bk = r ? JSON.parse(r) : null; if (!bk) return { err: "forbidden" };
    const isS = mine.includes(bk.p), isC = bk.email === me, a = b.a;
    const ok = isS ? ((a === "ap" || a === "rj") && bk.st === "pending") || (a === "pd" && bk.st === "approved") || (a === "cn" && live(bk))
                   : isC && a === "cn" && live(bk);
    if (!ok) return { err: "forbidden" };
    const usr = bk.email ? await getU(bk.email) : null, lang = (usr && usr.lang) || "es", dt = fdt(lang, bk.d, bk.m);
    let sent = false;
    if (a === "rj" || a === "cn") {
      bk.st = "cancelled";
      if (isS) { bk.by = "staff"; sent = await wsend(bk.tel, a === "rj" ? "reject" : "cancel", lang, [bk.n, dt, SITE]); }
      else { bk.by = "client"; await toStaff(bk.p, "staffcancel", [bk.n, fdt("pt", bk.d, bk.m), SITE]); }
    } else if (a === "ap") {
      bk.st = "approved";
      sent = await wsend(bk.tel, "approved", lang, [bk.n, SN[bk.i], dt, dp(SP[bk.i])]);
    } else {
      bk.st = "paid"; bk.pt = Date.now();
      sent = await wsend(bk.tel, "confirmed", lang, [bk.n, SN[bk.i], dt]);
    }
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    return { ok: 1, sent };
  }
  if (op === "block") {
    if (!mine.includes(b.p) || !/^\d{4}-\d{2}-\d{2}$/.test(b.d) || !(b.to > b.from)) return { err: "forbidden" };
    const x = { id: newId(), p: b.p, d: b.d, from: +b.from, to: +b.to, why: String(b.why || "").slice(0, 80) };
    await rc("HSET", "bl", x.id, JSON.stringify(x)); return { id: x.id };
  }
  if (op === "unblock") {
    const r = await rc("HGET", "bl", String(b.id)), x = r ? JSON.parse(r) : null;
    if (!x || !mine.includes(x.p)) return { err: "forbidden" };
    await rc("HDEL", "bl", x.id); return { ok: 1 };
  }
  return { err: "input" };
}

// Recordatorios por WhatsApp: 5 días, 1 día y 2 horas antes + aviso de relleno a los 15 días.
// Solo citas confirmadas (pagadas). Llamar cada ~10 min (cron-job.org o Vercel Cron en plan Pro).
async function cron() {
  const now = Date.now(), D = 864e5; let n = 0;
  for (const bk of await all("bk")) {
    if (bk.st !== "paid" || !Number.isInteger(bk.i) || bk.i < 0 || bk.i >= SN.length) continue;
    const rm = bk.rm || {}, start = madrid(bk.d, bk.m), end = start + bk.dur * 60000, left = start - now, since = bk.pt || bk.ts || 0;
    const usr = bk.email ? await getU(bk.email) : null, lang = (usr && usr.lang) || "es", dt = fdt(lang, bk.d, bk.m), sv = SN[bk.i];
    const jobs = [["d5", left <= 5 * D && left > D && since <= start - 5 * D, "rem5", [bk.n, sv, dt, SITE]],
                  ["d1", left <= D && left > 72e5 && since <= start - D, "rem1", [bk.n, sv, dt]],
                  ["h2", left <= 72e5 && left > 0 && since <= start - 72e5, "rem2", [bk.n, sv, dt]],
                  ["f", FU.includes(bk.i) && now >= end + 15 * D && now < end + 18 * D, "follow", [bk.n, sv, SITE]]];
    let ch = false;
    for (const [k, due, kind, p] of jobs) if (due && !rm[k] && await wsend(bk.tel, kind, lang, p)) { rm[k] = 1; ch = true; n++; }
    if (ch) { bk.rm = rm; await rc("HSET", "bk", bk.id, JSON.stringify(bk)); }
  }
  return n;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const k = (req.headers.authorization || "").replace("Bearer ", "") || (req.query && req.query.key) || "";
    if (!process.env.CRON_SECRET || k !== process.env.CRON_SECRET) return res.status(401).json({ err: "auth" });
    try { return res.status(200).json({ sent: await cron() }); } catch (e) { console.error(e); return res.status(200).json({ err: "server" }); }
  }
  if (req.method !== "POST") return res.status(405).json({ err: "method" });
  try { res.status(200).json(await run(req.body || {}, (req.headers.authorization || "").replace("Bearer ", ""))); }
  catch (e) { console.error(e); res.status(200).json({ err: "server" }); }
};
