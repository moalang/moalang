/*
 * This program converts some nodes in an internal expression based on type inference.
 * [ ] Infer types
 * [ ] Convert a method call to a function call
 */
const dump = o => { console.dir(o, {depth: null}); return o }
const fail = m => { throw new Error(m) }
const str = o => typeof o === 'string' ? o :
  Array.isArray(o) ? `(${o.map(str).join(' ')})` :
  o.tid || o.type ? o.toString() :
  JSON.stringify(o)
const put = (...a) => { process.stdout.write(a.map(str).join(' ')); return a[0] }
const puts = (...a) => { console.log(a.map(str).join(' ')); return a[0] }
const infer = root => {
  let unique = 1
  const repeat = t => (t.repeatable = true, t)
  const tvar = () => (tid => ({tid, instance: null, toString: () => tid.toString()}))(unique++)
  const tclass = name => ({name, instance: null, toString: () => name})
  const type = (name, ...generics) => ({name, generics, toString: () => `${name}${generics.length ? `(${generics.map((g, i) => g.instance ? g.instance.toString() : i).join(' ')})` : ''}`})
  const prune = t => t.instance ? t.instance = prune(t.instance) : t
  const tint = type('int')
  const tfloat = type('float')
  const tclasses = {
    num: [tint, tfloat],
  }
  const tenv = {
    int: () => tint,
    '+': () => (t => [t, t, t])(type('num')),
    'int': () => [type('num'), tint],
    'float': () => [type('num'), tfloat],
    'list': () => (t => [t, type('list', t)])(repeat(tvar())),
    '__empty': () => type('list', tvar()),
  }
  const inferTop = (node, env) => {
    const inf = node => inferTop(node, env)
    const unify = (l, r, f) => {
      l = prune(l)
      r = prune(r)
      const narrow = (ts, target) => ts.find(t => t.toString() === target.toString()) || fail(`No compatible '${ts}' '${target}'`)
      return Array.isArray(l) && l[0].repeatable && unify(l[0], r, () => false) ? (prune(l[0]), l) :
        Array.isArray(l) ? (unify(l[0], r), l.length === 2 ? l[1] : l.slice(1)) :
        l.tid && r.tid ? r.instane = l :
        l.tid ? l.instance = r :
        r.tid ? r.instance = l :
        l.toString() === r.toString() ? l :
        l.name in tclasses ? l.instance = narrow(tclasses[l.name], r) :
        r.name in tclasses ? r.instance = narrow(tclasses[r.name], l) :
        f ? f() : fail(`Unmatch ${l} and ${r}`)
    }
    const apply = ([head, ...argv]) => derepeat(argv.reduce((ret, x) => unify(ret, inf(x)), inf(head)))
    const derepeat = a => Array.isArray(a) && a[0].repeatable ? derepeat(a.slice(1)) : a
    const value = v => v.match(/^[0-9]+$/) ? tclass('num') :
      v.match(/^[0-9]+\.[0-9]+$/) ? tfloat :
      v in env ? env[v]() :
      fail(`Unknown value '${v}'`)
    return node.type = Array.isArray(node) ? apply(node) : value(node)
  }
  return prune(inferTop(root, tenv))
}
const fix = o => (Array.isArray(o) ? o.map(fix) : o.type = o.type.toString(), o)
const convert = root => (infer(root), fix(root))

module.exports = { convert }

if (require.main === module) {
  const { parse } = require('./parse.js')
  const assert = (expect, fact, src) => put(expect === fact ? '.' : fail(`Expect: '${expect}' but got '${fact}'. src='${src}'`))
  const test = (expect, src) => assert(expect, infer(parse(src)).toString(), src)

  // primitives
  test('num', '1')
  test('float', '1.2')

  // generics
  test('list(0)', '[]')
  test('list(num)', '[1]')
  test('list(float)', '[1.0]')
  test('list(num)', '[1 2]')
  test('list(float)', '[1 2.0]')
  test('list(float)', '[1 2.0 3]')

  // type cast
  test('int', 'int(1)')
  test('float', 'float(1)')
  test('int', 'int(float(1))')
  test('float', 'float(int(1))')

  // type class
  test('num', '1 + 2')
  test('float', '1.0 + 2.0')
  test('float', '1 + 2.0')
  test('float', '1.0 + 2')
  test('float', '1 + 2 + 3.0')
  test('float', '1.0 + 2.0 + 3')

  // convert
  assert('num', convert(parse('1 + 2')).type.toString(), '1 + 2')

  puts('ok')
}