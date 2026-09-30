import { render } from 'preact';
import { initTelegram } from './telegram';
import { App } from './ui/App';
import './styles.css';

initTelegram(() => {});
render(<App />, document.getElementById('app')!);
