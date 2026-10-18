import esbuild from 'esbuild';
import process from 'process';
import { wasmMarkerPlugin } from './esbuild-wasm-marker.mjs';

const prod = process.argv[2] === 'production';

esbuild.build({
    entryPoints: ['main.ts'],
    bundle: true,
    external: ['obsidian', '@codemirror/view', '@codemirror/state'],
    format: 'cjs',
    target: 'es2020',
    outfile: 'main.js',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    plugins: [wasmMarkerPlugin],
}).catch(() => process.exit(1));