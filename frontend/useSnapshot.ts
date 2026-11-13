import { useEffect, useRef, useState } from 'react';
import { SnapshotSchema, type Snapshot } from '../shared/schema';

export type HistoryItem = { id: string; asOf: string; axisMode?: string };
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'saved' | 'demo' | 'error' | 'offline'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyId, setHistoryId] = useState('');
  const isDemo = useRef(new URLSearchParams(window.location.search).get('demo') === '1');
  const latestRequest = useRef(0);

  async function load(id = '', initial = false) {
    const requestId = ++latestRequest.current;
    setRefreshing(true);
    try {
      const endpoint = isDemo.current
        ? '/data/demo.json'
        : `/api/snapshot${id ? `?id=${encodeURIComponent(id)}` : ''}`;
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('The latest research could not be loaded. Try refreshing.');
      const next = SnapshotSchema.parse(await response.json());
      if (requestId !== latestRequest.current) return;
      setSnapshot(next);
      setStatus(next.demo ? 'demo' : 'live');
      setHistoryId(id);
      setError('');
    } catch (failure) {
      if (requestId !== latestRequest.current) return;
      if (initial && !id && !isDemo.current) {
        try {
          const response = await fetch('/data/bootstrap.json', { cache: 'no-store' });
          if (!response.ok) throw new Error('No saved snapshot');
          const saved = SnapshotSchema.parse(await response.json());
          if (requestId !== latestRequest.current) return;
          setSnapshot(saved);
          setStatus('saved');
          setError(
            'Live research is unavailable. Showing a saved snapshot with its original dates.',
          );
        } catch {
          setStatus('error');
          setError('Research is unavailable. Try refreshing in a moment.');
        }
      } else {
        setStatus('offline');
        setError(failure instanceof Error ? failure.message : 'Could not load the research.');
      }
    } finally {
      if (requestId === latestRequest.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    void load('', true);
    void fetch('/api/history')
      .then((r) => (r.ok ? r.json() : { snapshots: [] }))
      .then((data) =>
        setHistory(
          (data.snapshots || []).filter((item: HistoryItem) => item.axisMode === 'levels'),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (historyId || isDemo.current) return;
    const timer = window.setInterval(() => void load(), 300_000);
    return () => window.clearInterval(timer);
  }, [historyId]);
  return { snapshot, status, error, refreshing, history, historyId, load };
}
