import './styles.css';
import { App } from './ui/app';

const container = document.getElementById('app')!;
const app = new App(container);

// 暴露给自动化测试
(window as any).__gerbview = app;
