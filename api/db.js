/* Aura · backend (Vercel Function: api/db.js). Suporte a e-mail ou número de telemóvel para login/registro/recuperação. */
const crypto = require("crypto");
const DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const WA_ID = process.env.WA_PHONE_ID, WA_TOKEN = process.env.WA_TOKEN;
const SITE = "https://aura-paschoalbeauty-website.vercel.app/";
const STAFF = { "aura.paschoalbeauty@icloud.com": ["bruna", "lutty"], "lutyelen@icloud.com": ["lutty"] };
const PHONE = { bruna: ["34746071818"], lutty: ["34746071818", "34602566325"] };
const H = { 0: null, 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 14] };
const SN = ["Drenaje linfático","Limpieza de piel Detox","Dermapen facial","Radiofrecuencia facial","Extensiones de pestañas","Relleno de pestañas","Masaje relajante","Lifting de pestañas","Ingles integral","Piernas enteras","Ingles","1/2 piernas","Brazos","Axilas","Depilación completa","Manicure básica","Semipermanente","Relleno gel","Gel extensión","Pedicura básica","Pedicura + semipermanente","Pedicura + uña encarnada","Cejas hilo","Cejas pinza","Laminado cejas","Microblading + repaso"];
const SP = [40,39,59,49,45,40,45,29,18,15,8,10,8,8,38,15,23,30,35,20,30,45,15,10,40,180];
const FU = [4, 5, 15, 16, 17, 18];
const dp = p => (p * .1).toFixed(2).replace(".00", "");

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

// Identificar se é email ou número
const isEmail = str => str.includes("@");
const cleanKey = str => str.trim().toLowerCase();

async function wa(to, tipo, lang, params, text) {
  const num = dg(to);
  if (!WA_ID || !WA_TOKEN || num.length < 11) return false;
  const L = ["es", "pt", "en"].includes(lang) ? lang : "es";
  const body = { messaging_product: "whatsapp", to: num, type: "text", text: { body: text } };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${WA_ID}/messages`, { method: "POST",
      headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch (e) { return false; }
}

async function run(b, tok) {
  const op = b.op;
  const pub = u => ({ id: u.id, name: u.name, tel: u.tel, lang: LG(u.lang), staff: STAFF[u.email] || null });
  const session = async userId => { const t = crypto.randomBytes(24).toString("hex"); await rc("SET", "s:" + t, userId, "EX", 2592000); return t; };

  // Helper para buscar usuário por email ou por número de telefone
  const findUser = async ident => {
    ident = cleanKey(ident);
    const key = isEmail(ident) ? "u:email:" + ident : "u:tel:" + dg(ident);
    const id = await rc("GET", key);
    if (!id) return null;
    const uData = await rc("GET", "u:id:" + id);
    return uData ? JSON.parse(uData) : null;
  };

  if (op === "register") {
    const ident = cleanKey(b.identifier || "");
    const telClean = dg(b.tel || "");
    if (String(b.pw || "").length < 8 || !b.name || telClean.length < 11) return { err: "input" };
    
    // Verificar se já existe
    const existing = await findUser(ident) || await findUser(b.tel);
    if (existing) return { err: "exists" };

    const id = newId();
    const salt = crypto.randomBytes(16).toString("hex");
    const u = { 
      id, 
      salt, 
      h: hp(b.pw, salt), 
      name: String(b.name).trim().slice(0, 80), 
      tel: telClean, 
      email: isEmail(ident) ? ident : cleanKey(b.email || ""), 
      lang: LG(b.lang) 
    };

    await rc("SET", "u:id:" + id, JSON.stringify(u));
    await rc("SET", "u:tel:" + telClean, id);
    if (u.email) await rc("SET", "u:email:" + u.email, id);

    return { tok: await session(id), me: pub(u) };
  }

  if (op === "login") {
    const ident = cleanKey(b.identifier || "");
    const u = await findUser(ident);
    if (!u || !crypto.timingSafeEqual(Buffer.from(hp(String(b.pw || ""), u.salt)), Buffer.from(u.h))) return { err: "bad" };
    return { tok: await session(u.id), me: pub(u) };
  }

  if (op === "forgot") {
    const ident = cleanKey(b.identifier || "");
    const u = await findUser(ident);
    if (u) {
      const code = String(100000 + crypto.randomInt(900000));
      await rc("SET", "c:" + u.id, JSON.stringify({ code, tries: 0 }), "EX", 600);
      await wa(u.tel, "CODE", LG(u.lang), [code], `Seu código Aura: ${code} (válido por 10 minutos).`);
    }
    return { ok: 1 };
  }

  if (op === "reset") {
    const ident = cleanKey(b.identifier || "");
    const u = await findUser(ident);
    const r = u ? await rc("GET", "c:" + u.id) : null;
    const c = r ? JSON.parse(r) : null;
    if (!c || !u || c.tries >= 5) return { err: "code" };
    if (String(b.code || "").trim() !== c.code) { c.tries++; await rc("SET", "c:" + u.id, JSON.stringify(c), "EX", 600); return { err: "code" }; }
    if (b.pw) { if (String(b.pw).length < 8) return { err: "input" }; u.salt = crypto.randomBytes(16).toString("hex"); u.h = hp(b.pw, u.salt); await rc("SET", "u:id:" + u.id, JSON.stringify(u)); }
    await rc("DEL", "c:" + u.id);
    return { tok: await session(u.id), me: pub(u) };
  }

  const userId = tok && (await rc("GET", "s:" + tok));
  const uData = userId && (await rc("GET", "u:id:" + userId));
  const user = uData ? JSON.parse(uData) : null;
  if (!user) return { err: "auth" };

  const mine = STAFF[user.email] || [];
  if (op === "logout") { await rc("DEL", "s:" + tok); return { ok: 1 }; }

  const bks = await all("bk"), bls = await all("bl");
  if (op === "list") {
    return { me: pub(user),
      bookings: bks.filter(x => mine.includes(x.p) || x.userId === user.id),
      busy: bks.filter(live).map(x => ({ p: x.p, d: x.d, m: x.m, dur: x.dur })),
      blocks: bls.map(x => mine.includes(x.p) ? x : { id: x.id, p: x.p, d: x.d, from: x.from, to: x.to }) };
  }

  if (op === "book" || op === "sbook") {
    const staff = op === "sbook";
    const bk = { id: newId(), i: b.i, p: b.p, d: b.d, m: b.m, dur: b.dur,
      n: String(staff ? b.n : user.name).slice(0, 80), tel: String(staff ? b.tel : user.tel).slice(0, 30),
      userId: staff ? "" : user.id, lang: staff ? "es" : LG(user.lang),
      src: staff ? String(b.src || "presencial").slice(0, 20) : "online", st: staff ? "paid" : "pending" };
    await rc("HSET", "bk", bk.id, JSON.stringify(bk));
    return { id: bk.id };
  }

  return { err: "input" };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return res.status(405).json({ err: "method" });
    res.status(200).json(await run(req.body || {}, (req.headers.authorization || "").replace("Bearer ", "")));
  } catch (e) { console.error(e); res.status(200).json({ err: "server" }); }
};
