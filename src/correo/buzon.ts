import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config.js';
import { plataformaDelRemitente, type Plataforma } from './plataformas.js';

export type Alerta = { plataforma: Plataforma; asunto: string; fecha: Date | null; html: string };

/** Hasta dónde leímos: UIDVALIDITY del buzón + último UID procesado. */
export type Cursor = { validez: string; uid: number };

const DIAS_PRIMERA_VEZ = 3; // la primera vez no leemos todo el historial

/**
 * Lee las alertas de empleo NUEVAS del buzón, en MODO SOLO LECTURA:
 * no marca como leído, no mueve, no borra nada.
 *
 * Privacidad: primero se descargan solo los remitentes; el contenido se baja
 * únicamente de los correos que vienen de un portal de empleo.
 */
export async function leerAlertasNuevas(cursor: Cursor | undefined): Promise<{ alertas: Alerta[]; cursor: Cursor }> {
  if (!config.CORREO_USUARIO || !config.CORREO_CLAVE_APP) {
    throw new Error('Faltan CORREO_USUARIO y CORREO_CLAVE_APP en .env');
  }
  const cliente = new ImapFlow({
    host: config.CORREO_IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: config.CORREO_USUARIO, pass: config.CORREO_CLAVE_APP },
    logger: false, // la librería registra mucho detalle; no queremos credenciales ni correos en los logs
  });

  await cliente.connect();
  const candado = await cliente.getMailboxLock('INBOX', { readOnly: true });
  try {
    const buzon = cliente.mailbox;
    if (!buzon) throw new Error('No se pudo abrir la bandeja de entrada');
    const validez = String(buzon.uidValidity);

    // Si el servidor reinició la numeración (UIDVALIDITY cambió), el cursor viejo no sirve
    const cursorValido = cursor && cursor.validez === validez ? cursor : undefined;
    const consulta = cursorValido
      ? { uid: `${cursorValido.uid + 1}:*` }
      : { since: new Date(Date.now() - DIAS_PRIMERA_VEZ * 86_400_000) };
    const encontrados = (await cliente.search(consulta, { uid: true })) || [];
    // IMAP devuelve siempre el último correo con "X:*" aunque sea viejo: filtramos
    const uids = encontrados.filter((uid) => !cursorValido || uid > cursorValido.uid);
    const nuevoCursor = { validez, uid: Math.max(cursorValido?.uid ?? 0, ...uids, 0) };
    if (uids.length === 0) return { alertas: [], cursor: nuevoCursor };

    // 1) Solo remitentes (sobre)
    const deAlertas: { uid: number; plataforma: Plataforma }[] = [];
    for await (const correo of cliente.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
      const remitente = correo.envelope?.from?.[0]?.address ?? '';
      const plataforma = plataformaDelRemitente(remitente);
      if (plataforma) deAlertas.push({ uid: correo.uid, plataforma });
    }

    // 2) Contenido solo de las alertas de empleo
    const alertas: Alerta[] = [];
    for (const { uid, plataforma } of deAlertas) {
      const correo = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
      if (!correo || !correo.source) continue;
      const parseado = await simpleParser(correo.source);
      if (!parseado.html) continue; // las alertas siempre son HTML
      alertas.push({ plataforma, asunto: parseado.subject ?? '', fecha: parseado.date ?? null, html: parseado.html });
    }
    return { alertas, cursor: nuevoCursor };
  } finally {
    candado.release();
    await cliente.logout().catch(() => {});
  }
}
