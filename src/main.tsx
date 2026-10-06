import { render } from 'preact';
import { requestPersistentStorage } from './pwa';
import { initTelegram } from './telegram';
import { App } from './ui/App';
import './styles.css';

initTelegram(() => {});
requestPersistentStorage();
render(<App />, document.getElementById('app')!);
