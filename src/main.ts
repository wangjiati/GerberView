import './styles.css';
import { App } from './ui/app';

const container = document.getElementById('app')!;
const isShareMode = !!(window as any).__SHARE_DATA__;

const app = new App(container, isShareMode ? 'share' : 'full');
if (isShareMode) {
  app.loadEmbeddedData();
}

// 暴露给自动化测试
(window as any).__gerbview = app;
