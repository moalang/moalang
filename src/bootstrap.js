const write = (...a) => a.map(o => process.stdout.write(o.toString()))
const print = (...a) => console.log(...a)
const dump = (label,o) => { write(label, ' '); console.dir(o,{depth:null}) }
const str = o => JSON.stringify(o, null, '  ')
const eq = (x, y) => str(x) === str(y)
const fail = (message, obj) => { dump(message, obj || {}); throw new Error(message) }
const dict = (ks,vs) => ks.reduce((d,k,i) => (d[k]=vs[i], d), {})
const priorities = [
  '|| &&',
  '== != > < >= <=',
  '+ -',
  '* / //',
  '=>',
  '.',
].map(ops => ops.split(' '))
const priority = op => priorities.findIndex(ops => ops.includes(op))
const newType = (type,o) => Object.assign({type}, o)
const isPrimitive = o => (t =>
  t === 'number' ||
  t === 'string' ||
  t === 'object' && (o.constructor === Array || o.constructor == Error)
)(typeof o)

const tokenize = src => {
  let index = 0
  let line = 1
  let indent = 0
  const match = (tag, reg, f) => (m => m && ({tag, index, line, indent, code: m[0], value: f && f(m[0])}))(src.slice(index).match(reg))
  const any = (tag, a) => (code => code && ({tag, index, line, indent, code}))(a.find(v => src.slice(index).startsWith(v)))
  const next = () => match('int', /^[0-9]+/, parseInt) ||
    match('string', /^"[^"]*"+/, s => s.slice(1, -1)) ||
    match('id', /^(?:true|false)(?![a-zA-Z0-9_])/, s => s === 'true') ||
    match('id', /^[a-zA-Z_0-9]+/) ||
    any('op2', '|| && == >= <= => != //'.split(' ').concat('+-*/.><'.split(''))) ||
    any('sym', '[]()=:|'.split('')) ||
    match('space', /^[ \n]+/) ||
    fail('Failed to tokenize:', {src, index, around: src.slice(index)})
  const tokens = []
  while (index < src.length) {
    const token = next()
    index += token.code.length
    line += (token.code.match(/\n/g) || []).length
    indent = (m => m ? m[0].length - 1 : indent)(token.code.match(/\n *$/))
    tokens.push(token)
  }
  return tokens.filter(t => t.tag !== 'space')
}
const parse = tokens => {
  let pos = 0
  const next = () => tokens[pos++] || fail('EOT', tokens)
  const consume = () => {
    let node = next()
    if (node.code === ')' || node.code === ']') {
      return node
    }
    if (node.code === '(') {
      node = consume()
      guard(t => t.code === ')')
      node.fixed = true // prevent to change priority
    }
    if (node.code === '[') {
      const values = until(t => t.code !== ']', consume)
      node = newType('array', {values})
    }
    while (pos < tokens.length && tokens[pos].code === '(' && tokens[pos - 1].index + tokens[pos - 1].code.length === tokens[pos].index) {
      pos += 1 // drop "("
      const argv = until(t => t.code !== ')', consume)
      node = newType('call', {body: node, argv})
    }
    if (pos < tokens.length && tokens[pos].tag === 'op2') {
      const op2 = consume().code
      const lhs = node
      const rhs = consume()
      if (rhs.op2 && !lhs.fixed && !rhs.fixed && priority(op2) > priority(rhs.op2)) {
        node = {op2: rhs.op2, lhs: {op2, lhs, rhs: rhs.lhs}, rhs: rhs.rhs}
      } else {
        node = {op2, lhs, rhs}
      }
    }
    return node
  }
  const guard = f => (node => f(node) ? node : fail('Unexpected node:' + f.toString(), {node, pos, nodes}))(consume())
  const until = (f, g) => {
    const matches = []
    while (pos < tokens.length) {
      const bk = pos
      const node = consume()
      if (f(node)) {
        matches.push(node)
      } else {
        pos = bk
        break
      }
    }
    g && g()
    return matches
  }
  const consumeFields = (indent) => {
    const fields = until(t => t.indent > indent)
    return [...Array(fields.length/2).keys()].map(i => fields[i*2].code)
  }
  const consumeAdtFields = () => {
    const tags = []
    while (pos < tokens.length && tokens[pos].indent > 0) {
      const tag = {type: 'tag', id: consume().code, fields: []}
      if (pos < tokens.length && tokens[pos].code === ':') {
        consume() // drop ':'
        tag.fields = consumeFields(2)
      }
      tags.push(tag)
    }
    return tags
  }
  const top = () => {
    const {code, indent} = consume()
    const args = until(t => t.tag === 'id' && t.indent === indent).map(t => t.code)
    switch (consume().code) {
      case '=': return newType('func', {id: code, args, body: consume()})
      case ':': return newType('struct', {id: code, args, struct: consumeFields(0)})
      case '|': return newType('adt', {id: code, args, adt: consumeAdtFields()})
      default: fail('Unknown definition', {code, args, pos, tokens})
    }
  }

  const nodes = []
  while (pos < tokens.length) {
    nodes.push(top())
  }
  return nodes
}
const execute = nodes => {
  const scope = {}
  for (const node of nodes) {
    if (node.type === 'func') {
      scope[node.id] = node
    } else if (node.type === 'struct') {
      scope[node.id] = node
    } else if (node.type === 'adt') {
      for (const tag of node.adt) {
        scope[tag.id] = tag
      }
    } else {
      fail('Unknown node', node)
    }
  }
  const method = (env, o, node) => {
    if (node.tag === 'id') {
      const id = node.code
      if (typeof o === 'object' && o.constructor === Array) {
        if (id === 'size') {
          return o.length
        }
      }
      if (typeof o === 'object' && o.constructor === Error) {
        if (id === 'message') {
          return o.message
        }
      }
      if (typeof o === 'string') {
        if (id === 'size') {
          return o.length
        }
      }
    } else if (node.type === 'call') {
      const id = node.body.code
      const argv = node.argv
      if (typeof o === 'object' && o.constructor === Array) {
        if (id === 'at') {
          return o[run(env, argv[0])]
        }
      }
      if (typeof o === 'string') {
        if (id === 'at') {
          return o[run(env, argv[0])]
        }
      }
    }
    fail('Unknown method', {o,node})
  }
  const run = (env, node) => {
    if (node === undefined) {
      return node
    }
    if (isPrimitive(node)) {
      return node
    }
    if (node.value !== undefined) {
      return node.value
    } else if (node.values) {
      return node.values.map(o => run(env, o))
    } else if (node.op2 === '.') {
      return method(env, run(env, node.lhs), node.rhs)
    } else if (node.op2 === '=>') {
      const args = [node.lhs.code]
      const body = node.rhs
      return newType('func', {id: '', args, body})
    } else if (node.op2) {
      const l = run(env, node.lhs)
      const r = run(env, node.rhs)
      switch (node.op2) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/': return l / r
        case '//': return parseInt(l / r)
        case '==': return eq(l, r)
        case '!=': return !eq(l, r)
        case '>':  return l > r
        case '<':  return l < r
        case '>=': return l >= r
        case '<=': return l <= r
        case '||': return l || r
        case '&&': return l && r
        default: fail('Unknown op2', node)
      }
    } else if (node.type === 'struct') {
      return node
    } else if (node.type === 'tag') {
      if (node.fields.length === 0) {
        return {_type: node.id}
      } else {
        return node
      }
    } else if (node.type === 'func') {
      if (node.args.length === 0) {
        return run(env, node.body)
      } else {
        return node
      }
    } else if (node.type === 'call') {
      if (node.body.code === 'if') {
        for (let i=0; i<node.argv.length; i+=2) {
          if (run(env, node.argv[i]) === true) {
            return run(env, node.argv[i + 1])
          }
        }
        return run(env, node.argv.slice(-1)[0])
      } else if (node.body.code === 'match') {
        const target = run(env, node.argv[0])
        for (let i=1; i<node.argv.length; i+=2) {
          if (target._type === node.argv[i].code) {
            return run(env, node.argv[i + 1])
          }
        }
        throw new Error('Unmatch' + str(target))
      } else if (node.body.code === 'then') {
        const target = run(env, node.argv[0])
        if (typeof target === 'object' && target.constructor === Error) {
          throw target
        } else {
          const f = run(env, node.argv[1])
          return run(Object.assign({}, env, dict(f.args, [target])), f.body)
        }
      } else if (node.body.code === 'catch') {
        const target = run(env, node.argv[0])
        if (typeof target === 'object' && target.constructor === Error) {
          const f = run(env, node.argv[1])
          return run(Object.assign({}, env, dict(f.args, [target])), f.body)
        } else {
          return target
        }
      } else if (node.body.code === 'error') {
        return Error(run(env, node.argv[0]))
      }
      const f = run(env, node.body)
      const argv = node.argv.map(o => run(env, o))
      if (f.type === 'func') {
        return run(Object.assign({}, env, dict(f.args, argv)), f.body)
      } else if (f.type === 'struct') {
        return dict(f.struct, argv)
      } else if (f.type === 'tag') {
        return Object.assign({_type: f.id}, dict(f.fields, argv))
      } else {
        return f
      }
    } else if (node.tag === 'id') {
      return run(env, env[node.code])
    }
    fail('Failed to run', {node, nodes})
  }
  try {
    return run(scope, scope.main.body)
  } catch (e) {
    return e
  }
}

const testJs = () => {
  const test = (check, expect, exp, ...defs) => {
    const src = (defs || []).concat(['main = ' + exp]).join('\n')
    const tokens = tokenize(src)
    const nodes = parse(tokens)
    const result = execute(nodes)
    if (eq(expect, check(result))) {
      write('.')
    } else {
      print('expect:', expect)
      print('result:', result)
      dump('tokens :', tokens)
      dump('nodes  :', nodes)
      print('src   :', src)
      throw new Error('Test was failed')
    }
  }
  const t = (expect, exp, ...defs) => test(x => x, expect, exp, ...defs)
  const f = (expect, exp, ...defs) => test(x => x.message, expect, exp, ...defs)

  // primitives
  t(1, '1')
  t('hi', '"hi"')
  t(false, 'false')
  t(1, '(a => a)(1)')

  // expression
  t(3, '1 + 2')
  t(1, '3 - 2')
  t(6, '2 * 3')
  t(1.5, '3 / 2')
  t(2, '4 // 2')
  t(true, '1 != 2')
  t(false, '1 == 2')
  t(false, '1 > 2')
  t(true, '1 < 2')

  // parenthesis
  t(3, '(1 + 2)')
  t(6, '(1) + ((2 + 3))')
  t(14, '2 * (3 + 4)')

  // precedence of operatos
  t(5, '1 + 2 * 3 - 4 / 2')
  t(true, '1 == 2 || 3 != 4')

  // containers
  t([], '[]')
  t([1], '[1]')
  t([1, 2], '[1 2]')
  t([1, 5], '[1 2+3]')

  // control flow
  t(1, 'if(true 1 main)')
  t(2, 'if(false main 2)')
  t(3, 'if(false main false main 3)')

  // functions
  t(3, 'f + 2', 'f = 1')
  t(3, 'f(1)', 'f a = a + 2')

  // methods
  t(1, '[1].size')
  t(2, '"hi".size')
  t(2, 'id("hi").size', 'id a = a')
  t('i', '"hi".at(1)')

  // generics
  t('i', 'id("hi").at(id(1))', 'id a = a')

  // recursive
  t(120, 'f(5)', 'f n = if((n > 1) (n * f(n - 1)) 1)')

  // struct
  t({a: 1}, 's(1)', 's:\n  a int')
  t({a: 1, b: "b"}, 's(1 "b")', 's:\n  a int\n  b string')

  // adt
  t({_type: 'a'}, 'a', 't|\n  a')
  t({_type: 'a', x: 1}, 'a(1)', 't|\n  a:\n    x int')

  // match
  t(1, 'match(a a 1 b 2)', 't|\n  a\n  b')
  t(2, 'match(b a 1 b 2)', 't|\n  a\n  b')

  // option
  t(3, 'then(1 v => (v + 2))')
  f("hi", 'error("hi")')
  f("hi", 'then(error("hi") v => v)')
  t("hi", 'catch(error("hi") e => e.message)')

/*
  // monadic statement
  t(1, 'main =\n  some(1)')
  t(2, 'main =\n  some(1)\n  some(2)')
  t({message: 'hi', __type: 'error'}, 'main =\n  error("hi")\n  some(2)')
  */
}

testJs()
print('ok')
