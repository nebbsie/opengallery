declare module 'exifr' {
  export function parse(
    input: string | Buffer | ArrayBuffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<any>;

  const _default: {
    parse: typeof parse;
  };

  export default _default;
}



