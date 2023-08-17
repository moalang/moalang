# reserved
[ ] _           :: tuple[]
[ ] true, false :: bool
[ ] int         :: string int @error
[ ] float       :: string float @error
[ ] string a    :: a string
[ ] bool        :: a bool
[ ] bytes       :: a bytes
[ ] list a      :: a+ list[a]
[ ] dict a b    :: (a,b)+ dict[a b]
[ ] set a       :: a+ set[a]
[ ] tuple ...   :: tuple[...]
[ ] throw a b   :: a b
[ ] if a        :: bool a _
[ ] else a      :: a _
[ ] for a       :: .int int int? int? a _
[ ] each a b    :: .a iter[a] b _
[ ] while a     :: bool a _
[ ] continue    :: _
[ ] break       :: _
[ ] return a    :: a a
[ ] num         # int, float
[ ] iter        # string, list, dict, bytes

# bool
[ ] flip :: bool

# int
[ ] + - * ** / % | & ^ :: int int int
[ ] abs    :: int
[ ] neg    :: int
[ ] char   :: string
[ ] times  :: iter[int]
[ ] to     :: int int? iter[int]
[ ] string :: string
[ ] format :: string string

# float
[ ] + - * ** / % :: float float float
[ ] abs    :: float
[ ] neg    :: float
[ ] floor  :: int
[ ] ceil   :: int
[ ] round  :: int
[ ] string :: string
[ ] format :: string string

# string
[ ] ++       :: string string string
[ ] size     :: int
[ ] pos      :: int
[ ] get      :: int string @error
[ ] slice    :: int int? string
[ ] split    :: string int? list[string]
[ ] index    :: string int
[ ] replace  :: string string int? string
[ ] reverse  :: string
[ ] ucode    :: int
[ ] match    :: string iter[string]
[ ] rsplit   :: string int? list[string]
[ ] rreplace :: string fn[list[string] string] int? string

# bytes
[ ] ++ :: bytes bytes bytes
[ ] be :: bytes # big endian mode
[ ] le :: bytes # little endian mode
[ ] get :: int int @error
[ ] set :: int int @error
[ ] read a :: a @error
[ ] write a :: a int @error
[ ] size :: int
[ ] slice :: int int? bytes
[ ] base64 :: string
[ ] string :: string

# lambda[a b ...]
[ ] string :: string

# list[a]
[ ] ++ a :: list[a] list[a]
[ ] size :: int
[ ] bool :: bool
[ ] empty :: bool
[ ] get :: int a @error
[ ] set :: int a a @error
[ ] map b :: fn[a b] list[b]
[ ] fmap b :: fn[a list[b]] list[b]
[ ] keep :: fn[a bool] list[a]
[ ] all  :: fn[a bool] bool
[ ] any  :: fn[a bool] bool
[ ] slice :: int int? list[a]
[ ] sort b :: fn[a b]? list[a]
[ ] count b :: fn[a b]? dict[b int]
[ ] group b :: fn[a b]? dict[b list[a]]
[ ] reverse :: list[a]
[ ] zip b :: list[b] list[tuple[a b]]
[ ] find :: fn[a bool] a @error
[ ] fold b :: fn[a b b] b
[ ] has :: a bool
[ ] sum :: a
[ ] min :: a
[ ] max :: a

# dict[k v]
[ ] size :: int
[ ] get :: k v @error
[ ] set :: k v v
[ ] has :: k bool
[ ] keys :: iter[k]
[ ] values :: iter[v]
[ ] list :: list[tuple[k v]]

# set[a]
[ ] size :: int
[ ] - :: set[a] set[a]
[ ] | :: set[a] set[a]
[ ] & :: set[a] set[a]
[ ] ^ :: set[a] set[a]
[ ] has :: a bool

# tuple[a b ...]
[ ] 0 :: a
[ ] 1 :: b
...

---( interface )---------------------------------------
interface num a:
  + - * ** / / % :: a a a
  abs :: a
  neg :: a

interface class a:
 ft == : a a bool
 ft === : a class bool
 ft <=>: a a int
 ft () ...: a # T(...) returns instance of T
 fn != a b: (a == b).flip
 fn > a b : (a <=> b) == 1
 fn >= a b: (a <=> b) >= 0
 fn < a b : (a <=> b) == -1
 fn <= a b: (a <=> b) <= 0

---( module )------------------------------------------
# math
[ ] acos acosh asin asinh atan atan2 atanh cbrt cos cosh erf erfc exp gamma log log10 log2 sin sinh sqrt tan tanh :: float float
[ ] e, pi, inf, nan :: float
[ ] hypot, logn :: float float float
[ ] lgamma, frexp :: float (float, int)
[ ] ldexp :: float int float



---( io )----------------------------------------------
# log
[ ] debug, info, warn, error a :: a any* a

# time
[ ] year, month, day, hour, minute, second, wday, mday, yday :: int
[ ] time.now

# random
[ ] random.int :: int int int
[ ] random.bytes :: int bytes
[ ] random.choice a :: list[a] a @error

# http
[ ] listen string (http.request http.response) _
[ ] request string {method.string headers.list[tuple[string list[string]]] body.bytes}? http.response

# odb (object database management system)
[ ] schema a :: odb.schema(a)
[ ] transaction a :: odb.schema(a) int @error