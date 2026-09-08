/* TEMPORARY AUDIT HARNESS (sim90) — 10 synthetic users. Not app code. */
export const SEASON_SEED = 20260902;
export const DAY1 = '2026-09-01';

const M = { width: 390, height: 844, mobile: true };
const D = { width: 1280, height: 860, mobile: false };

export const USERS = [
  { id: 1, tag: 'normal',   name: 'Олег',   birth: '1991-05-14', sex: 'male',   h: 181, w: 84.0, act: '1.55', ta: 'inter', days: 3, gym: [1,3,5], vp: D,
    active: 0.75, patience: 0.9, err: 0.05, reload: 0.05, dup: 0.03, explore: 0.15, netFlaky: 0, sessions: 1.2, weightRange: [60, 110] },
  { id: 2, tag: 'chaotic',  name: 'Даша',   birth: '1998-11-02', sex: 'female', h: 166, w: 58.5, act: '1.375', ta: 'novice', days: 3, gym: [1,3,6], vp: D,
    active: 0.7, patience: 0.4, err: 0.2, reload: 0.35, dup: 0.25, explore: 0.5, netFlaky: 0.03, sessions: 2.0, weightRange: [20, 60] },
  { id: 3, tag: 'power',    name: 'Ігор',   birth: '1987-02-20', sex: 'male',   h: 178, w: 92.0, act: '1.725', ta: 'adv', days: 5, gym: [1,2,3,4,5], vp: D,
    active: 0.95, patience: 0.95, err: 0.03, reload: 0.05, dup: 0.02, explore: 0.8, netFlaky: 0, sessions: 2.5, weightRange: [80, 160] },
  { id: 4, tag: 'mobile',   name: 'Соломія',birth: '2001-07-09', sex: 'female', h: 170, w: 63.0, act: '1.55', ta: 'inter', days: 4, gym: [1,2,4,5], vp: M,
    active: 0.8, patience: 0.6, err: 0.1, reload: 0.15, dup: 0.15, explore: 0.3, netFlaky: 0.05, sessions: 1.8, weightRange: [30, 80] },
  { id: 5, tag: 'impatient',name: 'Макс',   birth: '1995-09-30', sex: 'male',   h: 175, w: 77.0, act: '1.55', ta: 'inter', days: 4, gym: [1,2,4,6], vp: M,
    active: 0.65, patience: 0.1, err: 0.1, reload: 0.4, dup: 0.6, explore: 0.2, netFlaky: 0.02, sessions: 1.5, weightRange: [50, 120] },
  { id: 6, tag: 'dataheavy',name: 'Роман',  birth: '1983-12-11', sex: 'male',   h: 184, w: 96.5, act: '1.375', ta: 'adv', days: 6, gym: [1,2,3,4,5,6], vp: D,
    active: 0.97, patience: 0.9, err: 0.04, reload: 0.05, dup: 0.03, explore: 0.5, netFlaky: 0, sessions: 3.0, weightRange: [60, 180] },
  { id: 7, tag: 'errorprone',name: 'Аня',   birth: '1999-03-03', sex: 'female', h: 162, w: 55.0, act: '1.2', ta: 'novice', days: 3, gym: [2,4,6], vp: D,
    active: 0.6, patience: 0.6, err: 0.7, reload: 0.1, dup: 0.1, explore: 0.3, netFlaky: 0, sessions: 1.3, weightRange: [10, 50] },
  { id: 8, tag: 'forgetful',name: 'Тарас',  birth: '1979-08-25', sex: 'male',   h: 176, w: 88.0, act: '1.2', ta: 'inter', days: 3, gym: [1,3,5], vp: D,
    active: 0.35, patience: 0.7, err: 0.08, reload: 0.3, dup: 0.05, explore: 0.1, netFlaky: 0.1, sessions: 1.0, weightRange: [40, 100], forgetful: true },
  { id: 9, tag: 'experimenter',name:'Юля',  birth: '1993-01-17', sex: 'female', h: 168, w: 61.0, act: '1.55', ta: 'inter', days: 4, gym: [1,2,4,5], vp: D,
    active: 0.8, patience: 0.8, err: 0.1, reload: 0.1, dup: 0.05, explore: 0.95, netFlaky: 0, sessions: 1.7, weightRange: [30, 90] },
  { id: 10,tag: 'worstcase',name: 'Влад',   birth: '1996-06-06', sex: 'male',   h: 172, w: 80.0, act: '1.725', ta: 'inter', days: 5, gym: [1,2,3,5,6], vp: M,
    active: 0.85, patience: 0.2, err: 0.35, reload: 0.4, dup: 0.4, explore: 0.6, netFlaky: 0.08, sessions: 2.5, weightRange: [30, 140], forgetful: true }
];
