const MOD_ANCHOR = /완장|파딱|주딱|딱지|매니저|부매니저|운영진|관리자/u;
const MOD_EXACT = /완장\s*고로시|완장고로시|파딱\s*고로시|파딱고로시|주딱\s*고로시|주딱고로시|운영\s*(방해|흔들)|운영진을\s*흔들|완장\s*수\s*선동|친목완장욕|완장\s*대체|파딱\s*대체|주딱\s*대체|운영진\s*대체/u;
const MOD_ATTACK = /무능|에고|권력남용|천안문|공포정치|근첩|좆목|친목\s*완장|친목완장|네임드화|지우개|롤플레잉|해임|내려가라|내려가야|내려와|내려오|사퇴|관리\s*뭐함|완장\s*뭐함|파딱\s*뭐함|주딱\s*뭐함|니가\s*뭔데|완장질/u;
const MOD_MOBILIZE = /여론|선동|물타기|개추|추천|투표|갤\s*망|망한다|다같이|하루종일|계속|반복|또|파생글|장작|끌올|스크랩/u;
const MOD_SAFE_CONTEXT = /새\s*부매니저|명령어|@특갤봇|특갤봇|완장분들\s*파이팅|파이팅|수고|감사|AI\s*파딱|ai\s*파딱|인공지능\s*파딱|파딱\s*우대|매니저탭|가이드|규정\s*복습|죄송|사과|확인했습니다|완장\s*하지\s*마세요/u;

export interface ModGoroSignal {
  mention: boolean;
  exact: boolean;
  attack: boolean;
  mobilize: boolean;
  safeContext: boolean;
  signal: boolean;
  strongSignal: boolean;
  safeOnly: boolean;
}

function hasNearPair(text: string, left: RegExp, right: RegExp, window = 80): boolean {
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    const slice = chars.slice(index, index + window).join("");
    if (left.test(slice) && right.test(slice)) return true;
  }
  return false;
}

export function detectModGoro(text: string): ModGoroSignal {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  const mention = MOD_ANCHOR.test(normalized);
  const exact = MOD_EXACT.test(normalized);
  const attack = hasNearPair(normalized, MOD_ANCHOR, MOD_ATTACK);
  const mobilize = MOD_MOBILIZE.test(normalized);
  const safeContext = MOD_SAFE_CONTEXT.test(normalized);
  const signal = exact || (mention && attack);
  const strongSignal = exact || (mention && attack && mobilize);
  const safeOnly = mention && safeContext && !exact && !attack && !mobilize;
  return { mention, exact, attack, mobilize, safeContext, signal, strongSignal, safeOnly };
}
