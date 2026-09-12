import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel serves the app from its domain root, so base stays '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
});
