import { createRouter, createMemoryHistory, createBrowserHistory } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';

// Use browser history in web mode (for e2e tests and dev), memory history in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const BOARD_ROUTE_PATH = '/board';

const history = isElectron
  ? createMemoryHistory({ initialEntries: [BOARD_ROUTE_PATH] })
  : createBrowserHistory();

// Vite sets import.meta.env.BASE_URL from the `base` config (e.g. '/automaker/')
// Strip trailing slash so TanStack Router gets '/automaker' (it adds its own)
const basepath = import.meta.env.BASE_URL?.replace(/\/+$/, '') || '/';

export const router = createRouter({
  routeTree,
  defaultPendingMinMs: 0,
  history,
  basepath,
  defaultOnCatch: (error) => {
    // When a new build is deployed, old chunk filenames no longer exist.
    // Detect this and reload once to pick up the new index.html and chunks.
    const msg = String(error?.message || error);
    if (
      msg.includes('dynamically imported module') ||
      msg.includes('Failed to fetch') ||
      msg.includes('Loading chunk')
    ) {
      const key = '__chunk_reload';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    }
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
