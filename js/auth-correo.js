/**
 * Notificaciones por correo (cliente).
 * Sin servidor SMTP: abre el cliente de correo con mailto:
 * o usa EmailJS si configurás window.MONTECARMELO_EMAILJS.
 */

import { CORREO_PARROQUIA } from "./auth.js";

function mailto(to, subject, body) {
  const url =
    "mailto:" +
    encodeURIComponent(to) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);
  window.open(url, "_blank");
}

async function viaEmailJs(templateParams) {
  const cfg = window.MONTECARMELO_EMAILJS;
  if (!cfg || !cfg.serviceId || !cfg.templateId || !cfg.publicKey) return false;
  if (!window.emailjs) return false;
  try {
    await window.emailjs.send(cfg.serviceId, cfg.templateId, templateParams, cfg.publicKey);
    return true;
  } catch (e) {
    console.warn("EmailJS:", e);
    return false;
  }
}

/** Aviso al párroco/admin general de una solicitud nueva. */
export async function avisarSolicitudAParroquia({ nombre, email, comunidad, rolPedido, codigo, motivo }) {
  const subject = "[Monte Carmelo] Solicitud de acceso — " + nombre;
  const body =
    "Nueva solicitud de acceso al sitio parroquial.\n\n" +
    "Nombre: " +
    nombre +
    "\nCorreo: " +
    email +
    "\nComunidad: " +
    comunidad +
    "\nRol pedido: " +
    rolPedido +
    "\nMotivo: " +
    (motivo || "—") +
    "\n\nCódigo de verificación (6 dígitos): " +
    codigo +
    "\n\nEntrá a Identificarse → Panel de responsables para aceptar o rechazar.\n";

  const ok = await viaEmailJs({
    to_email: CORREO_PARROQUIA,
    subject,
    message: body,
    codigo,
    from_name: nombre,
    reply_to: email
  });
  if (!ok) mailto(CORREO_PARROQUIA, subject, body);
  return { ok: true, via: ok ? "emailjs" : "mailto" };
}

/** Confirmación al solicitante (recibida). */
export async function avisarSolicitudRecibida({ nombre, email }) {
  const subject = "[Monte Carmelo] Solicitud recibida";
  const body =
    "Hola " +
    nombre +
    ",\n\n" +
    "Recibimos tu solicitud para colaborar / administrar en el sitio de la Parroquia " +
    "Nuestra Señora del Monte Carmelo.\n\n" +
    "El administrador general (o el segundo responsable) la revisará. " +
    "Te escribiremos a este correo cuando sea aceptada o rechazada.\n\n" +
    "Parroquia Monte Carmelo\n";
  const ok = await viaEmailJs({
    to_email: email,
    subject,
    message: body,
    from_name: "Monte Carmelo"
  });
  if (!ok) mailto(email, subject, body);
  return { via: ok ? "emailjs" : "mailto" };
}

/** Aceptación: clave temporal al usuario + copia a parroquia. */
export async function avisarAceptacion({ nombre, email, claveTemporal, rol, comunidad }) {
  const subjectUser = "[Monte Carmelo] Acceso aceptado — clave temporal";
  const bodyUser =
    "Hola " +
    nombre +
    ",\n\n" +
    "Tu solicitud fue aceptada.\n\n" +
    "Correo: " +
    email +
    "\nRol: " +
    rol +
    "\nComunidad: " +
    comunidad +
    "\nClave temporal (primer ingreso): " +
    claveTemporal +
    "\n\nEntrá a Identificarse con tu nombre, apellido, correo y esta clave. " +
    "El sistema te pedirá crear tu propia clave.\n\n" +
    "Parroquia Monte Carmelo\n";

  const subjectAdmin = "[Monte Carmelo] Colaborador aceptado — " + nombre;
  const bodyAdmin =
    "Se aceptó el acceso de:\n\n" +
    nombre +
    " <" +
    email +
    ">\nRol: " +
    rol +
    "\nComunidad: " +
    comunidad +
    "\nClave temporal enviada al usuario: " +
    claveTemporal +
    "\n";

  await viaEmailJs({
    to_email: email,
    subject: subjectUser,
    message: bodyUser
  }).then((ok) => {
    if (!ok) mailto(email, subjectUser, bodyUser);
  });

  await viaEmailJs({
    to_email: CORREO_PARROQUIA,
    subject: subjectAdmin,
    message: bodyAdmin
  }).then((ok) => {
    if (!ok) mailto(CORREO_PARROQUIA, subjectAdmin, bodyAdmin);
  });
}

/** Baja comunicada al usuario y a la parroquia. */
export async function avisarBaja({ nombre, email, motivo, por }) {
  const subject = "[Monte Carmelo] Baja de acceso";
  const bodyUser =
    "Hola " +
    nombre +
    ",\n\n" +
    "Tu acceso al sitio parroquial fue dado de baja.\n" +
    "Motivo: " +
    (motivo || "—") +
    "\nRegistrado por: " +
    (por || "—") +
    "\n\nSi fue un error, escribinos a " +
    CORREO_PARROQUIA +
    ".\n\nParroquia Monte Carmelo\n";
  const bodyAdmin =
    "Baja registrada:\n" +
    nombre +
    " <" +
    email +
    ">\nMotivo: " +
    (motivo || "—") +
    "\nPor: " +
    (por || "—") +
    "\n";

  const okU = await viaEmailJs({ to_email: email, subject, message: bodyUser });
  if (!okU) mailto(email, subject, bodyUser);
  const okA = await viaEmailJs({
    to_email: CORREO_PARROQUIA,
    subject: subject + " — " + nombre,
    message: bodyAdmin
  });
  if (!okA) mailto(CORREO_PARROQUIA, subject + " — " + nombre, bodyAdmin);
}
