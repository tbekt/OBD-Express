import { ELM327 } from '../src/obd/elm327';

const port = process.argv[2] ?? 'COM5';
const obd  = new ELM327();

obd.on('data', (d: any) => console.log(`   ${d.name}: ${d.value} ${d.unit}`));

(async () => {
  console.log(`\nVerbinden met ${port} (auto baud)…\n`);
  try {
    const baud = await obd.connect(port, 'auto');
    console.log(`\n✓ VERBONDEN op ${baud} baud\n`);
    console.log('Live data (5 seconden):');
    obd.startPolling(500);
    await new Promise((r) => setTimeout(r, 5000));
    await obd.disconnect();
    console.log('\n✓ Alles werkt.\n');
  } catch (err) {
    console.log(`\n✗ MISLUKT: ${(err as Error).message}\n`);
    await obd.disconnect().catch(() => {});
  }
  process.exit(0);
})();
