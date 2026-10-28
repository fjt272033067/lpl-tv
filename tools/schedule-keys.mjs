/* =====================================================================
 * schedule-keys.mjs — 赛程比对口径（腾讯上游 vs 本站快照）
 *
 * 为什么需要单独一份：腾讯上游的「全量对阵表」里，TeamShortNameA/B 经常是空的
 * （真正可靠的是 bMatchName 里的「A vs B」），而本站快照是构建期从同一份数据解析的。
 * 两边要能逐场比对，必须先归一化成同一套键，否则会出现「缺 6 / 多 8」这种假差异。
 *
 * 键的构成：日期 + 排序后的队伍组合
 *   - 有明确对阵的行：2026-10-29|MKOI-T1
 *   - 还没定对手的占位行（官方就叫 D8G1 / 八进四第一场 / 总决赛）：
 *     2026-11-01|D8G1、2026-11-04|八进四第一场
 * ===================================================================== */

/** 归一化队名：去符号、保留中英文数字 */
export function normTeam(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');
}

/** 一场比赛的键 */
export function pairKey(date, a, b) {
  const teams = [normTeam(a), normTeam(b)].filter(Boolean).sort();
  return String(date || '').slice(0, 10) + '|' + teams.join('-');
}

/** 腾讯上游的键集合 */
export function upstreamKeys(list, cutoff) {
  const out = new Set();
  for (const x of list || []) {
    const d = String(x.MatchDate || '').slice(0, 10);
    if (d < cutoff) continue;
    const nm = String(x.bMatchName || '');
    const m = nm.toUpperCase().match(/([A-Z][A-Z0-9]{1,7})\s*VS\.?\s*([A-Z][A-Z0-9]{1,7})/);
    if (m) out.add(pairKey(d, m[1], m[2]));
    else if (nm) out.add(pairKey(d, nm, '')); // 占位行（D8G1 / 八进四第一场 / 总决赛）
  }
  return out;
}

/** 本站快照的键集合 */
export function localKeys(matches, cutoff) {
  const out = new Set();
  for (const m of matches || []) {
    const d = String(m.date || '').slice(0, 10);
    if (d < cutoff) continue;
    out.add(pairKey(d, m.teamA, m.teamB));
  }
  return out;
}

/** 今天（本地时区）的日期串 */
export function todayKey(now) {
  const d = now ? new Date(now) : new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
