import { Parser } from 'htmlparser2';
import { XMLParser } from 'fast-xml-parser';
import type { CommentarySource } from './sources';

const IGNORED = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'header',
  'footer',
  'form',
  'button',
]);
export function articleText(html: string): string {
  const all: string[] = [],
    main: string[] = [];
  let ignoredDepth = 0,
    mainDepth = 0;
  const stack: { ignored: boolean; main: boolean }[] = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const ignored = IGNORED.has(name);
        const inMain = name === 'main' || name === 'article';
        stack.push({ ignored, main: inMain });
        if (ignored) ignoredDepth++;
        if (inMain) mainDepth++;
        if (!ignoredDepth && /^(p|div|li|h[1-6]|br)$/.test(name)) {
          all.push('\n');
          if (mainDepth) main.push('\n');
        }
      },
      ontext(text) {
        if (!ignoredDepth) {
          all.push(text);
          if (mainDepth) main.push(text);
        }
      },
      onclosetag() {
        const entry = stack.pop();
        if (entry?.ignored) ignoredDepth--;
        if (entry?.main) mainDepth--;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  const mainLength = main.join(' ').replace(/\s+/g, ' ').trim().length;
  const allLength = all.join(' ').replace(/\s+/g, ' ').trim().length;
  // A short template shell must not hide a substantive sibling article.
  return (mainLength > 1200 || (mainLength > 350 && allLength < mainLength * 2) ? main : all)
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, 70_000);
}

export function normalizeDate(raw: string | null | undefined, asOf: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  // Ambiguous numeric dates are deliberately not guessed (US vs international).
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cleaned)) return null;
  const dateOnly =
    /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ||
    /^(?:\d{1,2}\s+)?[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}$/.test(cleaned);
  // A date without a time is a calendar date, not midnight UTC (the prior day in ET).
  const parsed = Date.parse(dateOnly ? cleaned + ' 12:00:00 GMT' : cleaned);
  if (
    !Number.isFinite(parsed) ||
    parsed > Date.parse(asOf) + 86_400_000 ||
    parsed < Date.UTC(2000, 0, 1)
  )
    return null;
  return new Date(parsed).toISOString();
}
export function metadata(
  html: string,
  text: string,
  asOf: string,
): { title: string; date: string | null } {
  let title = '',
    date: string | null = null;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    const object = value as Record<string, unknown>;
    if (typeof object.headline === 'string') title ||= object.headline;
    if (typeof object.datePublished === 'string')
      date ||= normalizeDate(object.datePublished, asOf);
    // dateModified is not a publication date.
    if (object['@graph']) visit(object['@graph']);
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* malformed publisher metadata */
    }
  }
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'meta') {
        const key = attrs.property || attrs.name || attrs.itemprop || '';
        if (
          /^(article:published_time|datePublished|pubdate|publishdate|publication_date|DC.date.issued)$/i.test(
            key,
          )
        )
          date ||= normalizeDate(attrs.content, asOf);
        if (key === 'og:title') title ||= attrs.content || '';
      }
      if (name === 'time' && attrs.datetime) date ||= normalizeDate(attrs.datetime, asOf);
    },
  });
  parser.write(html);
  parser.end();
  title ||=
    articleText(html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i)?.[0] || '') ||
    html.match(/<title[^>]*>([^<]+)/i)?.[1] ||
    'Market commentary';
  if (!date) {
    // Only inspect the beginning: a bibliography or calendar date is not publication.
    const match = text
      .slice(0, 1400)
      .match(
        /(?:Published(?: as of)?\s*:?\s*)?\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})\b/i,
      );
    if (match) date = normalizeDate(match[1], asOf);
  }
  return { title: articleText(title).trim(), date };
}

export function discoverLinks(html: string, source: CommentarySource): string[] {
  const links: string[] = [];
  const pattern = new RegExp(source.linkPattern || '.');
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name !== 'a' || !attrs.href) return;
      try {
        const url = new URL(attrs.href, source.url);
        if (url.hostname !== new URL(source.url).hostname || !pattern.test(url.pathname)) return;
        url.search = '';
        url.hash = '';
        if (!links.includes(url.href)) links.push(url.href);
      } catch {
        /* invalid publisher link */
      }
    },
  });
  parser.write(html);
  parser.end();
  return links.slice(0, 3);
}

export function parseFeed(
  xml: string,
): { title: string; url: string; date: string | null; text: string }[] {
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  return (Array.isArray(items) ? items : [items])
    .slice(0, 8)
    .map((item: Record<string, unknown>) => ({
      title: String(item.title || 'Official release'),
      url:
        typeof item.link === 'string'
          ? item.link
          : String((item.link as Record<string, string>)?.['@_href'] || ''),
      date:
        typeof (item.pubDate || item.published) === 'string'
          ? String(item.pubDate || item.published)
          : null,
      text: articleText(String(item.description || item.summary || '')),
    }))
    .filter((item) => /^https:\/\//.test(item.url));
}
