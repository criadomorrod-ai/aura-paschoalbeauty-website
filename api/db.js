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
