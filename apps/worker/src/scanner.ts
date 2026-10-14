import { connect } from 'node:net';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

export type ScanVerdict = { clean: true } | { clean: false; signature: string };

/** Porta do antivírus (ADR 0026): permite trocar o motor sem alterar o processador. */
export interface AntivirusScanner {
  readonly name: string;
  scan(stream: Readable): Promise<ScanVerdict>;
}

/**
 * ClamAV via clamd (protocolo INSTREAM): envia o arquivo em blocos `<tamanho uint32 BE><dados>`
 * terminados por um bloco de tamanho zero; a resposta é `stream: OK` ou `stream: <assinatura> FOUND`.
 */
export class ClamdScanner implements AntivirusScanner {
  readonly name = 'clamd';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(stream: Readable): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let response = '';
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.timeoutMs, () => {
        fail(new Error('Tempo esgotado na varredura antivírus'));
      });
      socket.on('error', fail);
      socket.on('data', (chunk: Buffer) => (response += chunk.toString('utf8')));
      socket.on('end', () => {
        const line = response.replace(/\0/g, '').trim();
        if (line.endsWith('OK')) resolve({ clean: true });
        else if (line.endsWith('FOUND'))
          resolve({
            clean: false,
            signature: line.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, ''),
          });
        else reject(new Error(`Resposta inesperada do clamd: ${line}`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        stream.on('data', (chunk: Buffer) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(Buffer.concat([size, chunk]));
        });
        stream.on('end', () => socket.write(Buffer.alloc(4)));
        stream.on('error', fail);
      });
    });
  }
}

/** Sem antivírus (somente desenvolvimento/testes): consome o stream e aprova. */
export class DisabledScanner implements AntivirusScanner {
  readonly name = 'disabled';

  async scan(stream: Readable): Promise<ScanVerdict> {
    stream.resume();
    await finished(stream);
    return { clean: true };
  }
}
