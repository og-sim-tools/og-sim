import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserStore, fileStore } from './saves';
import { seedStarter } from './starter';
import { STATIC_SITE } from './staticData';
import './styles.css';

// The hosted site keeps everything in this browser; `npm run dev` uses the project's files (src/server).
const store = STATIC_SITE ? browserStore() : fileStore();

async function start() {
  if (STATIC_SITE) {
    // Ask the browser not to clear the saves when it runs low on space (it may still say no).
    void navigator.storage?.persist?.().catch(() => false);
    await seedStarter(store).catch(() => false);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
}
void start();
