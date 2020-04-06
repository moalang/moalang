require 'byebug'

def moa_branch(target, conds)
  target = target.run!
  conds.each do |(cond, body)|
    return body.run! if moa_branch_eq(target, cond)
  end
  raise Exception.new('Unexpected branch ' + target.inspect + ' ' + conds.inspect)
end
def moa_branch_eq(target, cond)
  return target if target.instance_of?(MoaPanic)
  is_moa_error = target.instance_of?(MoaError)
  return target == cond unless cond.instance_of?(Symbol)
  return !is_moa_error if cond == :ok
  return is_moa_error if cond == :err
  return target._tag == cond
end
def ok
  lambda { |v| v }
end
def err
  lambda { |s| MoaError.new(s) }
end
def panic
  lambda do |s|
    byebug if $DEBUG
    MoaPanic.new(s)
  end
end
class MoaStmt
  def initialize(f)
    @f = f
  end
  def call
    @f.call
  end
  def or(x)
    p = @f
    MoaStmt.new(lambda { |*args| p.call(*args).or(x) })
  end
end
class MoaError
  def initialize(message)
    @m = message
  end
  def to_s
    @m
  end
  def or(v)
    v
  end
end
class MoaPanic
  def initialize(message)
    @m = message
  end
  def to_s
    @m
  end
  def or(_)
    self
  end
end
class String
  def has(x)
    include?(x)
  end
end
class Proc
  def or(x)
    p = self
    lambda { |*args| p.call(*args).or(x) }
  end

  def to_s
    "lambda:#{source_location[1]}"
  end
end
class Object
  def or(_)
    self
  end
  def err?
    instance_of?(MoaError) || instance_of?(MoaPanic)
  end
  def __call(*args)
    instance_of?(Proc) && (arity == args.size || arity == -1) ? self.call(*args).__call : self
  end
  def run!
    v = __call
    v.instance_of?(Method) || v.instance_of?(MoaStmt) ? v.call.run! : v
  end
  def to_s
    self.to_s
  end
  def to_i
    self.to_int
  end
end
class Array
  def map(*f)
    if block_given?
      super() { |*x| yield *x }
    else
      super() { |x| f[0].call(x) }
    end
  end
  def count
    size
  end
end
class String
  def count
    size
  end
end
