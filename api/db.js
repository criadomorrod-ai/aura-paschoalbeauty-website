/* Aura · backend (Vercel Function: api/db.js). Só WhatsApp (WhatsApp Business Cloud API da Meta).
   O email serve só para identificar a conta no login. Nenhuma mensagem sai por email.
   Variáveis de ambiente:
   - KV_REST_API_URL / KV_REST_API_TOKEN ........ Upstash Redis (ya configuradas)
   - WA_PHONE_ID, WA_TOKEN ...................... WhatsApp Business Platform (Cloud API de Meta)
   - WA_TPL_<TIPO>[_ES|_PT|_EN] ................. plantillas aprobadas por Meta. Parámetros, en orden:
       CODE            {{1}} código                                   (WA_TPL_CODE_BTN=1 si tiene botón "copiar código")
       CLIENT_CANCEL   {{1}} nombre {{2}} servicio {{3}} fecha {{4}} hora {{5}} enlace
       REMIND          {{1}} nombre {{2}} servicio {{3}} fecha {{4}} hora {{5}} enlace
       REFILL          {{1}} nombre {{2}} servicio {{3}} enlace
       NEW             {{1}} cliente {{2}} fecha {{3}} hora {{4}} enlace   (profesionales, idioma pt_PT)
       STAFF_CANCEL    {{1}} cliente {{2}} fecha {{3}} hora                (profesionales, idioma pt_PT)
     Sin plantilla se envía texto libre, que Meta solo entrega si la persona escribió en las últimas 24 h.
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
  cancel: { es: "Hola {0}, lamentamos informarte que tu cita de {1} del {2} a las {3} ha sido cancelada por un imprevisto. Puedes reservar otra fecha en {4}", pt: "Olá {0}, lamentamos informar que a sua marcação de {1} em {2} às {3} foi cancelada por um imprevisto. Pode remarcar em {4}", en: "Hi {0}, we're sorry to let you know your {1} appointment on {2} at {3} was cancelled due to an unforeseen issue. Rebook at {4}" },
  remind: { es: "Hola {0}, te recordamos tu cita de {1} el {2} a las {3}. ¡Te esperamos! {4}", pt: "Olá {0}, lembramos a sua marcação de {1} em {2} às {3}. Até já! {4}", en: "Hi {0}, a reminder of your {1} appointment on {2} at {3}. See you soon! {4}" },
  refill: { es: "Hola {0}, ya han pasado 15 días desde tu {1}. Es buen momento para el relleno. Reserva aquí: {2}", pt: "Olá {0}, já passaram 15 dias desde a sua {1}. É boa altura para o retoque. Marque aqui: {2}", en: "Hi {0}, it's been 15 days since your {1}. Good time for a refill. Book here: {2}" },
  newBk: "MARCAÇÃO: O(A) Cliente {0} quer uma cita para {1} às {2}, Você quer aprovar a cita? {3}",
  staffCancel: "CANCELAMENTO: a cliente {0} cancelou a cita de {1} às {2}."
};

const rc = async (...a) => {
  const r = await fetch(DB, { method: "POST", headers: { Authorization: "Bearer " + TK }, body: JSON.stringify(a) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
};
const all = async k => { const a = (await rc("HGETALL", k)) || [], o = []; for (let i = 1; i < a.length; i += 2) o.push(JSON.parse(a[i])); return o; };
const hp = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const live = b => b.st !== "cancelled" && b.st !== "rejected";
const LG = l => (["es", "pt", "en"].includes(l) ? l : "es");
const dg = x => String(x || "").replace(/\D/g, "").replace(/^(\d{9})$/, "34$1");
const fdate = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const fmt = (t, ...a) => t.replace(/\{(\d+)\}/g, (_, i) => (a[+i] == null ? "" : String(a[+i])));
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");

// ---- WhatsApp ----
const TPL_LANG = { es: "es", pt: "pt_PT", en: "en" };
async function wa(to, tipo, lang, params, text) {
  const num = dg(to);
  if (!WA_ID || !WA_TOKEN || num.length < 11) return false;
  const L = TPL_LANG[lang] ? lang : "es";
  const tpl = process.env[`WA_TPL_${tipo}_${L.toUpperCase()}`] || process.env[`WA_TPL_${tipo}`];
  let body;
  if (tpl) {
    const comps = [{ type: "body", parameters: params.map(p => ({ type: "text", text: String(p) })) }];
    if (tipo === "CODE" && process.env.WA_TPL_CODE_BTN === "1")
      comps.push({ type: "button", sub_type: "copy_code", index: "0", parameters: [{ type: "coupon_code", coupon_code: String(params[0]) }] });
    body = { messaging_product: "whatsapp", to: num, type: "template", template: { name: tpl, language: { code: TPL_LANG[L] }, components: comps } };
  } else {
    body = { messaging_product: "whatsapp", to: num, type: "text", text: { body: text } };
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${WA_ID}/messages`, { method: "POST",
      headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch (e) { return false; }
}
const toStaff = async (p, tipo, params, text) => {
  let ok = false;
  for (const n of PHONE[p] || []) ok = (await wa(n, tipo, "pt", params, text)) || ok;
  return ok;
};
const notifyClient = (bk, key, tipo, params) => wa(bk.tel, tipo, LG(bk.lang), params, fmt(MSG[key][LG(bk.lang)], ...params));

// ---- hora de Madrid (para recordatorios) ----
const madridOffset = ms => {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = +x.value; });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
};
const apptMs = (d, m) => {
  const [y, mo, da] = d.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, da, Math.floor(m / 60), m % 60);
  return guess - madridOffset(guess);
};

const slotErr = (p, d, m, dur, bks, bls) => {
  const hr = H[new Date(d + "T12:00").getDay()];
  if (!hr || m < hr[0] * 60 || m + dur > hr[1] * 60) return "closed";
  if (bks.some(b => live(b) && b.p === p && b.d === d && m < b.m + b.dur && b.m < m + dur) ||
      bls.some(b => b.p === p && b.d === d && m < b.to && b.from < m + dur)) return "busy";
  return "";
};
const okSlot = b => ["bruna", "lutty"].includes(b.p) && /^\d{4}-\d{2}-\d{2}$/.test(b.d) && Number.isInteger(b.m) && b.m >= 0 && b.m < 1440 &&
  Number.isInteger(b.dur) && b.dur >= 5 && b.dur <= 300 && Number.isInteger(b.i);

// Recordatorios (llamado por cron con ?key=CRON_SECRET). Cada aviso se intenta una sola vez.
async function reminders() {
  const now = Date.now(), bks = await all("bk"); let sent = 0;
  for (const b of bks) {
    if (b.st !== "approved" && b.st !== "paid") continue;
    const t = apptMs(b.d, b.m);
    if (!b.rem && t > now && t - now <= 864e5) {
      b.rem = 1; if (await notifyClient(b, "remind", "REMIND", [b.n, SN[b.i], fdate(b.d), hm(b.m), SITE])) sent++;
      await rc("HSET", "bk", b.id, JSON.stringify(b));
    }
    if (!b.fu && FU.includes(b.i) && now >= t + 15 * 864e5) {
      b.fu = 1; if (await notifyClient(b, "refill", "REFILL", [b.n, SN[b.i], SITE])) sent++;
      await rc("HSET", "bk", b.id, JSON.stringify(b));
    }
  }
  return { ok: 1, sent };
}

async function run(b, tok) {
  const op = b.op, em = String(b.email || "").trim().toLowerCase();
  const pub = (e, u) => ({ email: e, name: u.name, tel: u.tel, lang: LG(u.lang), staff: STAFF[e] || null });
  const session = async e => { const t = crypto.randomBytes(24).toString("hex"); await rc("SET", "s:" + t, e, "EX", 2592000); return t; };
  const getU = async e => { const r = await rc("GET", "u:" + e); return r ? JSON.parse(r) : null; };

  if (op === "register") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || String(b.pw || "").length < 8 || !b.name || dg(b.tel).length < 11) return { err: "input" };
    const salt = crypto.randomBytes(16).toString("hex");
    const u = { salt, h: hp(b.pw, salt), name: String(b.name).trim().slice(0, 80), tel: String(b.tel).trim().slice(0, 30), lang: LG(b.lang) };
    if ((await rc("SET", "u:" + em, JSON.stringify(u), "NX")) !== "OK") return { err: "exists" };
    return { tok: await session(em), me: pub(em, u) };
  }
  if (op === "login") {
    const n = await rc("INCR", "f:" + em); if (n === 1) await rc("EXPIRE", "f:" + em, 900); if (n > 10) return { err: "bad" };
    const u = await getU(em);
    if (!u || !crypto.timingSafeEqual(Buffer.from(hp(String(b.pw || ""), u.salt)), Buffer.from(u.h))) return { err: "bad" };
    await rc("DEL", "f:" + em);
    return { tok: await session(em), me: pub(em, u) };
  }
  if (op === "forgot") {
    if (!WA_ID || !WA_TOKEN) return { err: "nomail" };
    const n = await rc("INCR", "fg:" + em); if (n === 1) await rc("EXPIRE", "fg:" + em, 3600); if (n > 5) return { ok: 1 };
    const u = await getU(em);
    if (u) {
      const code = String(100000 + crypto.randomInt(900000));
      await rc("SET", "c:" + em, JSON.stringify({ code, tries: 0 }), "EX", 600);
      await wa(u.tel, "CODE", LG(u.lang), [code], fmt(MSG.code[LG(u.lang)], code));
    }
    return { ok: 1 };
  }
  if (op === "reset") {
    const r = await rc("GET", "c:" + em), c = r ? JSON.parse(r) : null, u = await getU(em);
    if (!c || !u || c.tries >= 5) return { err: "code" };
    if (String(b.code || "").trim() !== c.code) { c.tries++; await rc("SET", "c:" + em, JSON.stringify(c), "EX", 600); return { err: "code" }; }
    if (b.pw) { if (String(b.pw).length < 8) return { err: "input" }; u.salt = crypto.randomBytes(16).toString("hex"); u.h = hp(b.pw, u.salt); await rc("SET", "u:" + em, JSON.stringify(u)); }
    await rc("DEL", "c:" + em);
    return { tok: await session(em), me: pub(em, u) };
  }

  const me = tok && (await rc("GET", "s:" + tok)), user = me && (await getU(me));
  if (!user) return { err: "auth" };
  const mine = STAFF[me] || [];
  if (op === "logout") { await rc("DEL", "s:" + tok); return { ok: 1 }; }

  const bks = await all("bk"), bls = await all("bl");
  if (op === "list") {
    return { me: pub(me, user),
      bookings: bks.filter(x => mine.includes(x.p) || x.email === me),
      busy: bks.filter(live).map(x => ({ p: x.p, d: x.d, m: x.m, dur: x.dur })),
      blocks: bls.map(x => mine.includes(x.p) ? x : { id: x.id, p: x.p, d: x.d, from: x.from, to: x.to }) };
  }
  if (op === "book" || op === "sbook") {
    const staff = op === "sbook";
    if (!okSlot(b) || (staff && !mine.includes(b.p))) return { err: staff ? "forbidden" : "input" };
    const e = slotErr(b.p, b.d, b.m, b.dur, bks, bls); if (e) return { err: e };
    const bk = { id: newId(), i: b.i, p: b.p, d: b.d, m: b.m, dur: b.dur,
      n: String(staff ? b.n : b.n || user.name).slice(0, 80), tel: String(staff ? b.tel : b.tel || user.tel).slice(0, 30),
      email: staff ? "" : me, lang: staff ? "es" : LG(b.lang || user.lang),
      src: staff ? String(b.src || "presencial").slice(0, 20) : "online", st: staff ? "paid" : "pending" };
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    if (!staff) await toStaff(bk.p, "NEW", [bk.n, fdate(bk.d), hm(bk.m), SITE], fmt(MSG.newBk, bk.n, fdate(bk.d), hm(bk.m), SITE));
    return { id: bk.id };
  }
  if (op === "act") {
    const r = await rc("HGET", "bk", String(b.id)), bk = r ? JSON.parse(r) : null; if (!bk) return { err: "forbidden" };
    const isS = mine.includes(bk.p), isC = bk.email === me, a = b.a;
    const ok = isS ? ((a === "ap" || a === "rj") && bk.st === "pending") || (a === "pd" && bk.st === "approved") || (a === "cn" && live(bk))
                   : isC && a === "cn" && live(bk);
    if (!ok) return { err: "forbidden" };
    let sent = false;
    if (a === "rj" || a === "cn") {
      bk.st = "cancelled";
      if (isS) {
        bk.by = "staff";
        sent = await notifyClient(bk, "cancel", "CLIENT_CANCEL", [bk.n, SN[bk.i], fdate(bk.d), hm(bk.m), SITE]);
      } else {
        bk.by = "client";
        await toStaff(bk.p, "STAFF_CANCEL", [bk.n, fdate(bk.d), hm(bk.m)], fmt(MSG.staffCancel, bk.n, fdate(bk.d), hm(bk.m)));
      }
    } else {
      bk.st = { ap: "approved", pd: "paid" }[a];
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const key = new URL(req.url, "http://x").searchParams.get("key");
      if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return res.status(401).json({ err: "auth" });
      return res.status(200).json(await reminders());
    }
    if (req.method !== "POST") return res.status(405).json({ err: "method" });
    res.status(200).json(await run(req.body || {}, (req.headers.authorization || "").replace("Bearer ", "")));
  } catch (e) { console.error(e); res.status(200).json({ err: "server" }); }
};
