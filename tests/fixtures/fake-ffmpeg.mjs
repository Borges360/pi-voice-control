const mode = process.argv[process.argv.indexOf('-i') + 1];
if (mode === 'fail') { process.stderr.write('sensitive OS/device diagnostics'); process.exit(1); }
const frame = Buffer.alloc(640); for(let i=0;i<320;i++) frame.writeInt16LE(i%2 ? -8000 : 8000, i*2);
let timer;
if (mode !== 'stall') timer = setInterval(() => process.stdout.write(frame), 20);
process.stdin.resume();
process.stdin.on('data', () => { if (mode !== 'ignore-q' && mode !== 'stall') { clearInterval(timer); process.exit(0); } });
if (mode === 'disconnect') setTimeout(() => process.exit(1), 120);
