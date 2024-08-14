#!node
'use strict'

/* Syntax
top: line ([\n;] line)*
line: exp+
exp:
| op1? atom (op2 exp)?
| id ("," id+ )* "=>" exp
atom: bottom (prop | call | copy)*
prop: "." (id | [0-9]+)                   # property access
call: "(" exp* ")"                        # call function
index: "[" exp "]"                        # index access or generic
copy: "{" id* (id "=" atom)* "}"          # copy with new value
bottom:
| "(" top ")"                             # priority
| "[" exp* "]"                            # list
| "{" id* (id "=" atom)* "}"              # struct
| "-"? [0-9]+ ("." [0-9]+)? ("e" [0-9]+)? # -1.2
| "-"? "0x" [0-9a-fA-F_]+                 # 0xff -> 255
| '"' [^"]* '"'                           # "string"
| '"""' [^"]* '"""'                       # """a="b"""" -> "a=\"b\""
| id
op1: [!-~] | "..."
op2: [+-/*%<>|&^=!]+
id: [A-Za-z_][A-Za-z0-9_]*
*/

/* Keyword
reserved  : __.* bytes regexp time duration stream num decimal array import export i8 i16 i32 i64 u8 u16 u32 u64 f16 f32 f64
*/

/* API
//literal   : _ ...
//declare   : let var def class enum dec
dec _                 : {}
dec (== != < <= > >=) : a a bool
dec log a             : ... a a
dec assert a          : a a _!
dec iif a             : ...[bool a] a
dec if a              : bool a _
dec else a            : a _
dec match a b         : a ...[a b] b
dec throw a b         : a b
dec catch a b         : a (error[b] a) a // b as enum type covers possible exceptions, which is generated by the compiler
dec return a          : a a
dec for               : ... _
dec each              : ... _
dec while             : bool _
dec continue          : _
dec break             : _

enum bool:
  true
  false
  !  : bool
  || : bool bool
  && : bool bool

class int:
  (- ~)          : int
  (+ - * / % **) : int int
  (& | ^ << >>)  : int int
  abs            : int
  neg            : int
  float          : float
  char           : option[string]

class float:
  (- ~)          : float
  (+ - * / % **) : float float
  abs            : int
  neg            : int
  floor          : int
  ceil           : int
  round          : int
  isinf          : bool
  isnan          : bool

class string:
  _       : ... string
  size    : int
  concat  : string string
  take    : int string
  drop    : int string
  slice   : int int string
  split   : string list[string]
  index   : string option[int]
  rindex  : string option[int]
  replace : string string string
  starts  : string bool
  ends    : string bool
  has     : string bool
  trim    : string
  reverse : string
  repeat  : int string
  format  : ... string
  int     : option[int]
  float   : option[float]

class fn ...a:
  _

class error a:
  message string
  stack   string
  data    a

enum option a:
  some a
  none
  bool   : bool
  then b : (a b) option[b]
  or     : a a
  value  : a

class tuple ...a:
  _     : ...a tuple[...a]
  []    : int a.nth
  []=   : int a.nth a.nth

class list a:
  _        : ...a list[a]
  []       : int a!
  size     : int
  take     : int list[a]
  drop     : int list[a]
  slice    : int int list[a]
  repeat   : int list[a]
  concat   : list[a] list[a]
  map b    : (a b) list[b]
  fmap b   : (a list[b]) list[b]
  keep     : (a bool) list[a]
  all      : (a bool) bool
  any      : (a bool) bool
  fold b   : (b a b) b b
  scan b   : (b a b) b list[b]
  find     : (a bool) option[a]
  index    : (a bool) option[int]
  rindex   : (a bool) option[int]
  zip b    : list[b] list[tuple[a b]]
  sort     : (a a bool) list[a]
  reverse  : list[a]
  join     : string string
  has      : a bool
  min      : a
  max      : a
  minmax   : tuple[a a]
  unique   : set[a]
  []=      : int a a!  // modify in-place
  push     : a a       // modify and expand
  pop      : a!        // modify and shurink

class set a:
  _         : ...a set[a]
  (- | & ^) : set[a] set[a]
  size      : int
  has       : a bool
  list      : list[a]
  add       : a bool  // modify in-place
  rid       : a bool  // modify in-place

class dict k v:
  _      : ...[k v] dict[k v]
  []     : k option[v]
  size   : int
  has    : k bool
  keys   : list[k]
  values : list[v]
  items  : list[tuple[k v]]
  concat : dict[k v] dict[k v]
  []=    : k v v       // modify and expand
  gset   : k v v       // modify and expand
  rid    : k option[v] // modify and shrink
*/

class TypeError extends Error {}
const log = o => { console.dir(o, {depth: null}); return o }
const str = o => JSON.stringify(o, null, '  ')
const fail = (m, ...a) => { const e = new Error(m); a && (e.detail = a); throw e }
const failUnify = (m, ...a) => { const e = new TypeError(m); a && (e.detail = a); throw e }
const op1 = '- ^ ~'.split(' ')
const op2 = '* ** / % + - << >> & ^ | == != < <= > >= && || = += -= *= /= %= &= |= ^= <<= >>='.split(' ')
const runtimeJs = (function() {'use strict'
const ___string = o => typeof o === 'string' ? o :
  o instanceof Array ? `(list ${o.map(___string).join(' ')})` :
  o instanceof Map ? `(dict ${[...o].map(___string).join(' ')})` :
  o instanceof Set ? `(dict ${[...o].map(___string).join(' ')})` :
  o.toString()
const ___throw = (m, d) => { const e = new Error(m); e.detail = d; throw e }
const ___dict_set = (m, k, v) => { m.set(k, v); return v }
const ___assert = (a, b) => ___string(a) === ___string(b) || ___throw(`Assert failure: \`${___string(a)}\` is not \`${___string(b)}\``, a, b)
const ___tuple = (...a) => a
const ___list = (...a) => a
const ___dict = (...a) => new Map([...Array(a.length/2)].map((_,i) => [a[i*2], a[i*2+1]]))
const ___log = (...a) => { console.log(...a.map(___string)); return a.at(-1)}
}).toString().slice(12, -1) + '\n'

function main(command, args) {
  const { readFileSync } = require('fs')
  if (command === 'to' && args[0] === 'js') {
    return { out: runtimeJs + toJs(args.slice(1).join(' ') || readFileSync('/dev/stdin', 'utf-8')) }
  } else {
    return { out: `Usage:
      moa                       # launch interactive shell
      moa env [+/-] [<version>] # list versions; use, install or remove a version
      moa ide [<port>]          # launch web IDE
      moa to [<language>]       # compile to a programming language` }
  }
}

function tokenize(source) {
  const regexp = /(-?[0-9]+[0-9_]*(?:\.[0-9_]+)(?:e[0-9]+)?|[0-9A-Za-z_]+|[!~+\-*/%<>:!=^|&]+|[()\[\]{}]|""".*?"""|"[^]*?(?<!\\)"|(?:#[^\n]*|[ \n])+)/
  let offset = 0
  const tokens = source.trim().split(regexp).flatMap(code => code.length ? [{code, offset: offset += code.length}] : [])
  return tokens
}

function parse(tokens) {
  let pos = 0
  const br = /[;\n]/
  function parseTop() {
    return loop(() => true, parseLine)
  }
  function parseLine() {
    return til(({code}) => !br.test(code), parseExp, ({code}) => { br.test(code); pos++ })
  }
  function parseExp(token) {
    // TODO: a,b => c
    let lhs = op1.includes(token.code) ? [token, parseAtom(tokens[pos++])] : parseAtom(token)
    let lp = Math.inf
    til(({code}) => op2.includes(code), token => {
      const rp = op2.findIndex(op => op === token.code)
      lhs = lp < rp ? [token, lhs, parseAtom(tokens[pos++])] : [lhs[0], lhs[1], [token, lhs[2], parseAtom(tokens[pos++])]]
      lp = rp
    })
    return lhs
  }
  function parseAtom(token) {
    // TODO: atom: bottom (prop | call | copy)*
    let bottom = parseBottom(token)
    return bottom
  }
  function parseBottom(token) {
    for (const [l, r] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      if (token.code === l) {
        return [token].concat(til(({code}) => code !== r, parseTop, ({code}) => code === r && pos++))
      }
    }
    return token.code.startsWith('"""') ? {...token, code: JSON.stringify(token.code.slice(3, -3))} : token
  }
  function til(f, g, h) {
    return loop(() => f(tokens[pos]), () => g(tokens[pos++]), () => h(tokens[pos]))
  }
  function loop(f, g, h) {
    const a = []
    while (pos < tokens.length && f()) {
      a.push(g())
    }
    pos < tokens.length && h && h()
    return a
  }
  return parseTop()
}

function infer(root) {
  return root
}

function compileToJs(root) {
  function toJs(node) {
    if (Array.isArray(node)) {
      const [head, ...tail] = node.map(toJs)
      return tail.length === 1 && op1.includes(head) ? `(${head}${tail[0]})` :
        tail.length === 2 && op2.includes(head) ? `(${tail[0]} ${head} ${tail[1]})` :
        head + '(' + tail.join(', ') + ')'
    } else {
      return node.code
    }
  }
  return root.map(x => x.length === 1 ? toJs(x[0]) : toJs(x)).join('\n')
}

function toJs(source) {
  return compileToJs(infer(parse(tokenize(source))))
}

module.exports = { main, runtimeJs, toJs, TypeError }

if (require.main === module) {
  console.log(main(process.argv[2], process.argv.slice(3)).out || '')
}
