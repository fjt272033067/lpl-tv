/** 查腾讯队徽字段（GEN / BLG） */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
const res = await fetch('https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js', {
  headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' },
});
const t = await res.text();
const m = t.match(/var\s+TeamList\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
const j = JSON.parse(m[1]);
for (const k in j.msg) {
  const x = j.msg[k];
  if (!x) continue;
  const short = String(x.TeamShortName || '');
  const name = String(x.TeamName || '');
  if (short === 'GEN' || short === 'BLG' || name === 'GEN' || name === 'BLG') {
    console.log(k, JSON.stringify({ TeamId: x.TeamId, TeamName: x.TeamName, TeamShortName: x.TeamShortName, TeamLogo: x.TeamLogo }));
  }
}
