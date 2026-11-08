import { obtenerAjuste, guardarAjuste } from '../ajustes.js';
import { leerAlertasNuevas, type Cursor } from '../correo/buzon.js';
import { ofertasDelCorreo } from '../correo/extraer-links.js';
import { ErrorFuente, type LectorFuente, type OfertaLeida } from './tipos.js';

/**
 * Fuente "Correo": lee las alertas de empleo que te llegan (Computrabajo, Indeed,
 * elempleo, Magneto, LinkedIn) y convierte sus links en ofertas.
 * Es la forma legal de cubrir portales que NO se deben automatizar con navegador.
 */
export const correo: LectorFuente = {
  esperaMinimaMinutos: 5,
  filtrarPorRol: false, // las alertas ya vienen filtradas por lo que configuraste en cada portal

  async verificar() {
    try {
      const { alertas } = await leerAlertasNuevas(undefined); // solo prueba la conexión
      return { nombre: 'Correo', totalOfertas: alertas.length };
    } catch (error) {
      throw new ErrorFuente(`No pude abrir el correo: ${(error as Error).message}`);
    }
  },

  async leerOfertas() {
    const guardado = await obtenerAjuste('correo_cursor');
    let cursor: Cursor | undefined;
    try {
      cursor = guardado ? (JSON.parse(guardado) as Cursor) : undefined;
    } catch {
      cursor = undefined;
    }

    let resultado: Awaited<ReturnType<typeof leerAlertasNuevas>>;
    try {
      resultado = await leerAlertasNuevas(cursor);
    } catch (error) {
      // Mensaje claro, sin detalles que puedan incluir credenciales
      const mensaje = (error as Error).message;
      const pista = /auth|login|credentials|invalid/i.test(mensaje) ? 'Gmail rechazó el acceso: revisa CORREO_USUARIO y la contraseña de aplicación' : mensaje;
      throw new ErrorFuente(pista);
    }

    const ofertas: OfertaLeida[] = [];
    for (const alerta of resultado.alertas) {
      for (const o of ofertasDelCorreo(alerta.html, alerta.plataforma)) {
        ofertas.push({
          idExterno: `${alerta.plataforma.nombre}:${o.id}`,
          titulo: o.titulo,
          empresa: alerta.plataforma.nombre, // el correo no siempre dice la empresa
          ubicacion: null,
          url: o.url,
          publicadaEn: alerta.fecha,
          datosCrudos: { urlPostulacion: o.url, plataforma: alerta.plataforma.nombre, asunto: alerta.asunto.slice(0, 200) },
        });
      }
    }

    // Avanzamos el cursor: la próxima vez solo correos más nuevos
    await guardarAjuste('correo_cursor', JSON.stringify(resultado.cursor));
    return ofertas;
  },
};
