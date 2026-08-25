import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = ['react', 'react-dom'];

export default [
  {
    input: 'src/index.tsx',
    external,
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        exports: 'named',
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
      },
    ],
    plugins: [
      resolve({
        extensions: ['.mjs', '.js', '.jsx', '.json', '.node', '.ts', '.tsx'],
      }),
      commonjs(),
      typescript({
        tsconfig: false,
        module: 'ESNext',
        target: 'ES2019',
        jsx: 'react',
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        declaration: false,
        sourceMap: false,
      }),
    ],
  },
  {
    input: 'src/index.tsx',
    external,
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];