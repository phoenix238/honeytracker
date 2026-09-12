import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project repo under /<repo>/, so assets need that base in a
// production build. Dev and test stay at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/honeytracker/' : '/',
  plugins: [react()],
}));
