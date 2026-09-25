const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      checkDir(full);
    } else if (full.endsWith('.js')) {
      process.stdout.write(`Checking ${full}... `);
      try {
        execSync(`node --check "${full}"`);
        console.log('OK');
      } catch (err) {
        console.log('FAIL');
        console.error(err.message);
        process.exit(1);
      }
    }
  }
}

console.log('--- EdgeFleet Syntax Verification ---');
checkDir(path.join(__dirname, 'js'));
console.log('SUCCESS: All JavaScript modules passed syntax verification!');
