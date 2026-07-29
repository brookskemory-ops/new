import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` targets a GitHub Pages project site at https://<user>.github.io/new/.
// Override with BASE_PATH=/ when serving from a domain root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/new/',
  plugins: [react(), tailwindcss()],
})
