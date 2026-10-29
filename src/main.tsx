import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './theme/generated/blueprint.css';
import './styles/app.css';
import {blueprintTheme} from './theme/generated/blueprint';
import {App} from './App';
import {initPersistence} from './store/planStore';

void initPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme theme={blueprintTheme} mode="light">
      <App />
    </Theme>
  </StrictMode>,
);
