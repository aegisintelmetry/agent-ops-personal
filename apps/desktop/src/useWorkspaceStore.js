import { useEffect, useRef, useState } from 'react';

export function useWorkspaceStore(groups, dispatch) {
  const api = window.btk?.personal?.workspace;
  const [status, setStatus] = useState(api ? 'loading' : 'volatile');
  const latest = useRef(groups);
  const writable = useRef(false);
  const persisted = useRef(null);
  latest.current = groups;
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api.read().then(value => {
      if (!alive) return;
      dispatch({ action: { type: 'hydrate', groups: value } });
      writable.current = true;
      setStatus('ready');
    }).catch(() => { if (alive) setStatus('restoreError'); });
    return () => { alive = false; };
  }, [api, dispatch]);
  useEffect(() => {
    if (!api || !writable.current || latest.current === persisted.current) return;
    setStatus('saving');
    let alive = true;
    const timer = setTimeout(() => {
      api.save(groups).then(() => {
        persisted.current = groups;
        if (alive) setStatus('saved');
      }).catch(() => { if (alive) setStatus('saveError'); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [api, groups]);
  useEffect(() => {
    if (!api) return;
    const flush = () => {
      if (writable.current && latest.current !== persisted.current) {
        try { return api.flush(latest.current); } catch { return { saved: false }; }
      }
    };
    const beforeUnload = event => {
      if (flush()?.saved === false) { event.preventDefault(); event.returnValue = ''; setStatus('saveError'); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); flush(); };
  }, [api]);
  return status;
}
