// Reduced from web-katrain's src/utils/gameLogic.ts: only what the vendored engine uses.
import type { Player } from '../types';

export const getOpponent = (player: Player): Player => (player === 'black' ? 'white' : 'black');
