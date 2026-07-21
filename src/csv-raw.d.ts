// Vite `?raw` imports of the packaged CSV datasets (Alpha 0.1.0 §5.3 —
// browser acquisition adapter; the same files are read from disk by Node).
declare module '*.csv?raw' {
  const text: string;
  export default text;
}
