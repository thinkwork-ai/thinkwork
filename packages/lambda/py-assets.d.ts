// THINK-280: capability-sdk Python sources are imported as text (esbuild
// `--loader:.py=text`) so routine-exec-git can materialize them into the
// capability-private sandbox at run time.
declare module "*.py" {
  const source: string;
  export default source;
}
