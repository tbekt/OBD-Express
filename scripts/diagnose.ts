/**
 * Standalone OBD adapter diagnostic — bypasses the web app entirely.
 *
 *   npx ts-node scripts/diagnose.ts            → list every serial port
 *   npx ts-node scripts/diagnose.ts COM3       → probe COM3 at every baud rate
 */
import { SerialPort } from 'serialport';

const BAUD_RATES = [38400, 9600, 115200, 500000, 230400, 57600, 19200];

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function listPorts(): Promise<void> {
  console.log('\n=== SERIELE POORTEN ===\n');
  const ports = await SerialPort.list();

  if (ports.length === 0) {
    console.log('  GEEN ENKELE POORT GEVONDEN.\n');
    console.log('  Windows ziet je adapter dus niet. Dit is GEEN probleem van de app.');
    console.log('  Check Apparaatbeheer (Windows + X):');
    console.log('    - Staat er iets onder "Poorten (COM & LPT)"?');
    console.log('    - Of iets met een geel uitroepteken onder "Andere apparaten"?');
    console.log('    - Of helemaal niks? Dan is het een kabel/USB/adapter probleem.\n');
    return;
  }

  ports.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.path}`);
    console.log(`      fabrikant : ${p.manufacturer  ?? '(onbekend)'}`);
    console.log(`      serie-nr  : ${p.serialNumber  ?? '(geen)'}`);
    console.log(`      vendor ID : ${p.vendorId      ?? '(geen)'}`);
    console.log(`      product ID: ${p.productId     ?? '(geen)'}`);
    console.log(`      pnp ID    : ${p.pnpId         ?? '(geen)'}`);
    console.log('');
  });

  console.log(`  ${ports.length} poort(en) gevonden.`);
  console.log(`  Test er een met:  npx ts-node scripts/diagnose.ts ${ports[0].path}\n`);
}

/** Open the port at one baud rate, send ATZ, dump whatever comes back raw. */
function probeBaud(path: string, baudRate: number): Promise<boolean> {
  return new Promise((resolve) => {
    let port: SerialPort;
    let received = Buffer.alloc(0);
    let finished = false;

    const finish = (ok: boolean, note: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (received.length > 0) {
        const ascii = received.toString('ascii').replace(/[^\x20-\x7e]/g, '.');
        console.log(`      ruwe bytes: ${received.length}`);
        console.log(`      hex       : ${received.toString('hex').slice(0, 120)}`);
        console.log(`      ascii     : "${ascii.slice(0, 120)}"`);
      }
      console.log(`      ${note}\n`);

      if (port?.isOpen) port.close(() => resolve(ok));
      else resolve(ok);
    };

    const timer = setTimeout(() => {
      finish(false, received.length === 0
        ? '✗ STILTE — geen enkele byte terug'
        : '✗ wel bytes, maar geen ELM327 herkenning (waarschijnlijk verkeerde baud)');
    }, 4000);

    try {
      port = new SerialPort({ path, baudRate });
    } catch (err) {
      finish(false, `✗ kon poort niet openen: ${(err as Error).message}`);
      return;
    }

    port.on('error', (err) => finish(false, `✗ poortfout: ${err.message}`));

    port.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const text = received.toString('ascii');
      if (/ELM\s*327|ELM|OBD\s*II|OBDII/i.test(text)) {
        finish(true, '✓✓✓ ELM327 GEVONDEN OP DEZE BAUD RATE ✓✓✓');
      }
    });

    port.on('open', async () => {
      await sleep(300);
      port.write('\r');           // wake up clones that eat the first byte
      await sleep(200);
      received = Buffer.alloc(0); // drop wake-up noise
      port.write('ATZ\r');
    });
  });
}

async function probePort(path: string): Promise<void> {
  console.log(`\n=== TEST VAN ${path} ===\n`);

  for (const baud of BAUD_RATES) {
    console.log(`  ${baud} baud…`);
    const ok = await probeBaud(path, baud);
    if (ok) {
      console.log(`\n  RESULTAAT: gebruik ${baud} baud in de app.\n`);
      return;
    }
    await sleep(400); // Windows needs a beat before the port reopens
  }

  console.log('  RESULTAAT: op geen enkele baud rate een ELM327 antwoord.\n');
  console.log('  Als je hierboven ALLEEN "STILTE" ziet:');
  console.log('    - adapter zit niet in de OBD-poort van de auto, of');
  console.log('    - contact staat uit (zet op stand II), of');
  console.log('    - de adapter is defect / het is een lege behuizing (komt voor bij klonen).');
  console.log('  Zie je wel bytes maar geen herkenning: stuur de hex-regel door.\n');
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target) await probePort(target);
  else        await listPorts();
}

main().catch((err) => { console.error('\nFOUT:', err); process.exit(1); });
