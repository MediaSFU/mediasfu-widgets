import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import css from 'rollup-plugin-css-only';
import replace from '@rollup/plugin-replace';

const production = process.env.BUILD === 'production';

const modularEntries = {
  'call-button': 'src/entries/call-button.ts',
  'meeting-join': 'src/entries/meeting-join.ts',
  'ai-agent': 'src/entries/ai-agent.ts',
  'web-agent': 'src/entries/web-agent.ts',
  calls: 'src/entries/calls.ts',
  'agent-dashboard': 'src/entries/agent-dashboard.ts',
  react: 'src/entries/react.ts',
  headless: 'src/entries/headless.ts',
};

const npmExternals = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'mediasfu-reactjs',
]);

// Browser polyfill for process — injected as UMD banner so it comes before any code
const processBanner = `(function(){if(typeof globalThis.process==="undefined"){globalThis.process={env:{NODE_ENV:${JSON.stringify(production ? 'production' : 'development')}},type:"",__nwjs:false};}else if(!globalThis.process.env){globalThis.process.env={NODE_ENV:${JSON.stringify(production ? 'production' : 'development')}};}})();`;

function modularBuild(name, input) {
  return {
    input,
    external: (id) => npmExternals.has(id),
    output: [
      {
        file: `dist/subpaths/${name}.cjs`,
        format: 'cjs',
        exports: 'named',
        sourcemap: !production,
        inlineDynamicImports: true,
      },
      {
        file: `dist/subpaths/${name}.mjs`,
        format: 'esm',
        sourcemap: !production,
        inlineDynamicImports: true,
      },
    ],
    plugins: [
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
        'process.env.REACT_APP_USE_DEMO_MODE': JSON.stringify(''),
      }),
      resolve({ browser: true }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        // Keep declaration emission enabled because the shared tsconfig defines
        // declarationDir. The cleaner runs once before the full build, so each
        // modular pass refreshes the same deterministic declaration tree.
        compilerOptions: { declaration: true },
      }),
      production && terser({
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        mangle: { keep_classnames: true },
      }),
    ],
  };
}

const modularBuilds = Object.entries(modularEntries).map(([name, input]) => modularBuild(name, input));

const fullBuild = [
  // UMD build (for CDN script tag)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/widget.js',
      format: 'umd',
      name: 'MediaSFU',
      sourcemap: !production,
      inlineDynamicImports: true, // Required for UMD with circular deps
      banner: processBanner,
    },
    plugins: [
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
        'process.env.REACT_APP_USE_DEMO_MODE': JSON.stringify(''),
      }),
      css({ output: 'widget.css' }),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      production && terser({
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          keep_classnames: true, // Keep Web Component class names
        },
      }),
    ],
  },
  // ESM build (for npm imports)
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/widget.esm.js',
        format: 'esm',
        sourcemap: !production,
        inlineDynamicImports: true, // CDN-compatible ESM alias
        banner: processBanner,
      },
      {
        file: 'dist/widget.mjs',
        format: 'esm',
        sourcemap: !production,
        inlineDynamicImports: true, // Unambiguous Node/npm ESM entry
        banner: processBanner,
      },
    ],
    plugins: [
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
        'process.env.REACT_APP_USE_DEMO_MODE': JSON.stringify(''),
      }),
      css({ output: false }), // CSS already output in UMD build
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      production && terser(),
    ],
  },
  ...modularBuilds,
];

export default process.env.MODULAR_ONLY === 'true' ? modularBuilds : fullBuild;
