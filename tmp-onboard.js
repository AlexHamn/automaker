// Use setup-token to complete onboarding non-interactively
const pty = require('node-pty');

// First, try setup-token to mark the CLI as fully set up
const p = pty.spawn('/bin/sh', ['-c', 'claude setup-token'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: '/projects',
  env: { ...process.env, TERM: 'xterm-256color', HOME: '/home/automaker' },
});
let out = '';
let pasted = false;

p.onData((d) => {
  out += d;
  const clean = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  console.log('CLEAN TAIL:', clean.slice(-300));

  // If it asks to paste a token, paste the OAuth access token
  if (
    pasted === false &&
    (clean.includes('Pasteyourtoken') || clean.includes('token') || clean.includes('Enter'))
  ) {
    pasted = true;
    console.log('[STEP] Token prompt detected, pasting OAuth token');
    const token =
      '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';
    setTimeout(() => {
      p.write(token + '\r');
    }, 500);
  }
});

setTimeout(() => {
  const clean = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  console.log('\n=== FINAL OUTPUT ===');
  console.log(clean.slice(-1000));
  p.kill();
  process.exit(0);
}, 15000);
