// Páginas de cada parroquia (/<parroquia>/…), su manifest, su service worker y su logo; la raíz elige la parroquia
// y las direcciones de antes redirigen. Ver servidor/paginas.js.
import { atenderPagina } from '../servidor/paginas.js';

export const onRequest = (ctx) => atenderPagina(ctx);
