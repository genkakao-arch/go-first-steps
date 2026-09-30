import { ATARI, ESCAPE, LIBERTIES } from './problems/basics';
import { CONNECT, CUT } from './problems/shape';
import { CHASE } from './problems/chase';
import { LIFE } from './problems/life';
import { TERRITORY } from './problems/territory';
import { PRACTICE } from './problems/practice';
import type { Problem } from './types';

export const PROBLEMS: Problem[] = [...LIBERTIES, ...ATARI, ...ESCAPE, ...CONNECT, ...CUT, ...CHASE, ...LIFE, ...TERRITORY, ...PRACTICE];
