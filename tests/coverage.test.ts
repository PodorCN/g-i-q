import { describe, expect, it } from 'vitest';
import { articleText, discoverLinks, linkedPdf, metadata } from '../backend/documents';
import { readPublic } from '../backend/http';
import { pdfArticle } from '../backend/pdf';
import { COMMENTARY_SOURCES } from '../backend/sources';

const now = '2026-11-13T19:00:00.000Z';
function fixturePdf(pages = 1) {
  const stream =
    'BT /F1 12 Tf 72 740 Td (November 13, 2026) Tj 0 -20 Td (We forecast US growth of 2.5% and core PCE inflation of 3.1%.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...Array.from(
      { length: pages },
      () =>
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>',
    ),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

describe('Broker coverage and publisher evidence', () => {
  it('tracks distinct research desks and explicit permitted report hosts', () => {
    const houses = COMMENTARY_SOURCES.filter((s) => s.type === 'commentary');
    expect(houses.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'ubs',
        'citi',
        'bofa',
        'wells-fargo',
        'td',
        'us-bank',
        'bnp-paribas',
        'pnc',
        'scotiabank',
      ]),
    );
    expect(new Set(houses.map((s) => s.id)).size).toBe(houses.length);
    expect(new Set(houses.map((s) => s.shortName)).size).toBe(houses.length);
    const wells = houses.find((s) => s.id === 'wells-fargo')!;
    const html =
      '<a href="https://www.wellsfargomedia.com/im/ps/research/wfii/wfii_reports/investment_strategy/report.pdf">Report</a><a href="https://evil.example/im/ps/research/wfii/wfii_reports/investment_strategy/report.pdf">Other</a>';
    expect(discoverLinks(html, wells)).toEqual([
      'https://www.wellsfargomedia.com/im/ps/research/wfii/wfii_reports/investment_strategy/report.pdf',
    ]);
    expect(linkedPdf('<a href="https://evil.example/a.pdf">Report</a>', wells.url)).toBeUndefined();
  });
  it('uses publication fields and unambiguous day-first headings', () => {
    expect(
      metadata('<pagedata id="publish_date-data">2026-11-05T05:21:00Z</pagedata>', '', now).date,
    ).toBe('2026-11-05T05:21:00.000Z');
    expect(metadata('<div class="page-heading__date">04 November 2026</div>', '', now).date).toBe(
      '2026-11-04T12:00:00.000Z',
    );
    expect(metadata('<time>10 November 2026, 17:50 pm</time>', '', now).date).toBe(
      '2026-11-10T12:00:00.000Z',
    );
    expect(metadata('', '4\nOctober 2026: services activity', now).date).toBeNull();
  });
  it('retains month precision without inventing a day, and never uses retrieval time', () => {
    expect(
      metadata('', 'November 2026\nMonthly economic outlook', now, { monthlyIssue: true }),
    ).toMatchObject({ date: '2026-11-01T12:00:00.000Z', datePrecision: 'month' });
    expect(metadata('', 'November 2026\nMonthly economic outlook', now).date).toBeNull();
    expect(
      metadata(
        '<meta property="article:modified_time" content="2026-11-12">',
        'Undated forecast',
        now,
      ).date,
    ).toBeNull();
  });
  it('uses verified report headers before dates in charts or forecast tables', () => {
    const bnp = COMMENTARY_SOURCES.find((s) => s.id === 'bnp-paribas')!;
    expect(metadata('', 'US growth\n13/11/2026 4\nOctober 2026: activity', now, bnp).date).toBe(
      '2026-11-13T12:00:00.000Z',
    );
    const wells = COMMENTARY_SOURCES.find((s) => s.id === 'wells-fargo')!;
    expect(
      metadata('', 'Chart data January 1, 2013\nInvestment Strategy | November 9, 2026', now, wells)
        .date,
    ).toBe('2026-11-09T12:00:00.000Z');
  });
  it('extracts a real PDF through the bounded public collector, including a MIME wrapper', async () => {
    const binary = fixturePdf();
    const wrapped = new Uint8Array(
      Buffer.concat([
        Buffer.from('--boundary\nContent-Disposition: form-data; filename=report.pdf\n\n'),
        binary,
      ]),
    );
    for (const body of [binary, wrapped]) {
      const fetcher = (async () =>
        new Response(body, { headers: { 'Content-Type': 'application/pdf' } })) as typeof fetch;
      const html = await readPublic('https://www.pnc.com/report.pdf', fetcher);
      const text = articleText(html);
      expect(text).toContain('growth of 2.5%');
      expect(text).toContain('core PCE inflation of 3.1%');
      expect(metadata(html, text, now).date).toBe('2026-11-13T12:00:00.000Z');
    }
  });
  it('rejects oversized page counts before extracting the document', async () => {
    await expect(pdfArticle(fixturePdf(41))).rejects.toThrow('40-page');
  });
});
