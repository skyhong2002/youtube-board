import { defineConfig } from 'vitest/config';
// DB tests exercise a single current-vocabulary pointer; serialize fixture publication/cleanup.
export default defineConfig({ test: { fileParallelism: false } });
