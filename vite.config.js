import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/teacher-schedule-helper/',
  plugins: [react()],
});
