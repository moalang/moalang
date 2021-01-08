'use strict'
const runtime = require('fs').readFileSync('runtime.js', 'utf8')

// utils
function str(obj) {
  return JSON.stringify(obj, null, 2)
}
function put(s, ...args) {
  process.stdout.write(s)
  for (const arg of args) {
    console.log('', arg)
  }
}
function puts(...args) {
  for (const arg of args) {
    console.dir(arg, {depth: null})
  }
}
function copy(obj) {
  return JSON.parse(JSON.stringify(obj))
}
function zip(keys, vals) {
  const len = Math.min(keys.length, vals.length)
  const ary = []
  for (let i=0; i<len; ++i) {
    ary.push([keys[i], vals[i]])
  }
  return ary
}
function dict(kvs) {
  const d = {}
  for (const [k,v,..._] of kvs) {
    if (k in d) {
      throw new Error('Duplicated key=' + k + str(kvs))
    }
    d[k] = v
  }
  return d
}
function dict2(list) {
  const d = {}
  for (let i=1; i<list.length; i+=2) {
    d[list[i-1]] = list[i]
  }
  return d
}
function dig(d, ...args) {
  for (const arg of args) {
    d = d[arg]
    if (d === undefined) {
      return undefined
    }
  }
  return d
}

// compiler
function tokenize(src) {
  const consume = (pos,tag,m) => m ? ({tag, pos, code: typeof(m) === 'string' ? m : m[0]}) : null
  const match = (p,tag,r) => consume(p, tag, src.slice(p).match(r))
  const some = (p,tag,s) => consume(p, tag, s.split(' ').find(w => src.slice(p).startsWith(w)))
  const eat = p =>
    match(p, 'func', /^[A-Za-z_][A-Za-z0-9_]*( +[A-Za-z_][A-Za-z0-9_]*)* +=/) ||
    match(p, 'struct', /^[A-Z][A-Za-z0-9_]:(\n  [a-z].*)+/) ||
    match(p, 'enums', /^[A-Z][A-Za-z0-9_]:(\n  [A-Z].*)+/) ||
    match(p, 'num', /^[0-9]+(\.[0-9]+)?/) ||
    match(p, 'id', /^[A-Za-z_][A-Za-z0-9_]*(,[A-Za-z_][A-Za-z0-9_]*)*\(?/) ||
    match(p, 'str', /^"(?:(?:\\")|[^"])*"/) ||
    match(p, 'prop', /^\.[A-Za-z_][A-Za-z0-9_]*\(?/) ||
    match(p, 'spaces', /^[ #\n]+/) ||
    some(p, 'la', '[') ||
    some(p, 'ra', ']') ||
    some(p, 'lp', '(') ||
    some(p, 'rp', ')') ||
    some(p, 'op2', '+= -= *= /= || && == != >= <= ++ => := : <- -> > < + - * / |')

  let indent = 0
  let pos=0, tokens=[]
  while (pos < src.length) {
    const token = eat(pos)
    if (!token) { throw new Error('tokenize at ' + pos + '\n' + src) }
    if (token.tag === 'spaces' && token.code.includes('\n')) {
      const last = token.code.split('\n').slice(-1)[0]
      if (!last.includes('#')) {
        indent = last.length
        if (indent % 2 != 0) { throw new Error('invalid indent=' + indent + ' at ' + token.pos) }
      }
    }
    token.indent = indent
    pos += token.code.length
    tokens.push(token)
  }

  const dst = tokens.map(t => t.code).join('')
  if (src !== dst) throw new Error('tokenize assertion: src=' + str(src) + ' dst=' + str(dst))
  return tokens.filter(t => t.tag !== 'spaces')
}
function parse(tokens) {
  const nodes = []
  const eot = {tag: 'EOT', code: ''}
  let pos = 0
  function info() {
    return ' at=' + pos + ' tokens=' + str(tokens) + ' nodes=' + str(nodes)
  }
  function until(f) {
    const ary = []
    let t
    while (pos < tokens.length && f(t = parseTop())) {
      ary.push(t)
    }
    return ary
  }
  function parseCall(token) {
    token.name = escape(token.code.replace('(', '')).replace('.', '')
    if (token.code.endsWith('(')) {
      token.argv = until(t => t.tag !== 'rp')
    } else {
      token.argv = []
    }
  }
  function parseTop() {
    return parseLeft(parseUnit())
  }
  function parseIndent(t1, t2) {
    if (t1.indent < t2.indent) {
      t2.lines = [copy(t2)].concat(until(t => t.indent >= t2.indent))
    }
    return t2
  }
  function parseUnit() {
    const token = tokens[pos++]
    switch (token.tag) {
      case 'num': token.val = token.code; return token
      case 'str': token.val = token.code.slice(1,-1); return token
      case 'ra':
      case 'rp': return token
      case 'func':
        const ids = token.code.replace('=', '').split(/ +/).slice(0, -1)
        token.name = ids[0]
        token.argv = ids.slice(1)
        token.body = parseIndent(token, parseTop())
        return token
      case 'enums':
        const [ename, ...fields] = token.code.split('\n').map(x => x.trim()).filter(x => x)
        token.name = ename.replace(':', '')
        token.enums = fields.map(field => {
          const [id, ...bodies] = field.split(/ *[ ,:] */)
          if (bodies.length === 0) {
            return {id, alias: bodies[0]}
          } else {
            return {id, struct: dict2(bodies)}
          }
        })
      case 'struct':
        const [sname, ...struct] = token.code.split('\n').map(x => x.trim()).filter(x => x)
        token.name = sname.replace(':', '')
        token.struct = struct.map(x => x.split(' '))
        return token
      case 'id': parseCall(token); return token
      case 'la': token.ary = until(t => t.tag !== 'ra'); return token
      case 'lp': token.items = until(t => t.tag !== 'rp'); return token
      default: throw new Error('Unexpected tag ' + str(token) + info())
    }
  }
  function parseLeft(token) {
    if (pos >= tokens.length) { return token }
    if (token.tag === 'rp' || token.tag === 'ra') { return token }
    const next = tokens[pos]
    if (next.tag === 'op2') {
      ++pos
      next.op = next.code
      next.lhs = token
      next.rhs = parseTop()
      if (next.op === '=>') {
        next.args = token.tag === 'lp' ? token.items.map(x => x.name).join(',') : token.name
      }
      return parseLeft(next)
    } else if (next.tag === 'prop') {
      ++pos
      next.target = token
      parseCall(next)
      return parseLeft(next)
    } else {
      return token
    }
  }
  let next
  while (pos < tokens.length) {
    let node = parseTop()
    if (!node) { throw new Error('failed to parse at=' + pos + ' tokens=' + str(tokens)) }
    nodes.push(node)
  }

  for (const node of nodes) {
    if (node.tag === 'op2' && (!node.lhs || !node.rhs)) { throw new Error('Invalid ' + str(node)) }
    if (node.tag === 'prop' && (!node.target || !node.argv)) { throw new Error('Invalid ' + str(node)) }
    if (node.tag === 'la' && (!node.ary)) { throw new Error('Invalid ' + str(node)) }
    if (node.tag === 'lp' && (!node.items)) { throw new Error('Invalid ' + str(node)) }
    if (node.tag === 'ra') { throw new Error('Invalid ' + str({node,tokens})) }
    if (node.tag === 'rp') { throw new Error('Invalid ' + str({node,tokens})) }
  }

  return nodes
}
function generate(defs) {
  const embeddedProps = {
    'num': {string: 'toString()'}
  }
  const embeddedFuncs = {
    'str': {int: 'parseInt'}
  }
  function genCall(argv) {
    return argv.length === 0 ? '' : '(' + argv.map(gen).join(',') + ')'
  }
  function genStruct(token) {
    const fields = token.struct.map(x => x[0])
    return 'const ' + token.name + ' = (' + fields + ') => ({' + fields + '})'
  }
  function genEnum(token) {
    return token.enums.map(x => 'const ' + x.id + ' = __val => ({__val,__type:' + x.id + '})').join('\n') +
      '\nconst ' + token.name + ' = {' + token.enums.map(x => x.id).join(',') + '}'
  }
  function genFunc(token) {
    return (token.argv.length > 0 ? '(' + token.argv.join(',') + ') => ' : '') + gen(token.body)
  }
  function genLine(token) {
    return gen(token)
  }
  function genLines(lines) {
    const body = lines.map(genLine).map((line, i) => (i===lines.length-1) ? 'return ' + line : line).join('\n  ')
    return '(function () {\n  ' + body + '\n})()'
  }
  function genId(token) {
    if (token.name === 'True' || token.name === 'False') {
      return token.name.toLowerCase()
    } else if (token.name === 'if') {
      return token.argv.filter(t => t.code === '->').map(x => gen(x.lhs) + '?' + gen(x.rhs) + ':').join(' ') + gen(token.argv.slice(-1)[0])
    } else {
      return token.name + genCall(token.argv)
    }
  }
  function genMatch(token) {
    const patterns = []
    let t = token.rhs
    while (true) {
      const cond = t.lhs.code === '_' ? 'true' : '__equal(_match, ' + gen(t.lhs) + ')'
      if (t.rhs.op === '|') {
        patterns.push(cond + ' ? ' + gen(t.rhs.lhs) + ' : ')
        t = t.rhs.rhs
      } else {
        patterns.push(cond + ' ? ' + gen(t.rhs) + ' : ')
        break
      }
    }
    return '(_match =>\n  ' + patterns.join('\n  ') +
      ('\n  (()=>{throw new Error(_match)})()') +
      ')(' +  gen(token.lhs) + ')'
  }
  function genProp(token) {
    const prop = dig(embeddedProps, token.target.type, token.name)
    if (prop) {
      return wrapIfNum(gen(token.target)) + '.' + prop + genCall(token.argv)
    }
    const func = dig(embeddedFuncs, token.target.type, token.name)
    if (func) {
      return func + genCall([token.target].concat(token.argv))
    }
    return wrapIfNum(gen(token.target)) + '.' + token.name + genCall(token.argv)
  }
  function wrapIfNum(s) {
    return parseInt(s).toString() === s ? '(' + s + ')' : s
  }
  function gen(token) {
    if (token.lines) {
      return genLines(token.lines)
    }
    switch (token.tag) {
      case 'num': return token.val
      case 'str': return '"' + token.val + '"'
      case 'func': return 'const ' + token.name + ' = ' + genFunc(token)
      case 'struct': return genStruct(token)
      case 'enums': return genEnum(token)
      case 'id': return genId(token)
      case 'la': return '[' + token.ary.map(gen).join(',') + ']'
      case 'lp': return '(' + token.items.map(gen).join('') + ')'
      case 'prop': return genProp(token)
      case 'op2':
        switch (token.op) {
          case '=': return 'const ' + gen(token.lhs) + token.op + gen(token.rhs)
          case ':=': return 'let ' + gen(token.lhs) + ' = ' + gen(token.rhs)
          case '=>': return '((' + token.args + ') => ' + gen(token.rhs) + ')'
          case '++': return gen(token.lhs) + '.concat(' + gen(token.rhs) + ')'
          case '->': throw new Error('gen -> ' + str(token))
          case '|': return genMatch(token)
          default: return gen(token.lhs) + token.op + gen(token.rhs)
        }
      default: throw new Error('gen ' + str(token))
    }
  }
  return defs.map(gen).join("\n")
}
function infer(defs, src, tokens) {
  const props = {
    'num': {'string': 'str'},
    'str': {'int': 'num'},
  }
  const types = {
    'True': 'Bool',
    'False': 'Bool',
  }
  function lookup(token) {
    if (token.name === 'true' || token.name === 'false') { return 'bool' }
    if (token.name === 'if') { return inferType(token.argv[0].rhs) }
    if (token.name in types) { return types[token.name] }
    const type = props[token.name]
    if (!type) {
      throw new Error('Type does not found ' + token.name + str({props,types}))
    }
    return type
  }
  function prop(token, prop) {
    const type = inferType(token.target)
    const obj = typeof type === 'string' ? props[type] : type
    if (!obj) { throw new Error('Type does not found ' + str(token) + ' with ' + str(props)) }
    const ptype = obj[prop]
    if (!ptype) { throw new Error('Property does not found ' + str(token) + ' with ' + str(props)) }
    return ptype
  }
  function inferType(token) {
    if (!token.type) {
      token.type = _inferType(token)
    }
    return token.type
  }
  function tarray(type) {
    return type ? '[]' + type : '[]'
  }
  function _inferType(token) {
    switch (token.tag) {
      case 'str':
      case 'num': return token.tag
      case 'id': return lookup(token)
      case 'prop': return prop(token, token.name)
      case 'lp': return token.items.map(inferType)[0]
      case 'la': return tarray(token.ary.map(inferType)[0])
      case 'op2':
        switch (token.op) {
          case '+':
          case '-':
          case '*':
          case ':=': return token.lhs.type = inferType(token.rhs)
          case '=>': return 'func'
          case '++': return same(token.lhs, token.rhs)
          case '->': return inferType(token.rhs)
          case '|': if (token.lhs.code !== '|') { inferType(token.lhs) }; return inferType(token.rhs)
          default:
            throw new Error('inferType op2 ' + str(token))
        }
      default:
        throw new Error('inferType ' + str(token))
    }
  }
  function same(...tokens) {
    const type = tokens.map(inferType)[0]
    if (tokens.every(token => token.type === type)) {
      return type
    } else {
      throw new Error('Types should be same ' + str(tokens) + ' in ' + src)
    }
  }
  for (const def of defs) {
    if (def.tag === 'func') {
      types[def.name] = def.argv.length === 0 ? inferType(def.body) : 'func'
    } else if (def.enums) {
      types[def.name] = def.name
      for (const e of def.enums) {
        types[e.id] = e.alias
      }
    } else if (def.struct) {
      types[def.name] = def.name
      props[def.name] = dict(def.struct)
    }
  }
  inferType(defs.filter(x => x.name === 'main')[0].body)
}
function compile(src) {
  const tokens = tokenize(src)
  let defs = parse(tokens)
  infer(defs, src, tokens)
  const js = generate(defs)
  return {tokens,defs,js}
}
function evalInSandbox(js) {
  try {
    return Function(runtime + '\n' + js)()
  } catch (e) {
    puts('Failed to evaluate')
    for (const [i, line] of js.split('\n').entries()) {
      put((1 + i).toString().padStart(3) + ':', line)
    }
    return e
  }
}
function testAll() {
  function eq(expect, main, ...funcs) {
    const src = funcs.map(x => x + '\n').join('') + 'main = ' + main
    const info = compile(src)
    const js = info.js + '\nreturn main'
    const actual = evalInSandbox(js)
    if (str(expect) === str(actual)) {
      put('.')
    } else {
      console.error('Failed')
      put('expect: ', expect)
      put('actual: ', actual)
      put('src   : ', src)
      put('js    : ', '\n  ' + info.js.replace(/\n/g, '\n  '))
      put('defs  : '); puts(...info.defs)
      process.exit(1)
    }
  }

  // basic values
  eq(1, '1')
  eq(true, 'true')
  eq('a', '"a"')
  eq([], '[]')
  eq([1, 2, 3], '[1 2 3]')

  // expression
  eq(3, '1+2')
  eq(7, '1 + 2 * 3')
  eq(9, '(1 + 2) * 3')
  eq(5, '1 * (2 + 3)')

  // function
  eq(3, 'add(1 2)', 'add a b = a + b')
  eq(3, 'add(1 2)', 'add = (a b) => a + b')

  // control flow
  eq(1, 'if(a -> b\n  c)', 'a = true', 'b = 1', 'c = 2')
  eq(2, 'if(a -> b\n  c)', 'a = false', 'b = 1', 'c = 2')
  eq(2, 'if(a -> b\n  c -> d\n  e)', 'a = false', 'b = 1', 'c = true', 'd = 2', 'e = 3')

  // type
  eq({a:1, b:true}, 'Ab(1 True)', 'Ab:\n  a Int\n  b Bool')
  eq(1, 'A(1)\n| A -> 1\n| B -> 2', 'AB:\n  A Int\n  B Bool')
  eq(2, 'B(true)\n| A -> 1\n| B -> 2', 'AB:\n  A Int\n  B Bool')
  //eq({a:1, b:true}, 'ab(1 true)', 'ab struct:\n  a int\n  b bool')
  //eq(1, 'ast.int(1).switch(x=>x y=>y)', 'ast enum:\n  int int\n  add: lhs ast, rhs ast')

  // pattern match
  //eq(3, 'eval(ast.add(ast.int(1) ast.int(2)))', 'eval a = a.switch(x=>x y=>eval(y.lhs)+eval(y.rhs))', 'ast enum:\n  int int\n  add: lhs ast, rhs ast')
  eq(10, '1\n  | 1 -> 10\n  | 2 -> 20\n  | _ -> 0')
  eq(20, '2\n  | 1 -> 10\n  | 2 -> 20\n  | _ -> 0')
  eq(0, '3\n  | 1 -> 10\n  | 2 -> 20\n  | _ -> 0')

  // effect
  eq(1, '\n  count := 0\n  count += 1\n  count')

  // type inference
  eq('1', '1.string')
  eq(1, '"1".int')
  eq('1', 'a.string', 'a = 1')
  eq('2', '(a + 1).string', 'a = 1')
  eq('4c', '(a + b + 1).string ++ c', 'a = 1', 'b = 2', 'c = "c"')

  // spiteful tests
  eq(1, ' 1 ')
  eq(1, ' ( ( ( 1 ) ) ) ')

  console.log('ok')
}
function compileStdin() {
  const src = require('fs').readFileSync('/dev/stdin', 'utf8')
  const tokens = tokenize(src)
  const defs = parse(tokens)
  const js = compile(defs).js
  console.log(js)
}
function main() {
  process.argv[2] === 'test' ? testAll() : compileStdin()
}
main()
