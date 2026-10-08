// Todo lo que llega a /api y /api/… lo atiende servidor/api.js
import { atender } from '../../servidor/api.js';

export const onRequest = (ctx) => atender(ctx);
