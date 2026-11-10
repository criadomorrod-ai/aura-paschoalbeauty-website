/* Aura · backend (Vercel Function). Precisa de Upstash Redis (KV_REST_API_URL/TOKEN) e, opcional, Resend (RESEND_API_KEY, MAIL_FROM). */
const crypto = require("crypto");
const DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SITE = "https://aura-paschoalbeauty-website.vercel.app/";
const STAFF = { "aura.paschoalbeauty@icloud.com": ["bruna", "lutty"], "lutyelen@icloud.com": ["lutty"] };
const H = { 0: null, 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 14] };
const rc = async (...a) => {
  const r = await fetch(DB, { method: "POST", headers: { Authorization: "Bearer " + TK }, body: JSON.stringify(a) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
};
const all = async k => { const a = (await rc("HGETALL", k)) || [], o = []; for (let i = 1; i < a.length; i += 2) o.push(JSON.parse(a[i])); return o; };
const mail = async (to, subject, text) => {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Aura <onboarding@resend.dev>", to, subject, text }) });
    return r.ok;
  } catch (e) { return false; }
};
const hp = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const live = b => b.st !== "cancelled" && b.st !== "rejected";
const staffTo = p => ["aura.paschoalbeauty@icloud.com"].concat(p === "lutty" ? ["lutyelen@icloud.com"] : []);
const slotErr = (p, d, m, dur, bks, bls) => {
  const hr = H[new Date(d + "T12:00").getDay()];
  if (!hr || m < hr[0] * 60 || m + dur > hr[1] * 60) return "closed";
  if (bks.some(b => live(b) && b.p === p && b.d === d && m < b.m + b.dur && b.m < m + dur) ||
      bls.some(b => b.p === p && b.d === d && m < b.to && b.from < m + dur)) return "busy";
  return "";
};
const okSlot = b => ["bruna", "lutty"].includes(b.p) && /^\d{4}-\d{2}-\d{2}$/.test(b.d) && Number.isInteger(b.m) && b.m >= 0 && b.m < 1440 &&
  Number.isInteger(b.dur) && b.dur >= 5 && b.dur <= 300 && Number.isInteger(b.i);
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");

async function run(b, tok) {
  const op = b.op, em = String(b.email || "").trim().toLowerCase();
  const pub = (e, u) => ({ email: e, name: u.name, tel: u.tel, pref: u.pref, staff: STAFF[e] || null });
  const session = async e => { const t = crypto.randomBytes(24).toString("hex"); await rc("SET", "s:" + t, e, "EX", 2592000); return t; };
  const getU = async e => { const r = await rc("GET", "u:" + e); return r ? JSON.parse(r) : null; };

  if (op === "register") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || String(b.pw || "").length < 8 || !b.name || !b.tel) return { err: "input" };
    const salt = crypto.randomBytes(16).toString("hex");
    const u = { salt, h: hp(b.pw, salt), name: String(b.name).trim().slice(0, 80), tel: String(b.tel).trim().slice(0, 30), pref: b.pref === "email" ? "email" : "wa" };
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
    if (!process.env.RESEND_API_KEY) return { err: "nomail" };
    const u = await getU(em);
    if (u) {
      const code = String(100000 + crypto.randomInt(900000));
      await rc("SET", "c:" + em, JSON.stringify({ code, tries: 0 }), "EX", 600);
      await mail(em, "Aura · código / code", `Tu código para entrar en Aura: ${code}\nO seu código para entrar na Aura: ${code}\nYour code to log in to Aura: ${code}\n(10 min)`);
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
      email: staff ? String(b.email || "").toLowerCase() : me, pref: staff ? "wa" : user.pref,
      src: staff ? String(b.src || "presencial").slice(0, 20) : "online", st: staff ? "paid" : "pending" };
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    if (!staff) await mail(staffTo(b.p), "Aura · Nueva cita pendiente", `Recebemos um pedido de cita de ${bk.n}. ${SITE}`);
    return { id: bk.id };
  }
  if (op === "act") {
    const r = await rc("HGET", "bk", String(b.id)), bk = r ? JSON.parse(r) : null; if (!bk) return { err: "forbidden" };
    const isS = mine.includes(bk.p), isC = bk.email === me, a = b.a;
    const ok = isS ? ((a === "ap" || a === "rj") && bk.st === "pending") || (a === "pd" && bk.st === "approved") || (a === "cn" && live(bk))
                   : isC && a === "cn" && live(bk);
    if (!ok) return { err: "forbidden" };
    bk.st = { ap: "approved", rj: "rejected", pd: "paid", cn: "cancelled" }[a];
    if (a === "cn" && !isS) { bk.by = "client"; await mail(staffTo(bk.p), "Aura · Cita cancelada", `${bk.n} canceló su cita del ${bk.d} a las ${hm(bk.m)}. ${SITE}`); }
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    return { ok: 1 };
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
  if (req.method !== "POST") return res.status(405).json({ err: "method" });
  try { res.status(200).json(await run(req.body || {}, (req.headers.authorization || "").replace("Bearer ", ""))); }
  catch (e) { console.error(e); res.status(200).json({ err: "server" }); }
};

