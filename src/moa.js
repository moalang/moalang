'use strict'

const fs = require('fs')
const str = o => typeof o === 'string' ? o : JSON.stringify(o)
const strs = o => Array.isArray(o) ? o.map(str).join(' ') : str(o)
const put = (...a) => process.stdout.write(strs(a))
const puts = (...a) => console.log(strs(a))
const dump = (...a) => a.map(o => console.dir(o, {depth: null}))
const trace = o => { dump(o); return o }
const reserves = 'let var fn struct if unless for while continue break return fail p pp)'.split(' ')
const fail = m => { throw Error(m) }

const embeddedJs = (() => {
const __error = (message, obj) => { throw Object.assign(Error(message), obj) }
const __now = () => {
  const d = new Date()
  const pnow = performance.now()
  const _year = d.getFullYear()
  const _month = d.getMonth() + 1
  const _day = d.getDate()
  const _hour = d.getHours()
  const _minute = d.getMinutes()
  const _second = d.getSeconds()
  const _string = `${_year}/${('0' + _month).slice(-2)}/${('0' + _day).slice(-2)} ${('0' + _hour).slice(-2)}:${('0' + _minute).slice(-2)}:${('0' + _second).slice(-2)}`
  const _elapsed = () => Math.floor((performance.now() - pnow) * 10) / 10 + 'ms'
  return { _year, _month, _day, _hour, _minute, _second, _string, _elapsed }
}
const __p = (...args) => console.log(...args.map(x => ['string', 'number'].includes(typeof x) ? x : JSON.stringify(x)))
const __pp = (...args) => console.log(...args.map(x => JSON.stringify(x, null, 2)))
}).toString().slice(8, -1).trim()

const isOp2 = s => s && s.match && s.match(/^[+\-*%/=><|&^]+$/)
const compile = source => {
  const simplify = ts => {
    let nesting = 0
    let indent = 0
    const close = n => [...Array(n)].flatMap(_ => [';', '}', ';'])
    const convert = t => {
      if (t === ':') {
        return '{'
      } else if (nesting === 0 && t.includes('\n')) {
        const before = indent
        indent = t.split('\n').slice(-1)[0].length
        if (indent % 2 !== 0) {
          fail(`Indentations must be multiple of two spaces. But this is ${JSON.stringify(indent)}`)
        }
        if (indent == before) {
          return ';'
        } else if (indent < before) {
          return close((before - indent) / 2)
        }
        return []
      } else if ('[('.includes(t) || t.endsWith('(')) {
        ++nesting
      } else if (')]'.includes(t)) {
        --nesting
      }
      return t
    }
    ts = ts.map(t => t === '{' ? '{{' : t === '}' ? '}}' : t)
    return ts.flatMap(convert).concat(close(indent / 2))
  }
  const tokens = simplify(source.split(/([ \n]+|[0-9]+(?:\.[0-9]+)?|[A-Za-z0-9_]+(?:,[A-Za-z0-9_]+)|[A-Za-z0-9_]+\(?|[+\-*%/=><|&^]+|"[^"]*"|`[^`]*`|[^\[\](){} \n;\.]+|.)/g).filter(x => x.replace(/^ +$/, '')))
  const nodes = parse(tokens)
  const js = generate(nodes)
  return {tokens, nodes, js}
}

const parse = tokens => {
  let pos = 0
  const many = (f, option, g) => {
    option = option || {}
    const a = []
    while (pos < tokens.length) {
      if (option.stop && option.stop(tokens[pos])) {
        ++pos
        break
      }
      a.push(f(tokens[pos]))
    }
    return g ? g(a) : a
  }
  const consume = t => reserves.includes(t.toString()) ? line() : exp()
  const line = () => many(exp, {stop: t => t === ';'})
  const exp = () => ((lhs, t) => isOp2(t) ? ++pos && [t, lhs, exp()] : lhs)(atom(), tokens[pos])
  const atom = () => {
    const unit = bottom()
    if (tokens[pos] === '.') {
      ++pos
      return ['.', unit, atom()]
    } else {
      return unit
    }
  }
  const bottom = () => {
    if (pos >= tokens.length) {
      return null
    }
    const t = tokens[pos++]
    if (t.match(/^[0-9]+(\.[0-9]+)?$/) || t.match(/^[A-Za-z0-9_]+=?$/) || t.match(/^[A-Za-z0-9_],[A-Za-z0-9_,]+$/) || t.startsWith('"') || t.startsWith('`')) {
      return t
    } else if (t.match(/^[A-Za-z0-9_]+\($/)) {
      return  many(exp, {stop: u => u === ')'}, a => a.length ? [t.slice(0, -1),  ...a] : t + ')')
    } else if (t.match(/^\$?[A-Za-z0-9_]+\:$/)) {
      const a = [':', t.slice(0, -1), exp()]
      while (tokens[pos].match(/^\$?[A-Za-z0-9_]+\:$/)) {
        const key = tokens[pos++].slice(0, -1)
        a.push(key, exp())
      }
      return a
    } else if ('}]);'.includes(t.toString())) {
      return t
    } else if (t === '{{') {
      return many(exp, {stop: u => u === '}}'}, a => a.length === 0 ? '({})' : (a.length >= 2 || a[0][0] === '=') ? ['__struct', ...a] : a)
    } else if (t === '(') {
      return many(exp, {stop: u => u === ')'})
    } else if (t === '[') {
      return many(exp, {stop: u => u === ']'}, a => a.length ? ['__array', ...a] : '[]')
    } else if (t === '{') {
      return ['__do', ...many(line, {stop: u => u === '}'})]
    } else {
      throw Error(`Unexpected token "${t}"`)
    }
  }
  return many(consume)
}

const generate = nodes => {
  const gen = o => Array.isArray(o) ? (o.length === 1 ? gen(o[0]) : apply(o)) : o
  const isCond = args => ['if', 'unless'].includes(args[args.length - 2])
  const cond = (head, args) => args.length === 0 ? head :
    args[0] === 'if' ? `if (${gen(args[1])}) ${head}` :
    args[0] === 'unless' ? `if (!${gen(args[1])}) ${head}` :
    fail(`Unknown condition ${args}`)
  const addReturn = x => x.match(/^return|if|for|while/) ? x : 'return ' + x
  const statement = a => `(() => { ${[...a.slice(0, -1), addReturn(a[a.length - 1])].join(';')} })()`
  const block = a => a[0] === '__do' ? '{' + a.slice(1).map(gen).join(';') + '}' : gen(a)
  const structField = o => typeof o === 'string' ? `${o}:${o}` : `${o[1]}: ${gen(o[2])}`
  const apply = ([head, ...args]) => {
    if (Array.isArray(head)) {
      return gen(head) + '(' + args.flatMap(x => x).map(gen) + ')'
    } else if (isOp2(head)) {
      if (head === '=>') {
        return '((' + gen(args[0]) + ') => ' + gen(args[1]) + ')'
      } else {
        return '(' + gen(args[0]) + head + gen(args[1]) + ')'
      }
    } else if (head === '.') {
      if (Array.isArray(args[1])) {
        return `${gen(args[0])}._${args[1][0]}(${args[1].slice(1).map(gen)})`
      } else {
        return `${gen(args[0])}._${args[1]}`
      }
    } else if (head === ':') {
      const key = s => s.startsWith('$') ? `[${s.slice(1)}]` : s
      return '({' + Array.from({length: args.length/2}, (_, i) => key(args[i*2]) + ':' + args[i*2+1]).join(',') + '})'
    } else if (head === '__array') {
      return '[' + args.map(gen).join(', ') + ']'
    } else if (head === '__do') {
      return statement(args.map(gen))
    } else if (head === '__struct') {
      return '({' + args.map(structField) + '})'
    } else if (head === 'let') {
      return `const ${args[0]} = ${gen(args.slice(1))}`
    } else if (head === 'var') {
      return `var ${args[0]} = ${args.length >= 2 ? gen(args.slice(1)) : 'undefined'}`
    } else if (head === 'fn') {
      return `const ${args[0]} = (${args.slice(1, -1)}) => ${gen(args[args.length - 1])}`
    } else if (head === 'struct') {
      const names = args[args.length - 1].slice(1).map(a => '_' + a[0])
      return `const ${args[0]} = (${names}) => ({${names}})`
    } else if (head === 'if') {
      return `if (${gen(args[0])}) ${block(args[1])} ${args.length >= 3 ? gen(args.slice(2)) : ''}`
    } else if (head === 'elif') {
      return `else if (${gen(args[0])}) ${block(args[1])} ${args.length >= 3 ? gen(args.slice(2)) : ''}`
    } else if (head === 'else') {
      return `else ${block(args)}`
    } else if (head === 'for') {
      if (args.length == 3) {
        return `for (let ${args[0]} of ${gen(args[1])}) ${block(args[2])}`
      } else {
        throw Error(`Unknown for syntax ${args}`)
      }
    } else if (head === 'while') {
      return `while (${gen(args[0])}) ${block(args[1])}`
    } else if (head === 'continue' || head === 'break') {
      return cond(head, args)
    } else if (head === 'return') {
      if (args.length === 0) {
        return 'return'
      } else if (args.length === 1) {
        return `return ${gen(args[0])}`
      } else if (args.length === 2) {
        return cond('return', args)
      } else if (args.length === 3) {
        return cond(`return ${args[0]}`, args.slice(1))
      } else {
        throw Error(`Unknown return syntax ${args}`)
      }
    } else if (head === 'p' || head === 'pp') {
      if (isCond(args)) {
        return cond(`__${head}(${args.slice(0, -2).map(gen)})`, args.slice(-2))
      } else {
        return `__${head}(${args.map(gen)})`
      }
    } else {
      return `${head}(${args.map(gen)})`
    }
  }
  return nodes.map(gen).join(';\n')
}
const test = () => {
  const check = (expect, exp, ...defs) => {
    const source = (defs || []).concat(`fn main:\n  ${exp.replace("\n", "\n  ")}`).join('\n')
    const {js, nodes, tokens} = compile(source)
    let actual
    try {
      const __stdout = []
      const __p = (...a) => { __stdout.push(a.map(str).join(' ')) }
      const __pp = (...a) => { __stdout.push(a.map(x => JSON.stringify(x, null, 2)).join(' ')) }
      actual = eval(js + '\nmain()')
      if (actual === undefined) {
        actual = ''
      }
      if (__stdout.length) {
        actual = actual + __stdout.join('\n')
      }
    } catch(e) {
      actual = e.stack
    }
    if (str(actual) === str(expect)) {
      put('.')
    } else {
      puts('FAILURE')
      puts('source:', source)
      puts('js    :', js)
      puts('nodes :', nodes)
      puts('tokens:', tokens)
      puts('expect:', expect)
      puts('actual:', actual)
      process.exit(1)
    }
  }

  // node:
  // | keywords exp+ (":" ("\n  " node)+)? cond? "\n"
  // | exp+ cond? "\n"
  // exp: unit (op2 exp)*
  // unit: bottom ("." id ("(" exp+ ")")?)*
  // bottom:
  // | "(" exp ")"                # priority : 1 * (2 + 3)
  check(9, '(1 + 2) * 3')
  // | "[" exp* "]"               # array    : [] [1 2]
  check([], '[]')
  check([1, 2], '[1 2]')
  // | "(" tags ")"               # struct   : () (name price=1)
  check({}, '{}')
  check({key:1}, '{key=1}')
  check({key1:1, key2:2}, '{key1 key2=2}', 'let key1 1')
  // | '"' [^"]* '"'              # string   : "hi"
  check('hi', '"hi"')
  check('${name}', '"${name}"')
  // | '`' ("${" unit "}" | [^"])* '`' # template : "hi {name}"
  check('hello moa', '`hello ${name}`', 'let name "moa"')
  // | id ("," id)* "=>" exp      # lambda   : a,b => a + b
  check('3', '(x => x + 1)(2)')
  check('3', '(a,b => a + b)(1 2)')
  // | [0-9]+ ("." [0-9]+)?       # number   : 1 0.5
  check(1, '1')
  check(1.5, '1.5')
  // | id ("(" exp+ ")")?         # id       : name f()
  check(1, 'v', 'let v 1')
  check(1, 'f()', 'fn f 1')
  check(2, 'inc(1)', 'fn inc x:\n  x + 1')
  check(3, 'add(1 2)', 'fn add a b:\n  a + b')
  // keyword: qw(let var fn struct if unless for while continue break return fail p pp)


  // lines
  puts('ok')
}

const interactive = async () => {
  puts('Moa 0.0.1 May 23 2022, 21:26')
  const readline = require('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  })
  rl.prompt()
  rl.on('line', (line) => {
    const cmd = line.trim()
    if (['exit', 'quit', 'q'].includes(cmd)) {
      rl.close()
      return
    }
    let {js} = compile(cmd)
    js = js.replace(/^let |const /g, 'global.')
    try {
      puts(eval(js))
    } catch (e) {
      puts(e.stack)
    }
    puts('js:', js)
    rl.prompt()
  }).on('close', () => {
    puts('Bye👋')
  })
}

const main = () => {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    interactive()
  } else if (paths[0] === '--test') {
    test()
  } else {
    const moa = paths.map(path => fs.readFileSync(path, 'utf-8')).join('\n\n')
    puts('// Embedded JavaScript')
    puts(embeddedJs)
    puts()
    puts('// Compiled Moa source code')
    puts(compile(moa).js)
  }
}

main()
