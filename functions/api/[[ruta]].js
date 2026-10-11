// Todo lo que llega a /api y /api/… lo atiende servidor/api.js (también el WebSocket de las pantallas, /api/sala/…).
// Lo de /<parroquia>/api/… llega por functions/_middleware.js.
import { entrada } from '../../servidor/api.js';

export const onRequest = (ctx) => entrada(ctx);
