export type Environment = {
  readonly environment: 'development' | 'production';
  readonly api: {
    readonly url: string;
  };
};
