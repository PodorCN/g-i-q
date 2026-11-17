import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../frontend/App';
import { SnapshotSchema } from '../shared/schema';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
vi.mock('../frontend/useSnapshot', () => ({
  useSnapshot: () => ({
    snapshot,
    status: 'live',
    error: '',
    refreshing: false,
    history: [],
    historyId: '',
    load: vi.fn(),
  }),
}));

function render(search = '') {
  vi.stubGlobal('window', {
    location: { search },
    matchMedia: () => ({ matches: false }),
  });
  return renderToStaticMarkup(<App />);
}
afterEach(() => vi.unstubAllGlobals());

describe('Initial map selection', () => {
  it.each(['', '?point=all'])('opens %s with every house range and no selected point', (query) => {
    const html = render(query);
    expect(html.match(/class="interpretation-range"/g)).toHaveLength(
      snapshot.points.filter((p) => p.kind === 'institution').length,
    );
    expect(html).not.toContain('class="scatter-point selected-point"');
    expect(html).toContain('data-range-kind="data"');
    expect(html).toContain('value="all" selected=""');
  });

  it('preserves a linked broker or data selection rather than overriding it with the default', () => {
    const house = snapshot.points.find((p) => p.kind === 'institution')!;
    const html = render(`?point=${house.id}`);
    expect(html.match(/class="interpretation-range"/g)).toHaveLength(1);
    expect(html).toContain(`data-point-id="${house.id}"`);
    expect(html).toContain('class="scatter-point selected-point"');
    const dataHtml = render('?point=hard-data');
    expect(dataHtml).not.toContain('class="interpretation-range"');
    expect(dataHtml).toContain('data-range-kind="data"');
    expect(dataHtml).toContain('class="scatter-point selected-point"');
  });
});
