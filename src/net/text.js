// Texts the headsets and the teacher screen share (no three.js here: the teacher screen imports this too).
import { t } from '../i18n.js';
import { TEAM_NAMES } from '../../server/challenges.mjs';

/** "Level 1 · Crambin" / "Level 3 · Shadow 2" (Level 3 never names the protein: the class would see the answer) */
export function challengeTitle(ch, short = false) {
  if (!ch) return '';
  const what = ch.level === 0 ? t('play.title') : ch.level === 3 ? t('l3.shadow', { i: ch.idx + 1 }) : t(`p.${ch.name}.name`);
  return short ? what : `${t('level', { n: ch.level })} · ${what}`;
}

/** Default team names are translated; names typed by the teacher are shown as they are. */
export const teamName = (tm) => (TEAM_NAMES.includes(tm.name) ? t(`team.${tm.name}`) : tm.name);
