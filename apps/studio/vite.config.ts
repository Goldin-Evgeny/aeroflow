import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages subpaths.
  base: './',
  server: {
    host: true, // reachable from the Windows browser when developing inside WSL2
  },
});
