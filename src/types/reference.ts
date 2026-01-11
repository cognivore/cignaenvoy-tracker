/**
 * Reference data types.
 * Countries, currencies, and other static reference data from Cigna Envoy.
 */

/**
 * Countries available in Cigna Envoy claims.
 * Source: "Where did you receive care?" dropdown in claims flow.
 * This is a subset of commonly used countries; full list has 200+ entries.
 */
export const COUNTRIES = [
  "AFGHANISTAN",
  "ALBANIA",
  "ALGERIA",
  "ARGENTINA",
  "AUSTRALIA",
  "AUSTRIA",
  "BELGIUM",
  "BRAZIL",
  "CANADA",
  "CHILE",
  "CHINA",
  "COLOMBIA",
  "CZECH REPUBLIC",
  "DENMARK",
  "EGYPT",
  "FINLAND",
  "FRANCE",
  "GERMANY",
  "GREECE",
  "HONG KONG",
  "HUNGARY",
  "INDIA",
  "INDONESIA",
  "IRELAND",
  "ISRAEL",
  "ITALY",
  "JAPAN",
  "KENYA",
  "KOREA, REPUBLIC OF",
  "KUWAIT",
  "LATVIA",
  "LEBANON",
  "LITHUANIA",
  "LUXEMBOURG",
  "MALAYSIA",
  "MEXICO",
  "NETHERLANDS, THE",
  "NEW ZEALAND",
  "NIGERIA",
  "NORWAY",
  "PAKISTAN",
  "PERU",
  "PHILIPPINES",
  "POLAND",
  "PORTUGAL",
  "QATAR",
  "ROMANIA",
  "RUSSIAN FEDERATION",
  "SAUDI ARABIA",
  "SINGAPORE",
  "SOUTH AFRICA",
  "SPAIN",
  "SWEDEN",
  "SWITZERLAND",
  "TAIWAN, PROVINCE OF CHINA",
  "THAILAND",
  "TURKEY",
  "UKRAINE",
  "UNITED ARAB EMIRATES",
  "UNITED KINGDOM",
  "UNITED STATES",
  "VIETNAM",
] as const;

export type Country = (typeof COUNTRIES)[number] | string;

/**
 * Currencies available in Cigna Envoy claims.
 * Source: Currency dropdown in claims flow.
 * This is a subset of commonly used currencies; full list has 150+ entries.
 */
export const CURRENCIES = [
  "AFGHANISTAN AFGHANI",
  "AUSTRALIAN DOLLAR",
  "BRAZILIAN REAL",
  "BRITISH POUND STERLING",
  "CANADIAN DOLLAR",
  "CHINA YUAN RENMINBI",
  "CZECH KORUNA",
  "DANISH KRONE",
  "EGYPTIAN POUND",
  "EUROPEAN MONETARY UNION EURO",
  "HONG KONG DOLLAR",
  "HUNGARIAN FORINT",
  "INDIAN RUPEE",
  "INDONESIAN RUPIAH",
  "ISRAELI SHEKEL",
  "JAPANESE YEN",
  "KENYAN SHILLING",
  "KOREAN WON",
  "KUWAITI DINAR",
  "LATVIAN LAT",
  "LEBANESE POUND",
  "MALAYSIAN RINGGIT",
  "MEXICAN PESO",
  "NEW ZEALAND DOLLAR",
  "NIGERIAN NAIRA",
  "NORWEGIAN KRONE",
  "PAKISTAN RUPEE",
  "PHILIPPINE PESO",
  "POLISH ZLOTY",
  "QATARI RIAL",
  "ROMANIAN LEU",
  "RUSSIAN ROUBLE",
  "SAUDI ARABIAN RIYAL",
  "SINGAPORE DOLLAR",
  "SOUTH AFRICAN RAND",
  "SWEDISH KRONA",
  "SWISS FRANC",
  "TAIWAN DOLLAR",
  "THAI BAHT",
  "TURKISH LIRA",
  "UAE DIRHAM",
  "UKRAINIAN HRYVNIA",
  "US DOLLAR",
  "VIETNAMESE DONG",
] as const;

export type Currency = (typeof CURRENCIES)[number] | string;

/**
 * Common currency codes for quick lookup.
 */
export const CURRENCY_CODES: Record<string, string> = {
  EUR: "EUROPEAN MONETARY UNION EURO",
  GBP: "BRITISH POUND STERLING",
  USD: "US DOLLAR",
  JPY: "JAPANESE YEN",
  CHF: "SWISS FRANC",
  CAD: "CANADIAN DOLLAR",
  AUD: "AUSTRALIAN DOLLAR",
  NZD: "NEW ZEALAND DOLLAR",
  CNY: "CHINA YUAN RENMINBI",
  HKD: "HONG KONG DOLLAR",
  SGD: "SINGAPORE DOLLAR",
  INR: "INDIAN RUPEE",
  PLN: "POLISH ZLOTY",
  CZK: "CZECH KORUNA",
  SEK: "SWEDISH KRONA",
  NOK: "NORWEGIAN KRONE",
  DKK: "DANISH KRONE",
};

/**
 * Network types available in Cigna Envoy.
 * Source: Account profile page.
 */
export const NETWORKS = [
  "CHC PPO",
  "CHC HMO",
  "Global",
] as const;

export type Network = (typeof NETWORKS)[number] | string;
