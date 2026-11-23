'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const local = path.join(root, '.android-tools', 'jdk');
const bin = process.platform === 'win32' ? '.exe' : '';
let home = process.env.MOSQUE_JAVA_HOME || process.env.JAVA_HOME;
if (!home && fs.existsSync(local)) {
  home = fs.readdirSync(local).map(name => path.join(local, name))
    .find(folder => fs.existsSync(path.join(folder, 'bin', 'javac' + bin)));
}
const tool = name => home ? path.join(home, 'bin', name + bin) : name;
const out = path.join(__dirname, 'build', 'phone-tests');
fs.mkdirSync(out, { recursive: true });
const opts = { cwd: root, stdio: 'inherit', windowsHide: true };
execFileSync(tool('javac'), ['-encoding', 'UTF-8', '-d', out,
  'android/src/sa/mosque/display/PhoneApproval.java', 'android/src/sa/mosque/display/LocalPhoneServer.java',
  'android/tests/PhoneApprovalTest.java', 'android/tests/PhoneServerTest.java'], opts);
execFileSync(tool('java'), ['-cp', out, 'sa.mosque.display.PhoneApprovalTest'], opts);

execFileSync(tool('java'), ['-cp', out, 'sa.mosque.display.PhoneServerTest'], opts);
