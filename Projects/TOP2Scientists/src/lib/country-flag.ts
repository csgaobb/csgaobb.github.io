const COUNTRIES: Record<string, { name: string; flag: string }> = {
  afg: { name: "Afghanistan", flag: "🇦🇫" },
  alb: { name: "Albania", flag: "🇦🇱" },
  dza: { name: "Algeria", flag: "🇩🇿" },
  and: { name: "Andorra", flag: "🇦🇩" },
  arg: { name: "Argentina", flag: "🇦🇷" },
  arm: { name: "Armenia", flag: "🇦🇲" },
  asm: { name: "American Samoa", flag: "🇦🇸" },
  atg: { name: "Antigua and Barbuda", flag: "🇦🇬" },
  aus: { name: "Australia", flag: "🇦🇺" },
  aut: { name: "Austria", flag: "🇦🇹" },
  aze: { name: "Azerbaijan", flag: "🇦🇿" },
  bhr: { name: "Bahrain", flag: "🇧🇭" },
  bgd: { name: "Bangladesh", flag: "🇧🇩" },
  brb: { name: "Barbados", flag: "🇧🇧" },
  blr: { name: "Belarus", flag: "🇧🇾" },
  bel: { name: "Belgium", flag: "🇧🇪" },
  ben: { name: "Benin", flag: "🇧🇯" },
  bmu: { name: "Bermuda", flag: "🇧🇲" },
  bih: { name: "Bosnia and Herzegovina", flag: "🇧🇦" },
  bwa: { name: "Botswana", flag: "🇧🇼" },
  bra: { name: "Brazil", flag: "🇧🇷" },
  brn: { name: "Brunei", flag: "🇧🇳" },
  bgr: { name: "Bulgaria", flag: "🇧🇬" },
  bfa: { name: "Burkina Faso", flag: "🇧🇫" },
  khm: { name: "Cambodia", flag: "🇰🇭" },
  cmr: { name: "Cameroon", flag: "🇨🇲" },
  can: { name: "Canada", flag: "🇨🇦" },
  chl: { name: "Chile", flag: "🇨🇱" },
  chn: { name: "China", flag: "🇨🇳" },
  col: { name: "Colombia", flag: "🇨🇴" },
  cog: { name: "Congo", flag: "🇨🇬" },
  cod: { name: "DR Congo", flag: "🇨🇩" },
  cri: { name: "Costa Rica", flag: "🇨🇷" },
  civ: { name: "Côte d'Ivoire", flag: "🇨🇮" },
  hrv: { name: "Croatia", flag: "🇭🇷" },
  cub: { name: "Cuba", flag: "🇨🇺" },
  cuw: { name: "Curaçao", flag: "🇨🇼" },
  cyp: { name: "Cyprus", flag: "🇨🇾" },
  cze: { name: "Czech Republic", flag: "🇨🇿" },
  dnk: { name: "Denmark", flag: "🇩🇰" },
  ecu: { name: "Ecuador", flag: "🇪🇨" },
  egy: { name: "Egypt", flag: "🇪🇬" },
  est: { name: "Estonia", flag: "🇪🇪" },
  eth: { name: "Ethiopia", flag: "🇪🇹" },
  fin: { name: "Finland", flag: "🇫🇮" },
  fra: { name: "France", flag: "🇫🇷" },
  geo: { name: "Georgia", flag: "🇬🇪" },
  deu: { name: "Germany", flag: "🇩🇪" },
  gha: { name: "Ghana", flag: "🇬🇭" },
  grc: { name: "Greece", flag: "🇬🇷" },
  hkg: { name: "Hong Kong", flag: "🇭🇰" },
  hun: { name: "Hungary", flag: "🇭🇺" },
  isl: { name: "Iceland", flag: "🇮🇸" },
  ind: { name: "India", flag: "🇮🇳" },
  idn: { name: "Indonesia", flag: "🇮🇩" },
  irn: { name: "Iran", flag: "🇮🇷" },
  irq: { name: "Iraq", flag: "🇮🇶" },
  irl: { name: "Ireland", flag: "🇮🇪" },
  isr: { name: "Israel", flag: "🇮🇱" },
  ita: { name: "Italy", flag: "🇮🇹" },
  jpn: { name: "Japan", flag: "🇯🇵" },
  jor: { name: "Jordan", flag: "🇯🇴" },
  kaz: { name: "Kazakhstan", flag: "🇰🇿" },
  ken: { name: "Kenya", flag: "🇰🇪" },
  kor: { name: "South Korea", flag: "🇰🇷" },
  kwt: { name: "Kuwait", flag: "🇰🇼" },
  lva: { name: "Latvia", flag: "🇱🇻" },
  lbn: { name: "Lebanon", flag: "🇱🇧" },
  ltu: { name: "Lithuania", flag: "🇱🇹" },
  lux: { name: "Luxembourg", flag: "🇱🇺" },
  mac: { name: "Macao", flag: "🇲🇴" },
  mys: { name: "Malaysia", flag: "🇲🇾" },
  mex: { name: "Mexico", flag: "🇲🇽" },
  mar: { name: "Morocco", flag: "🇲🇦" },
  nld: { name: "Netherlands", flag: "🇳🇱" },
  nzl: { name: "New Zealand", flag: "🇳🇿" },
  nga: { name: "Nigeria", flag: "🇳🇬" },
  nor: { name: "Norway", flag: "🇳🇴" },
  omn: { name: "Oman", flag: "🇴🇲" },
  pak: { name: "Pakistan", flag: "🇵🇰" },
  pse: { name: "Palestine", flag: "🇵🇸" },
  per: { name: "Peru", flag: "🇵🇪" },
  phl: { name: "Philippines", flag: "🇵🇭" },
  pol: { name: "Poland", flag: "🇵🇱" },
  prt: { name: "Portugal", flag: "🇵🇹" },
  qat: { name: "Qatar", flag: "🇶🇦" },
  rou: { name: "Romania", flag: "🇷🇴" },
  rus: { name: "Russia", flag: "🇷🇺" },
  sau: { name: "Saudi Arabia", flag: "🇸🇦" },
  srb: { name: "Serbia", flag: "🇷🇸" },
  sgp: { name: "Singapore", flag: "🇸🇬" },
  svk: { name: "Slovakia", flag: "🇸🇰" },
  svn: { name: "Slovenia", flag: "🇸🇮" },
  zaf: { name: "South Africa", flag: "🇿🇦" },
  esp: { name: "Spain", flag: "🇪🇸" },
  lka: { name: "Sri Lanka", flag: "🇱🇰" },
  swe: { name: "Sweden", flag: "🇸🇪" },
  che: { name: "Switzerland", flag: "🇨🇭" },
  twn: { name: "Taiwan", flag: "🇹🇼" },
  tha: { name: "Thailand", flag: "🇹🇭" },
  tun: { name: "Tunisia", flag: "🇹🇳" },
  tur: { name: "Türkiye", flag: "🇹🇷" },
  ukr: { name: "Ukraine", flag: "🇺🇦" },
  are: { name: "United Arab Emirates", flag: "🇦🇪" },
  gbr: { name: "United Kingdom", flag: "🇬🇧" },
  usa: { name: "United States", flag: "🇺🇸" },
  ury: { name: "Uruguay", flag: "🇺🇾" },
  uzb: { name: "Uzbekistan", flag: "🇺🇿" },
  ven: { name: "Venezuela", flag: "🇻🇪" },
  vnm: { name: "Vietnam", flag: "🇻🇳" },
};

const BY_NAME = Object.fromEntries(
  Object.values(COUNTRIES).map((item) => [item.name.toLowerCase(), item]),
);

function lookup(country: string) {
  const key = country.trim().toLowerCase();
  return COUNTRIES[key] ?? BY_NAME[key] ?? null;
}

export function countryFlag(country: string) {
  return lookup(country)?.flag ?? "";
}

export function countryLabel(country: string) {
  if (!country) return "";
  return lookup(country)?.name ?? country;
}

export function matchCountryCodes(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const codes: string[] = [];
  for (const [code, item] of Object.entries(COUNTRIES)) {
    const name = item.name.toLowerCase();
    if (code === needle || name === needle || code.startsWith(needle) || name.startsWith(needle)) {
      codes.push(code.toUpperCase());
    }
  }
  return codes.slice(0, 20);
}
