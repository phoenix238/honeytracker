import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { apiDevServer } from './server/devPlugin';

// Vercel serves the app from its domain root, so base stays '/'.
export default defineConfig(({ mode }) => {
  // Make .env.local values (APP_PASSWORD, STARLING_TOKEN, …) visible to the dev API.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    base: '/',
    plugins: [react(), apiDevServer()],
  };
});
