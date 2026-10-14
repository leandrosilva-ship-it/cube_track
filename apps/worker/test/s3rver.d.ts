declare module 's3rver' {
  interface S3rverOptions {
    port?: number;
    address?: string;
    directory: string;
    silent?: boolean;
    configureBuckets?: { name: string }[];
  }
  export default class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<{ address: string; port: number }>;
    close(): Promise<void>;
  }
}
