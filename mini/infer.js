const { parse } = require('./parse.js')
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
  const tvar = (tid) => ({tid: tid, instance: null, toString: () => tid.toString()})
  const tclass = name => ({name, instance: null, toString: () => name})
  const type = name => ({name, toString: () => name})
  const prune = t => t.instance ? t.instance = prune(t.instance) : t
  const tint = type('int')
  const treal = type('real')
  const tclasses = {
    num: [tint, treal],
  }
  const tenv = {
    int: () => tint,
    '+': () => (t => [t, t, t])(type('num')),
    'int': () => [type('num'), tint],
    'real': () => [type('num'), treal],
  }
  const inferTop = (node, env) => {
    const inf = node => inferTop(node, env)
    const unify = (l, r) => {
      l = prune(l)
      r = prune(r)
      if (Array.isArray(l)) {
        unify(l[0], r)
        return l.length === 2 ? l[1] : l.slice(1)
      }
      const narrow = (ts, target) => ts.find(t => t.toString() === target.toString()) || fail(`No compatible '${ts}' '${target}'`)
      const assign = (base, target) => {
        return base.instance = target
      }
      return l.tid && r.tid ? assign(r, l) :
        l.tid ? assign(l, r) :
        r.tid ? assign(r, l) :
        l.toString() === r.toString() ? l :
        l.name in tclasses ? l.instance = narrow(tclasses[l.name], r) :
        r.name in tclasses ? r.instance = narrow(tclasses[r.name], l) :
        fail(`Unmatch ${l} and ${r}`)
    }
    const apply = ([head, ...argv]) => argv.reduce((ret, x) => unify(ret, inf(x)), inf(head))
    const value = v => v.match(/^[0-9]+$/) ? tclass('num') :
       v.match(/^[0-9]+\.[0-9]+$/) ? treal :
      v in env ? env[v]() :
      fail(`Unknown value '${v}'`)
    return Array.isArray(node) ? apply(node) : value(node)
  }
  return prune(inferTop(root, tenv)).toString()
}

module.exports = { infer }

if (require.main === module) {
  const assert = (expect, fact, src) => put(expect === fact ? '.' : fail(`Expect: '${expect}' but got '${fact}'. src='${src}'`))
  const test = (expect, src) => assert(expect, infer(parse(src)), src)

  test('num', '1')
  test('int', 'int(1)')
  test('real', 'real(1)')
  test('real', '1.2')
  test('num', '1 + 2')
  test('real', '1.0 + 2.0')
  test('real', '1 + 2.0')
  test('real', '1.0 + 2')
  test('real', '1 + 2 + 3.0')
  test('real', '1.0 + 2.0 + 3')
  puts('ok')
}