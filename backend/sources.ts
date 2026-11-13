export interface CommentarySource {
  id: string;
  name: string;
  shortName: string;
  color: string;
  url: string;
  mode: 'article' | 'index' | 'rss';
  type: 'commentary' | 'news';
  linkPattern?: string;
  fallbackUrls?: string[];
  maxAgeDays?: number;
}

// Edit this catalog and redeploy only the Worker to change research coverage.
// Publication dates must come from the fetched document; retrieval is never publication.
export const COMMENTARY_SOURCES: CommentarySource[] = [
  {
    id: 'blackrock',
    name: 'BlackRock Investment Institute',
    shortName: 'BlackRock',
    color: '#287b78',
    mode: 'article',
    type: 'commentary',
    url: 'https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary',
    fallbackUrls: [
      'https://www.blackrock.com/corporate/insights/blackrock-investment-institute/global-weekly-commentary',
    ],
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    shortName: 'Schwab',
    color: '#4268ca',
    mode: 'article',
    type: 'commentary',
    url: 'https://www.schwab.com/learn/story/stock-market-update-open',
    fallbackUrls: [
      'https://international.schwab.com/story/stock-market-update-open',
      'https://www.schwab.com/learn/story/weekly-traders-outlook',
    ],
  },
  {
    id: 'jpmorgan',
    name: 'J.P. Morgan Asset Management',
    shortName: 'J.P. Morgan',
    color: '#b77a44',
    mode: 'article',
    type: 'commentary',
    url: 'https://am.jpmorgan.com/au/en/asset-management/adv/insights/market-insights/monthly-market-review/',
  },
  {
    id: 'pimco',
    name: 'PIMCO',
    shortName: 'PIMCO',
    color: '#8870af',
    mode: 'index',
    type: 'commentary',
    url: 'https://www.pimco.com/us/en/insights',
    linkPattern: '/us/en/insights/(?!authors|topics|$)[a-z0-9-]+/?$',
    maxAgeDays: 90,
    fallbackUrls: ['https://www.pimco.com/us/en/insights/growth-holds-risks-widen'],
  },
  {
    id: 'goldman',
    name: 'Goldman Sachs',
    shortName: 'Goldman Sachs',
    color: '#698eaf',
    mode: 'index',
    type: 'commentary',
    url: 'https://www.goldmansachs.com/insights/macroeconomics',
    linkPattern: '/insights/(?:articles|goldman-sachs-exchanges)/[a-z0-9-]+/?$',
    maxAgeDays: 90,
    fallbackUrls: [
      'https://www.goldmansachs.com/insights/goldman-sachs-exchanges/john-waldron-on-gdp-growth-ai-and-the-m-a-outlook',
    ],
  },
  {
    id: 'ing',
    name: 'ING Research',
    shortName: 'ING',
    color: '#c4784a',
    mode: 'index',
    type: 'commentary',
    url: 'https://think.ing.com/latest/',
    linkPattern: '/articles/(?:[^/]*(?:us-|united-states|fed-|inflation)[^/]*)/?$',
    maxAgeDays: 60,
    fallbackUrls: [
      'https://think.ing.com/articles/solid-growth-cooling-inflation-3-calls-for-the-us/',
    ],
  },
  {
    id: 'vanguard',
    name: 'Vanguard Economics',
    shortName: 'Vanguard',
    color: '#ac4f60',
    mode: 'article',
    type: 'commentary',
    maxAgeDays: 60,
    url: 'https://corporate.vanguard.com/content/corporatesite/us/en/corp/vemo/vemo-united-states.html',
  },
  {
    id: 'morgan-stanley',
    name: 'Morgan Stanley Investment Management',
    shortName: 'Morgan Stanley',
    color: '#608a9a',
    mode: 'index',
    type: 'commentary',
    maxAgeDays: 60,
    url: 'https://www.morganstanley.com/im/en-us/institutional-investor/insights/all-insights.html',
    linkPattern: '/insights/(?:takeaways-key-expectations|carons-corner|articles)/.+',
  },
  {
    id: 'fed-news',
    name: 'Federal Reserve monetary releases',
    shortName: 'Federal Reserve',
    color: '#637987',
    mode: 'rss',
    type: 'news',
    url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
  },
];

export const SERIES = [
  {
    id: 'CES0000000001',
    name: 'Nonfarm payrolls',
    axis: 'growth' as const,
    transform: 'payroll' as const,
    unit: 'K jobs / month',
  },
  {
    id: 'CES0500000034',
    name: 'Private aggregate weekly hours',
    axis: 'growth' as const,
    transform: 'annualized' as const,
    unit: '% annualized',
  },
  {
    id: 'LNS14000000',
    name: 'Unemployment, inverted',
    axis: 'growth' as const,
    transform: 'unemployment' as const,
    unit: 'pp / 3 months',
  },
  {
    id: 'CUSR0000SA0',
    name: 'Headline CPI',
    axis: 'inflation' as const,
    transform: 'annualized' as const,
    unit: '% annualized',
  },
  {
    id: 'CUSR0000SA0L1E',
    name: 'Core CPI',
    axis: 'inflation' as const,
    transform: 'annualized' as const,
    unit: '% annualized',
  },
];
