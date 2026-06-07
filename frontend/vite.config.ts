import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const previewHost = process.env.PREVIEW_HOST;
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4100';

export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.PORT || '5173'),
		host: '0.0.0.0',
		strictPort: true,
		allowedHosts: 'all',
		proxy: {
			'/api': {
				target: apiProxyTarget,
				changeOrigin: true,
			},
		},
		hmr: previewHost
			? {
					host: previewHost,
					clientPort: 443,
					protocol: 'wss',
				}
			: undefined,
	},
	preview: {
		host: '0.0.0.0',
		strictPort: true,
		allowedHosts: 'all',
		proxy: {
			'/api': {
				target: process.env.VITE_API_URL ?? 'http://localhost:4100',
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: 'dist',
		rollupOptions: {
			input: 'index.html',
		},
	},
});