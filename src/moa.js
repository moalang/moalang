'use strict'
function trace(...a) { console.log(...a); return a[a.length - 1] }
String.prototype.rsplit = function (r) { return this.split(new RegExp(r, 'g')) }
const compile = (src) => src

let a = process.argv[2]
if (a === 'build') {
  let fs = require('fs')
  let src = fs.readFileSync(process.argv[3], 'utf8')
  console.log(compile(src))
} else if (a === 'version') {
  console.log('moa0.0.1 js')
} else {
  console.log(`Moa is a tool for managing Moa source code.

Usage:

  moa <command> [arguments]

The commands are:

	build       compile packages and dependencies
	version     print Moa version`)
}
